package handlers

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"motor-platform/internal/auth"
	"motor-platform/internal/models"
	"motor-platform/internal/storage"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type RecordingHandler struct {
	db              *gorm.DB
	storageProvider storage.StorageProvider
	asyncStitcher   func(caseID, recordingID string) error
}

func NewRecordingHandler(db *gorm.DB, sp storage.StorageProvider, stitcher func(caseID, recordingID string) error) *RecordingHandler {
	return &RecordingHandler{
		db:              db,
		storageProvider: sp,
		asyncStitcher:   stitcher,
	}
}

type StartRecordingRequest struct {
	ContactID *string `json:"contact_id"`
}

func (h *RecordingHandler) StartRecording(c *gin.Context) {
	caseID := c.Param("id")
	claims, _ := auth.GetUserClaims(c)

	var req StartRecordingRequest
	_ = c.ShouldBindJSON(&req)

	var cs models.Case
	if err := h.db.Where("id = ?", caseID).First(&cs).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "case not found"})
		return
	}

	recording := models.Recording{
		CaseID:    caseID,
		AgentID:   claims.UserID,
		ContactID: req.ContactID,
		Status:    models.RecordingStreaming,
		MimeType:  "video/webm",
		StartedAt: time.Now().UTC(),
	}

	if err := h.db.Create(&recording).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to initialize recording session"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"recording_id": recording.ID,
		"case_id":      caseID,
		"status":       recording.Status,
		"started_at":   recording.StartedAt,
	})
}

func (h *RecordingHandler) UploadChunk(c *gin.Context) {
	caseID := c.Param("id")
	recordingID := c.Param("recId")

	chunkIndexStr := c.PostForm("chunk_index")
	chunkIndex, err := strconv.Atoi(chunkIndexStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid chunk_index"})
		return
	}

	fileHeader, err := c.FormFile("chunk_file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing chunk_file"})
		return
	}

	fileReader, err := fileHeader.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "cannot open chunk file"})
		return
	}
	defer fileReader.Close()

	// Abstract storage key: cases/<case_id>/recordings/<rec_id>/chunks/chunk_%06d.webm
	storagePath := fmt.Sprintf("cases/%s/recordings/%s/chunks/chunk_%06d.webm", caseID, recordingID, chunkIndex)

	_, err = h.storageProvider.UploadFile(c.Request.Context(), fileReader, storagePath, fileHeader.Size, "video/webm")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to persist chunk to storage: " + err.Error()})
		return
	}

	// Persist chunk record
	chunk := models.RecordingChunk{
		RecordingID:     recordingID,
		ChunkIndex:      chunkIndex,
		StoragePath:     storagePath,
		DurationSeconds: 5.00,
		SizeBytes:       fileHeader.Size,
		CreatedAt:       time.Now().UTC(),
	}

	if err := h.db.Create(&chunk).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save chunk record: " + err.Error()})
		return
	}

	// Update recording duration and cumulative case duration
	h.db.Model(&models.Recording{}).Where("id = ?", recordingID).Update("duration_seconds", gorm.Expr("duration_seconds + 5"))
	h.db.Model(&models.Case{}).Where("id = ?", caseID).Update("total_duration_seconds", gorm.Expr("total_duration_seconds + 5"))

	c.JSON(http.StatusCreated, gin.H{
		"chunk_index": chunkIndex,
		"status":      "PERSISTED",
		"size_bytes":  fileHeader.Size,
	})
}

type StopRecordingRequest struct {
	DurationSeconds int `json:"duration_seconds"`
}

func (h *RecordingHandler) StopRecording(c *gin.Context) {
	caseID := c.Param("id")
	recordingID := c.Param("recId")

	var req StopRecordingRequest
	_ = c.ShouldBindJSON(&req)

	var recording models.Recording
	if err := h.db.Where("id = ? AND case_id = ?", recordingID, caseID).First(&recording).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "recording not found"})
		return
	}

	now := time.Now().UTC()
	recording.StoppedAt = &now
	recording.Status = models.RecordingReady

	if req.DurationSeconds > 0 {
		recording.DurationSeconds = req.DurationSeconds
	}

	h.db.Save(&recording)

	// Trigger asynchronous stitcher job
	if h.asyncStitcher != nil {
		_ = h.asyncStitcher(caseID, recordingID)
	}

	c.JSON(http.StatusOK, gin.H{
		"recording_id":     recording.ID,
		"status":           "READY",
		"duration_seconds": recording.DurationSeconds,
		"stopped_at":       recording.StoppedAt,
	})
}

func (h *RecordingHandler) UploadDirectRecording(c *gin.Context) {
	caseID := c.Param("id")
	claims, _ := auth.GetUserClaims(c)

	fileHeader, err := c.FormFile("recording_file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing recording_file"})
		return
	}
	if fileHeader.Size == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "uploaded recording file is empty (0 bytes). Ensure recording captured video."})
		return
	}

	durationSec, _ := strconv.Atoi(c.PostForm("duration_seconds"))
	if durationSec < 1 {
		durationSec = 1
	}

	fileReader, err := fileHeader.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "cannot read file"})
		return
	}
	defer fileReader.Close()

	// Compute SHA-256 hash while buffering to memory
	hasher := sha256.New()
	buf := new(bytes.Buffer)
	tee := io.TeeReader(fileReader, hasher)
	if _, err := io.Copy(buf, tee); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to buffer recording: " + err.Error()})
		return
	}
	checksum := hex.EncodeToString(hasher.Sum(nil))

	now := time.Now().UTC()
	ext := filepath.Ext(fileHeader.Filename)
	if ext == "" {
		ext = ".webm"
	}
	storagePath := fmt.Sprintf("cases/%s/recordings/rec_%d%s", caseID, now.Unix(), ext)

	mimeType := fileHeader.Header.Get("Content-Type")
	if mimeType == "" {
		mimeType = "video/webm"
	}

	fileSize := int64(buf.Len())
	_, err = h.storageProvider.UploadFile(c.Request.Context(), buf, storagePath, fileSize, mimeType)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "storage upload failed: " + err.Error()})
		return
	}

	rec := models.Recording{
		CaseID:            caseID,
		AgentID:           claims.UserID,
		Status:            models.RecordingReady,
		DurationSeconds:   durationSec,
		MasterStoragePath: &storagePath,
		FileSizeBytes:     fileSize,
		MimeType:          mimeType,
		SHA256Checksum:    &checksum,
		StartedAt:         now.Add(-time.Duration(durationSec) * time.Second),
		StoppedAt:         &now,
	}
	h.db.Create(&rec)

	// Increment total duration in case
	h.db.Model(&models.Case{}).Where("id = ?", caseID).Update("total_duration_seconds", gorm.Expr("total_duration_seconds + ?", durationSec))

	// Add audit log
	h.db.Create(&models.CaseAuditLog{
		CaseID:  caseID,
		ActorID: claims.UserID,
		Action:  "RECORDING_UPLOADED",
		Remarks: fmt.Sprintf("Direct recording uploaded: %d seconds, SHA-256: %s", durationSec, checksum[:16]),
	})

	c.JSON(http.StatusCreated, rec)
}

func (h *RecordingHandler) UploadFallbackRecording(c *gin.Context) {
	h.UploadDirectRecording(c)
}

func (h *RecordingHandler) UploadScreenshot(c *gin.Context) {
	caseID := c.Param("id")
	claims, _ := auth.GetUserClaims(c)

	fileHeader, err := c.FormFile("screenshot")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing screenshot file"})
		return
	}

	offsetSec, _ := strconv.Atoi(c.PostForm("timestamp_offset_seconds"))
	caption := c.PostForm("caption")
	recID := c.PostForm("recording_id")
	var recIDPtr *string
	if recID != "" {
		recIDPtr = &recID
	}

	fileReader, err := fileHeader.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "cannot open screenshot"})
		return
	}
	defer fileReader.Close()

	now := time.Now().UTC()
	contentType := fileHeader.Header.Get("Content-Type")
	ext := ".jpg"
	if contentType == "image/png" || strings.HasSuffix(strings.ToLower(fileHeader.Filename), ".png") {
		ext = ".png"
		contentType = "image/png"
	} else {
		ext = ".jpg"
		contentType = "image/jpeg"
	}

	storagePath := fmt.Sprintf("cases/%s/screenshots/shot_%d%s", caseID, now.UnixNano(), ext)

	_, err = h.storageProvider.UploadFile(c.Request.Context(), fileReader, storagePath, fileHeader.Size, contentType)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "storage error: " + err.Error()})
		return
	}

	screenshot := models.CaseScreenshot{
		CaseID:                 caseID,
		RecordingID:            recIDPtr,
		UploadedByID:           claims.UserID,
		StoragePath:            storagePath,
		TimestampOffsetSeconds: offsetSec,
		Caption:                caption,
		CreatedAt:              now,
	}

	if err := h.db.Create(&screenshot).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save screenshot"})
		return
	}

	c.JSON(http.StatusCreated, screenshot)
}

func (h *RecordingHandler) UploadDocument(c *gin.Context) {
	caseID := c.Param("id")
	claims, _ := auth.GetUserClaims(c)

	fileHeader, err := c.FormFile("document")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing document file"})
		return
	}

	category := models.DocumentCategory(c.PostForm("doc_category"))
	if category == "" {
		category = models.DocOtherEvidence
	}

	fileReader, err := fileHeader.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "cannot open document"})
		return
	}
	defer fileReader.Close()

	now := time.Now().UTC()
	storagePath := fmt.Sprintf("cases/%s/documents/%s_%d_%s", caseID, category, now.Unix(), fileHeader.Filename)

	_, err = h.storageProvider.UploadFile(c.Request.Context(), fileReader, storagePath, fileHeader.Size, fileHeader.Header.Get("Content-Type"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "storage error: " + err.Error()})
		return
	}

	doc := models.CaseDocument{
		CaseID:        caseID,
		UploadedByID:  claims.UserID,
		DocCategory:   category,
		FileName:      fileHeader.Filename,
		StoragePath:   storagePath,
		FileSizeBytes: fileHeader.Size,
		MimeType:      fileHeader.Header.Get("Content-Type"),
		CreatedAt:     now,
	}

	if err := h.db.Create(&doc).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save document record"})
		return
	}

	c.JSON(http.StatusCreated, doc)
}

func (h *RecordingHandler) GetFileStream(c *gin.Context) {
	path := c.Query("path")
	if path == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing file path query"})
		return
	}

	reader, err := h.storageProvider.DownloadFile(c.Request.Context(), path)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "file not found: " + err.Error()})
		return
	}
	defer reader.Close()

	c.DataFromReader(http.StatusOK, -1, "application/octet-stream", reader, nil)
}
