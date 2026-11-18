package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"motor-platform/internal/auth"
	"motor-platform/internal/config"
	"motor-platform/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type ObservationHandler struct {
	db  *gorm.DB
	cfg *config.Config
}

func NewObservationHandler(db *gorm.DB, cfg *config.Config) *ObservationHandler {
	return &ObservationHandler{db: db, cfg: cfg}
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

type ImproveAIRequest struct {
	Fields map[string]string `json:"fields"`
}

type ImproveAIResponse struct {
	Fields map[string]string `json:"fields"`
}

func (h *ObservationHandler) ImproveWithAI(c *gin.Context) {
	var req ImproveAIRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload: " + err.Error()})
		return
	}

	// Filter out empty fields
	nonEmptyFields := make(map[string]string)
	for k, v := range req.Fields {
		trimmed := strings.TrimSpace(v)
		if trimmed != "" {
			nonEmptyFields[k] = trimmed
		}
	}

	if len(nonEmptyFields) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no observation text provided to improve"})
		return
	}

	apiKey := ""
	if h.cfg != nil {
		apiKey = strings.TrimSpace(h.cfg.AIAPIKey)
	}
	if apiKey == "" {
		apiKey = strings.TrimSpace(os.Getenv("AI_API_KEY"))
	}
	if apiKey == "" {
		apiKey = strings.TrimSpace(os.Getenv("OPENROUTER_API_KEY"))
	}

	if apiKey == "" {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error": "AI service is not configured (AI_API_KEY or OPENROUTER_API_KEY missing)",
		})
		return
	}

	baseURL := "https://openrouter.ai/api/v1"
	model := "openai/gpt-4o-mini"
	if h.cfg != nil {
		if h.cfg.AIBaseURL != "" {
			baseURL = strings.TrimRight(h.cfg.AIBaseURL, "/")
		}
		if h.cfg.AIModel != "" {
			model = h.cfg.AIModel
		}
	}

	systemPrompt := `You are an expert insurance fraud investigator and editor for motor claims verification dossiers.
Your ONLY task is to improve the grammar, spelling, phrasing, and overall presentation of the investigator's field notes into formal, clear, and legally defensible English.

C
3. DO NOT add any unsolicited recommendations, disclaimers, explanations, or introductory/closing commentary.RITICAL RULES:
1. STRICTLY PRESERVE 100% OF THE FACTUAL MEANING AND INTENT.
2. DO NOT change, alter, hallucinate, extrapolate, or invent ANY facts, names, phone numbers, vehicle registration numbers, speeds, timestamps, locations, damage descriptions, or conclusions.
4. Output ONLY a valid JSON object matching the exact input keys, where each value is the corresponding improved text.`

	inputBytes, err := json.Marshal(nonEmptyFields)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to encode fields: " + err.Error()})
		return
	}

	aiReqBody := map[string]interface{}{
		"model": model,
		"messages": []map[string]string{
			{"role": "system", "content": systemPrompt},
			{"role": "user", "content": string(inputBytes)},
		},
		"response_format": map[string]string{"type": "json_object"},
		"temperature":     0.1,
		"max_tokens":      2000,
	}

	reqPayloadBytes, err := json.Marshal(aiReqBody)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to prepare AI request: " + err.Error()})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 25*time.Second)
	defer cancel()

	endpointURL := fmt.Sprintf("%s/chat/completions", baseURL)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpointURL, bytes.NewReader(reqPayloadBytes))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create HTTP request: " + err.Error()})
		return
	}

	httpReq.Header.Set("Authorization", fmt.Sprintf("Bearer %s", apiKey))
	httpReq.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 25 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "failed to communicate with AI API: " + err.Error()})
		return
	}
	defer resp.Body.Close()

	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "failed to read AI API response: " + err.Error()})
		return
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		c.JSON(http.StatusBadGateway, gin.H{
			"error": fmt.Sprintf("AI API returned status %d: %s", resp.StatusCode, string(respBytes)),
		})
		return
	}

	var chatResp struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
	}

	if err := json.Unmarshal(respBytes, &chatResp); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "failed to parse AI API response JSON: " + err.Error()})
		return
	}

	if chatResp.Error != nil && chatResp.Error.Message != "" {
		c.JSON(http.StatusBadGateway, gin.H{"error": "AI API error: " + chatResp.Error.Message})
		return
	}

	if len(chatResp.Choices) == 0 {
		c.JSON(http.StatusBadGateway, gin.H{"error": "empty choices returned from AI API"})
		return
	}

	content := strings.TrimSpace(chatResp.Choices[0].Message.Content)
	if strings.HasPrefix(content, "```") {
		lines := strings.Split(content, "\n")
		if len(lines) >= 2 {
			lines = lines[1:]
			if len(lines) > 0 && strings.HasPrefix(strings.TrimSpace(lines[len(lines)-1]), "```") {
				lines = lines[:len(lines)-1]
			}
			content = strings.Join(lines, "\n")
		}
	}

	var improvedFields map[string]string
	if err := json.Unmarshal([]byte(content), &improvedFields); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{
			"error":       "failed to decode structured JSON from AI output: " + err.Error(),
			"raw_content": content,
		})
		return
	}

	c.JSON(http.StatusOK, ImproveAIResponse{
		Fields: improvedFields,
	})
}
