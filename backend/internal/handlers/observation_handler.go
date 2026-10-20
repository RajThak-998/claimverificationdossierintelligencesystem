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

type ObservationHandler struct {
	db *gorm.DB
}

func NewObservationHandler(db *gorm.DB) *ObservationHandler {
	return &ObservationHandler{db: db}
}

type ObservationPayload struct {
	ObservationsData models.JSONMap `json:"observations_data"`
	ConclusionData   models.JSONMap `json:"conclusion_data"`
}

func (h *ObservationHandler) GetObservations(c *gin.Context) {
	caseID := c.Param("id")

	var obs models.CaseObservation
	err := h.db.Where("case_id = ?", caseID).First(&obs).Error
	if err != nil {
		// Return empty scaffold
		var cs models.Case
		h.db.Where("id = ?", caseID).First(&cs)
		c.JSON(http.StatusOK, gin.H{
			"case_id":           caseID,
			"vehicle_class":     cs.VehicleClass,
			"observations_data": models.JSONMap{},
			"conclusion_data":   models.JSONMap{},
		})
		return
	}

	c.JSON(http.StatusOK, obs)
}

func (h *ObservationHandler) SaveDraft(c *gin.Context) {
	caseID := c.Param("id")

	var payload ObservationPayload
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload: " + err.Error()})
		return
	}

	var cs models.Case
	if err := h.db.Where("id = ?", caseID).First(&cs).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "case not found"})
		return
	}

	if cs.Status != models.StatusWorkInProgress {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("case cannot be edited in %s status", cs.Status)})
		return
	}

	var obs models.CaseObservation
	err := h.db.Where("case_id = ?", caseID).First(&obs).Error
	now := time.Now().UTC()

	if err == gorm.ErrRecordNotFound {
		obs = models.CaseObservation{
			CaseID:           caseID,
			VehicleClass:     cs.VehicleClass,
			TemplateVersion:  1,
			ObservationsData: payload.ObservationsData,
			ConclusionData:   payload.ConclusionData,
			UpdatedAt:        now,
		}
		h.db.Create(&obs)
	} else {
		// Merge or replace
		if payload.ObservationsData != nil {
			obs.ObservationsData = payload.ObservationsData
		}
		if payload.ConclusionData != nil {
			obs.ConclusionData = payload.ConclusionData
		}
		obs.UpdatedAt = now
		h.db.Save(&obs)
	}

	c.JSON(http.StatusOK, gin.H{
		"status":     "DRAFT_SAVED",
		"case_id":    caseID,
		"updated_at": now,
	})
}

func (h *ObservationHandler) SubmitAndLock(c *gin.Context) {
	caseID := c.Param("id")
	claims, _ := auth.GetUserClaims(c)

	var payload ObservationPayload
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload: " + err.Error()})
		return
	}

	var cs models.Case
	if err := h.db.Where("id = ?", caseID).First(&cs).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "case not found"})
		return
	}

	if cs.Status != models.StatusWorkInProgress {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("cannot submit case currently in %s status", cs.Status)})
		return
	}

	// 10 Compulsory Fields Validation
	var missingFields []string
	checkField := func(fieldKey, displayName string, minLen int) {
		val, exists := payload.ObservationsData[fieldKey]
		if !exists || val == nil {
			missingFields = append(missingFields, displayName)
			return
		}
		strVal := strings.TrimSpace(fmt.Sprintf("%v", val))
		if len(strVal) < minLen {
			missingFields = append(missingFields, fmt.Sprintf("%s (minimum %d characters required)", displayName, minLen))
		}
	}

	checkField("insured_version", "1. Insured Version *", 10)
	checkField("driver_version", "2. Driver Version *", 10)
	checkField("occupant_cleaner_version", "3. Pillion Rider / Cleaner Version *", 3)
	checkField("relation_with_insured", "4. Relation with Insured / Driver *", 3)
	checkField("kyc_documents", "5. KYC Documents Verified *", 3)
	checkField("profession_contacted", "6. Profession of Contacted Parties *", 3)
	checkField("hospital_injury_remarks", "7. Hospital / Injury Remarks *", 3)
	checkField("damages_garage_remarks", "8. Damages & Garage Remarks *", 5)
	checkField("social_media_news", "9. Social Media / News Remarks *", 3)
	checkField("evidences_remarks", "10. Evidences Remarks *", 3)

	// Heavy vehicle specific checks
	if cs.VehicleClass == models.VehicleHeavyCommercial {
		checkField("cleaner_statement", "Heavy Vehicle: Cleaner Statement *", 3)
		if _, exists := payload.ObservationsData["permit_validity_state"]; !exists {
			missingFields = append(missingFields, "Heavy Vehicle: Permit Validity State *")
		}
	}

	// Conclusion validation
	successTagging, _ := payload.ConclusionData["success_tagging"].(string)
	if strings.TrimSpace(successTagging) == "" {
		missingFields = append(missingFields, "Success Tagging *")
	}

	if strings.EqualFold(successTagging, "Repudiated") {
		ground, _ := payload.ConclusionData["ground_of_repudiation"].(string)
		if strings.TrimSpace(ground) == "" || strings.EqualFold(ground, "N/A") {
			missingFields = append(missingFields, "Ground of Repudiation * (Required when Repudiated is selected)")
		}
	}

	conclusion, _ := payload.ConclusionData["conclusion"].(string)
	if strings.TrimSpace(conclusion) == "" {
		missingFields = append(missingFields, "Conclusion *")
	}

	finalRemarks, _ := payload.ConclusionData["final_remarks"].(string)
	if strings.TrimSpace(finalRemarks) == "" {
		missingFields = append(missingFields, "Final Remarks *")
	}

	if len(missingFields) > 0 {
		c.JSON(http.StatusUnprocessableEntity, gin.H{
			"error":          "validation failed: all mandatory (*) fields must be completed",
			"missing_fields": missingFields,
		})
		return
	}

	now := time.Now().UTC()

	// Persist observation
	var obs models.CaseObservation
	err := h.db.Where("case_id = ?", caseID).First(&obs).Error
	if err == gorm.ErrRecordNotFound {
		obs = models.CaseObservation{
			CaseID:           caseID,
			VehicleClass:     cs.VehicleClass,
			TemplateVersion:  1,
			ObservationsData: payload.ObservationsData,
			ConclusionData:   payload.ConclusionData,
			SubmittedAt:      &now,
			UpdatedAt:        now,
		}
		h.db.Create(&obs)
	} else {
		obs.ObservationsData = payload.ObservationsData
		obs.ConclusionData = payload.ConclusionData
		obs.SubmittedAt = &now
		obs.UpdatedAt = now
		h.db.Save(&obs)
	}

	// Transition Case status to REVIEW
	cs.Status = models.StatusReview
	cs.SubmittedAt = &now
	h.db.Save(&cs)

	// Audit Log
	h.db.Create(&models.CaseAuditLog{
		CaseID:  caseID,
		ActorID: claims.UserID,
		Action:  "SUBMIT_REPORT_AND_LOCK",
		Remarks: fmt.Sprintf("Report submitted and locked for QA review by %s (%s)", claims.FullName, claims.Role),
	})

	c.JSON(http.StatusOK, gin.H{
		"case_id":    caseID,
		"status":     models.StatusReview,
		"submitted_at": now,
		"message":    "Case report validated and successfully submitted to QA Review queue",
	})
}
