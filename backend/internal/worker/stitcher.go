package worker

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"

	"motor-platform/internal/models"
	"motor-platform/internal/storage"

	"gorm.io/gorm"
)

type Stitcher struct {
	db      *gorm.DB
	storage storage.StorageProvider
}

func NewStitcher(db *gorm.DB, sp storage.StorageProvider) *Stitcher {
	return &Stitcher{db: db, storage: sp}
}

// StitchRecording chunks together using FFmpeg stream copy and calculates SHA-256
func (s *Stitcher) StitchRecording(ctx context.Context, caseID, recordingID string) error {
	log.Printf("🎬 Stitching chunks for case %s, recording %s", caseID, recordingID)

	var chunks []models.RecordingChunk
	if err := s.db.Where("recording_id = ?", recordingID).Order("chunk_index ASC").Find(&chunks).Error; err != nil {
		return err
	}

	if len(chunks) == 0 {
		log.Printf("⚠️ No chunks found for recording %s, skipping stitching", recordingID)
		return nil
	}

	scratchDir, err := os.MkdirTemp("", "stitch-"+recordingID)
	if err != nil {
		return fmt.Errorf("failed to create scratch dir: %w", err)
	}
	defer os.RemoveAll(scratchDir) // Rule 4: Clean ephemeral filesystem

	concatPath := filepath.Join(scratchDir, "concat.txt")
	concatFile, err := os.Create(concatPath)
	if err != nil {
		return fmt.Errorf("failed to create concat file: %w", err)
	}

	for _, chunk := range chunks {
		localChunkPath := filepath.Join(scratchDir, fmt.Sprintf("chunk_%06d.webm", chunk.ChunkIndex))
		reader, err := s.storage.DownloadFile(ctx, chunk.StoragePath)
		if err != nil {
			log.Printf("Warning: failed to read chunk %s: %v", chunk.StoragePath, err)
			continue
		}

		outFile, err := os.Create(localChunkPath)
		if err == nil {
			_, _ = io.Copy(outFile, reader)
			outFile.Close()
		}
		reader.Close()

		fmt.Fprintf(concatFile, "file '%s'\n", localChunkPath)
	}
	concatFile.Close()

	masterLocalPath := filepath.Join(scratchDir, "master.webm")
	var checksum string
	var fileSize int64

	// Try executing ffmpeg
	cmd := exec.CommandContext(ctx, "ffmpeg", "-y",
		"-f", "concat",
		"-safe", "0",
		"-i", concatPath,
		"-c", "copy",
		masterLocalPath,
	)

	if out, err := cmd.CombinedOutput(); err != nil {
		log.Printf("FFmpeg failed: %v (%s). Fallback to direct chunk byte concatenation", err, string(out))
		// Fallback: byte-wise append
		masterOut, err := os.Create(masterLocalPath)
		if err != nil {
			return err
		}
		hasher := sha256.New()
		multi := io.MultiWriter(masterOut, hasher)

		for _, chunk := range chunks {
			localChunkPath := filepath.Join(scratchDir, fmt.Sprintf("chunk_%06d.webm", chunk.ChunkIndex))
			f, err := os.Open(localChunkPath)
			if err == nil {
				_, _ = io.Copy(multi, f)
				f.Close()
			}
		}
		masterOut.Close()
		checksum = hex.EncodeToString(hasher.Sum(nil))
	} else {
		// Calculate SHA-256 on FFmpeg output
		masterFile, err := os.Open(masterLocalPath)
		if err != nil {
			return err
		}
		hasher := sha256.New()
		if _, err := io.Copy(hasher, masterFile); err != nil {
			masterFile.Close()
			return err
		}
		masterFile.Close()
		checksum = hex.EncodeToString(hasher.Sum(nil))
	}

	fi, err := os.Stat(masterLocalPath)
	if err == nil {
		fileSize = fi.Size()
	}

	// Upload Master File to StorageProvider
	masterStoragePath := fmt.Sprintf("cases/%s/recordings/%s/master_verified.webm", caseID, recordingID)
	masterFile, err := os.Open(masterLocalPath)
	if err != nil {
		return err
	}
	defer masterFile.Close()

	_, err = s.storage.UploadFile(ctx, masterFile, masterStoragePath, fileSize, "video/webm")
	if err != nil {
		return fmt.Errorf("failed to upload master recording: %w", err)
	}

	// Update DB record
	s.db.Model(&models.Recording{}).Where("id = ?", recordingID).Updates(map[string]interface{}{
		"master_storage_path": masterStoragePath,
		"sha256_checksum":     checksum,
		"status":              models.RecordingReady,
		"file_size_bytes":     fileSize,
	})

	log.Printf("✅ Recording %s stitched successfully. SHA-256: %s", recordingID, checksum)
	return nil
}
