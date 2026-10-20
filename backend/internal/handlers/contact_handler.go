package handlers

import (
	"net/http"
	"time"

	"motor-platform/internal/auth"
	"motor-platform/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type ContactHandler struct {
	db *gorm.DB
}

func NewContactHandler(db *gorm.DB) *ContactHandler {
	return &ContactHandler{db: db}
}

type AddContactRequest struct {
	Role      models.ContactRole `json:"role" binding:"required"`
	FullName  string             `json:"full_name" binding:"required"`
	Phone     string             `json:"phone" binding:"required"`
	Address   string             `json:"address"`
	IsPrimary bool               `json:"is_primary"`
}

func (h *ContactHandler) AddContact(c *gin.Context) {
	caseID := c.Param("id")

	var req AddContactRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	contact := models.CaseContact{
		CaseID:    caseID,
		Role:      req.Role,
		FullName:  req.FullName,
		Phone:     req.Phone,
		Address:   req.Address,
		IsPrimary: req.IsPrimary,
		CreatedAt: time.Now().UTC(),
	}

	if err := h.db.Create(&contact).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to register contact"})
		return
	}

	c.JSON(http.StatusCreated, contact)
}

type LogCallRequest struct {
	ContactID   *string                `json:"contact_id"`
	Disposition models.CallDisposition `json:"disposition" binding:"required"`
	Notes       string                 `json:"notes" binding:"required"`
	RecallAt    *string                `json:"recall_at"` // ISO8601 string or empty
}

func (h *ContactHandler) LogCall(c *gin.Context) {
	caseID := c.Param("id")
	claims, _ := auth.GetUserClaims(c)

	var req LogCallRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var recallTime *time.Time
	if req.RecallAt != nil && *req.RecallAt != "" {
		if t, err := time.Parse(time.RFC3339, *req.RecallAt); err == nil {
			utc := t.UTC()
			recallTime = &utc
		}
	}

	callLog := models.CallLog{
		CaseID:      caseID,
		ContactID:   req.ContactID,
		AgentID:     claims.UserID,
		Disposition: req.Disposition,
		Notes:       req.Notes,
		RecallAt:    recallTime,
		CreatedAt:   time.Now().UTC(),
	}

	if err := h.db.Create(&callLog).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to log call"})
		return
	}

	c.JSON(http.StatusCreated, callLog)
}

func (h *ContactHandler) GetDueRecalls(c *gin.Context) {
	claims, exists := auth.GetUserClaims(c)
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	now := time.Now().UTC()
	window := now.Add(2 * time.Hour) // recalls due now or within next 2 hours

	query := h.db.Model(&models.CallLog{}).
		Preload("Contact").
		Preload("Agent").
		Where("recall_at IS NOT NULL AND recall_at <= ?", window)

	if claims.Role == models.RoleAgent {
		query = query.Where("agent_id = ?", claims.UserID)
	}

	var dueLogs []models.CallLog
	query.Order("recall_at ASC").Find(&dueLogs)

	type DueRecallResponse struct {
		CallLogID   string                 `json:"call_log_id"`
		CaseID      string                 `json:"case_id"`
		CaseNumber  string                 `json:"case_number"`
		VehicleReg  string                 `json:"vehicle_reg_number"`
		ContactName string                 `json:"contact_name"`
		ContactPhone string                `json:"contact_phone"`
		Disposition models.CallDisposition `json:"disposition"`
		Notes       string                 `json:"notes"`
		RecallAt    time.Time              `json:"recall_at"`
		IsOverdue   bool                   `json:"is_overdue"`
	}

	var results []DueRecallResponse
	for _, l := range dueLogs {
		var cs models.Case
		h.db.Select("case_number, vehicle_reg_number").Where("id = ?", l.CaseID).First(&cs)

		contactName := "General Contact"
		contactPhone := ""
		if l.Contact != nil {
			contactName = l.Contact.FullName
			contactPhone = l.Contact.Phone
		}

		isOverdue := false
		if l.RecallAt != nil && l.RecallAt.Before(now) {
			isOverdue = true
		}

		results = append(results, DueRecallResponse{
			CallLogID:    l.ID,
			CaseID:       l.CaseID,
			CaseNumber:   cs.CaseNumber,
			VehicleReg:   cs.VehicleRegNumber,
			ContactName:  contactName,
			ContactPhone: contactPhone,
			Disposition:  l.Disposition,
			Notes:        l.Notes,
			RecallAt:     *l.RecallAt,
			IsOverdue:    isOverdue,
		})
	}

	c.JSON(http.StatusOK, results)
}
