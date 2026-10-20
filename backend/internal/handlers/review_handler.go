package handlers

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"motor-platform/internal/auth"
	"motor-platform/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type ReviewHandler struct {
	db             *gorm.DB
	asyncCompleter func(caseID string) error
}

func NewReviewHandler(db *gorm.DB, completer func(caseID string) error) *ReviewHandler {
	return &ReviewHandler{db: db, asyncCompleter: completer}
}

func (h *ReviewHandler) ApproveReview(c *gin.Context) {
	caseID := c.Param("id")
	claims, _ := auth.GetUserClaims(c)

	var cs models.Case
	if err := h.db.Where("id = ?", caseID).First(&cs).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "case not found"})
		return
	}

	if cs.Status != models.StatusReview {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("case cannot be approved from %s status", cs.Status)})
		return
	}

	cs.Status = models.StatusAdminSignOff
	h.db.Save(&cs)

	h.db.Create(&models.CaseAuditLog{
		CaseID:  caseID,
		ActorID: claims.UserID,
		Action:  "QA_APPROVED",
		Remarks: fmt.Sprintf("Approved by QA Manager %s; passed to Admin Sign-Off", claims.FullName),
	})

	c.JSON(http.StatusOK, gin.H{
		"case_id": cs.ID,
		"status":  cs.Status,
		"message": "QA Review approved. Case advanced to Commercial Admin Sign-Off",
	})
}

type RejectReviewRequest struct {
	RejectionRemarks string `json:"rejection_remarks" binding:"required"`
}

func (h *ReviewHandler) RejectReview(c *gin.Context) {
	caseID := c.Param("id")
	claims, _ := auth.GetUserClaims(c)

	var req RejectReviewRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "compulsory rejection remarks required"})
		return
	}

	remarks := strings.TrimSpace(req.RejectionRemarks)
	if remarks == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "compulsory rejection remarks required"})
		return
	}

	var cs models.Case
	if err := h.db.Where("id = ?", caseID).First(&cs).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "case not found"})
		return
	}

	if cs.Status != models.StatusReview && cs.Status != models.StatusAdminSignOff {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("case cannot be rejected from %s status", cs.Status)})
		return
	}

	cs.Status = models.StatusWorkInProgress
	cs.ReworkCount++
	h.db.Save(&cs)

	h.db.Create(&models.CaseAuditLog{
		CaseID:  caseID,
		ActorID: claims.UserID,
		Action:  "REJECTED_TO_WIP",
		Remarks: fmt.Sprintf("QA Deficiency Flagged by %s: %s", claims.FullName, remarks),
	})

	// Also log into call notes / timeline for the agent
	h.db.Create(&models.CallLog{
		CaseID:      caseID,
		AgentID:     claims.UserID,
		Disposition: models.DispGeneralNote,
		Notes:       fmt.Sprintf("⚠️ QA REWORK REQUIRED: %s", remarks),
	})

	c.JSON(http.StatusOK, gin.H{
		"case_id":      cs.ID,
		"status":       cs.Status,
		"rework_count": cs.ReworkCount,
		"message":      "Case returned to Work in Progress for investigator rework",
	})
}

func (h *ReviewHandler) AdminSignOff(c *gin.Context) {
	caseID := c.Param("id")
	claims, _ := auth.GetUserClaims(c)

	var cs models.Case
	if err := h.db.Where("id = ?", caseID).First(&cs).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "case not found"})
		return
	}

	now := time.Now().UTC()
	cs.Status = models.StatusCompleted
	cs.CompletedAt = &now
	h.db.Save(&cs)

	h.db.Create(&models.CaseAuditLog{
		CaseID:  caseID,
		ActorID: claims.UserID,
		Action:  "ADMIN_SIGN_OFF_COMPLETED",
		Remarks: fmt.Sprintf("Final commercial sign-off executed by %s. Vault locked.", claims.FullName),
	})

	// Dispatch background worker for video stitching, hashing, PDF generation, and billing ledger
	if h.asyncCompleter != nil {
		go func() {
			_ = h.asyncCompleter(caseID)
		}()
	}

	// Pillar 3: Decouple via 202 Accepted
	c.JSON(http.StatusAccepted, gin.H{
		"status":       "ACCEPTED",
		"case_id":      cs.ID,
		"case_status":  cs.Status,
		"completed_at": cs.CompletedAt,
		"message":      "Case sign-off executed. Asynchronous video hashing and certified PDF dossier generation enqueued.",
	})
}
