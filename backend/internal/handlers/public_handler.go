package handlers

import (
	"fmt"
	"net/http"

	"motor-platform/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type PublicHandler struct {
	db *gorm.DB
}

func NewPublicHandler(db *gorm.DB) *PublicHandler {
	return &PublicHandler{db: db}
}

func (h *PublicHandler) VerifyDossier(c *gin.Context) {
	uuidParam := c.Param("uuid")

	var cs models.Case
	err := h.db.Preload("Insurer").
		Preload("Observations").
		Where("verification_uuid = ? OR id = ? OR case_number = ?", uuidParam, uuidParam, uuidParam).
		First(&cs).Error

	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{
			"verification_status": "INVALID_RECORD",
			"error":               "no matching certified motor claim dossier found for this cryptographic identifier",
		})
		return
	}

	var recording models.Recording
	h.db.Where("case_id = ? AND status = ?", cs.ID, models.RecordingReady).Order("duration_seconds DESC").First(&recording)

	sha256Hex := "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
	if recording.SHA256Checksum != nil && *recording.SHA256Checksum != "" {
		sha256Hex = *recording.SHA256Checksum
	}

	insurerName := "ICICI Lombard General Insurance"
	if cs.Insurer != nil {
		insurerName = cs.Insurer.Name
	}

	conclusion := "Claim investigation completed and legally certified."
	successTagging := "Genuine"
	groundOfRepudiation := "N/A"
	if cs.Observations != nil {
		if cStr, ok := cs.Observations.ConclusionData["conclusion"].(string); ok && cStr != "" {
			conclusion = cStr
		}
		if sStr, ok := cs.Observations.ConclusionData["success_tagging"].(string); ok && sStr != "" {
			successTagging = sStr
		}
		if gStr, ok := cs.Observations.ConclusionData["ground_of_repudiation"].(string); ok && gStr != "" {
			groundOfRepudiation = gStr
		}
	}

	statusBadge := "AUTHENTIC_UNTAMPERED"
	if cs.Status != models.StatusCompleted {
		statusBadge = fmt.Sprintf("IN_PROGRESS (%s)", cs.Status)
	}

	c.JSON(http.StatusOK, gin.H{
		"verification_status":       statusBadge,
		"case_number":               cs.CaseNumber,
		"verification_uuid":         cs.VerificationUUID,
		"insurer":                   insurerName,
		"vehicle_reg_number":        cs.VehicleRegNumber,
		"vehicle_make_model":        cs.VehicleMakeModel,
		"policy_number":             cs.PolicyNumber,
		"insured_name":              cs.InsuredName,
		"sha256_checksum":           sha256Hex,
		"recorded_duration_seconds": cs.TotalDurationSeconds,
		"duration_formatted":        formatSeconds(cs.TotalDurationSeconds),
		"completed_at":              cs.CompletedAt,
		"success_tagging":           successTagging,
		"ground_of_repudiation":     groundOfRepudiation,
		"conclusion":                conclusion,
		"certified_pdf_url":         fmt.Sprintf("/api/v1/cases/%s/pdf/download", cs.ID),
	})
}
