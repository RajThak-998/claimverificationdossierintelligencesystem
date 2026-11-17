package handlers

import (
	"encoding/csv"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"strconv"
	"strings"
	"time"

	"motor-platform/internal/auth"
	"motor-platform/internal/models"

	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

type CaseHandler struct {
	db *gorm.DB
}

func NewCaseHandler(db *gorm.DB) *CaseHandler {
	return &CaseHandler{db: db}
}

type CaseResponseItem struct {
	ID                   string                 `json:"id"`
	CaseNumber           string                 `json:"case_number"`
	InsurerID            string                 `json:"insurer_id"`
	InsurerName          string                 `json:"insurer_name"`
	AssignedAgentID      *string                `json:"assigned_agent_id"`
	AssignedAgentName    string                 `json:"assigned_agent_name"`
	AssignedAgentActive  int64                  `json:"assigned_agent_active_cases"`
	Status               models.CaseStatus      `json:"status"`
	VehicleClass         models.VehicleCategory `json:"vehicle_class"`
	ClaimType            models.ClaimCategory   `json:"claim_type"`
	PolicyNumber         string                 `json:"policy_number"`
	PolicyStartDate      *time.Time             `json:"policy_start_date"`
	VehicleRegNumber     string                 `json:"vehicle_reg_number"`
	AccusedVehicleNumber *string                `json:"accused_vehicle_number"`
	InsuredName          string                 `json:"insured_name"`
	InsuredPrimaryPhone  string                 `json:"insured_primary_phone"`
	VehicleMakeModel     string                 `json:"vehicle_make_model"`
	ClaimAmount          decimal.Decimal        `json:"claim_amount"`
	State                string                 `json:"state"`
	District             string                 `json:"district"`
	AccidentDate         *time.Time             `json:"accident_date"`
	IntimationDate       *time.Time             `json:"intimation_date"`
	CauseOfLoss          string                 `json:"cause_of_loss"`
	TriggerNarrative     string                 `json:"insurer_trigger_narrative"`
	IsReassigned         bool                   `json:"is_reassigned"`
	ReworkCount          int                    `json:"rework_count"`
	AgingDays            int                    `json:"aging_days"`
	TotalDurationSeconds int                    `json:"total_duration_seconds"`
	DurationFormatted    string                 `json:"duration_formatted"`
	VerificationUUID     string                 `json:"verification_uuid"`
	LockedPDFPath        *string                `json:"locked_pdf_path"`
	CreatedAt            time.Time              `json:"created_at"`
	Contacts             []models.CaseContact   `json:"contacts"`
}

func formatSeconds(sec int) string {
	m := sec / 60
	s := sec % 60
	return fmt.Sprintf("%dM %dS", m, s)
}

func (h *CaseHandler) ListCases(c *gin.Context) {
	claims, exists := auth.GetUserClaims(c)
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	query := h.db.Model(&models.Case{}).Preload("Insurer").Preload("AssignedAgent").Preload("Contacts")

	// Role-Based Row-Level Access Isolation
	switch claims.Role {
	case models.RoleAdmin:
		// Global access
	case models.RoleManager:
		// Manager sees all cases
	case models.RoleAgent:
		// Investigator sees assigned cases only
		query = query.Where("assigned_agent_id = ?", claims.UserID)
	case models.RoleInsurer:
		// Client insurer sees only their completed cases
		if claims.InsurerID != nil {
			query = query.Where("insurer_id = ? AND status = ?", *claims.InsurerID, models.StatusCompleted)
		} else {
			c.JSON(http.StatusForbidden, gin.H{"error": "no insurer tenant associated with this account"})
			return
		}
	}

	// Filter parameters
	if status := c.Query("status"); status != "" {
		query = query.Where("status = ?", status)
	}
	if vClass := c.Query("vehicle_class"); vClass != "" {
		query = query.Where("vehicle_class = ?", vClass)
	}
	if claimType := c.Query("claim_type"); claimType != "" {
		query = query.Where("claim_type = ?", claimType)
	}
	if c.Query("reassigned_only") == "true" {
		query = query.Where("is_reassigned = true")
	}
	if search := strings.TrimSpace(c.Query("search")); search != "" {
		likePattern := "%" + search + "%"
		query = query.Where("case_number LIKE ? OR vehicle_reg_number LIKE ? OR insured_name LIKE ? OR insured_primary_phone LIKE ? OR policy_number LIKE ?",
			likePattern, likePattern, likePattern, likePattern, likePattern)
	}

	// Counts by status (for filter tabs)
	type StatusCount struct {
		Status string `json:"status"`
		Count  int64  `json:"count"`
	}
	var counts []StatusCount
	countQuery := h.db.Model(&models.Case{})
	if claims.Role == models.RoleAgent {
		countQuery = countQuery.Where("assigned_agent_id = ?", claims.UserID)
	} else if claims.Role == models.RoleInsurer && claims.InsurerID != nil {
		countQuery = countQuery.Where("insurer_id = ? AND status = ?", *claims.InsurerID, models.StatusCompleted)
	}
	countQuery.Select("status, count(*) as count").Group("status").Scan(&counts)

	statusMap := make(map[string]int64)
	var totalCount int64
	for _, sc := range counts {
		statusMap[sc.Status] = sc.Count
		totalCount += sc.Count
	}

	// Pagination
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "25"))
	if page < 1 {
		page = 1
	}
	if limit < 1 || limit > 100 {
		limit = 25
	}
	offset := (page - 1) * limit

	var totalFiltered int64
	query.Count(&totalFiltered)

	var cases []models.Case
	if err := query.Order("created_at DESC").Offset(offset).Limit(limit).Find(&cases).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to query cases"})
		return
	}

	responseItems := make([]CaseResponseItem, 0)
	for _, cs := range cases {
		insurerName := ""
		if cs.Insurer != nil {
			insurerName = cs.Insurer.Name
		}
		agentName := "Unassigned"
		var agentActive int64
		if cs.AssignedAgent != nil {
			agentName = cs.AssignedAgent.FullName
			h.db.Model(&models.Case{}).Where("assigned_agent_id = ? AND status IN (?, ?)", cs.AssignedAgent.ID, models.StatusWorkInProgress, models.StatusReview).Count(&agentActive)
		}

		agingDays := int(time.Since(cs.CreatedAt).Hours() / 24)

		responseItems = append(responseItems, CaseResponseItem{
			ID:                   cs.ID,
			CaseNumber:           cs.CaseNumber,
			InsurerID:            cs.InsurerID,
			InsurerName:          insurerName,
			AssignedAgentID:      cs.AssignedAgentID,
			AssignedAgentName:    agentName,
			AssignedAgentActive:  agentActive,
			Status:               cs.Status,
			VehicleClass:         cs.VehicleClass,
			ClaimType:            cs.ClaimType,
			PolicyNumber:         cs.PolicyNumber,
			PolicyStartDate:      cs.PolicyStartDate,
			VehicleRegNumber:     cs.VehicleRegNumber,
			AccusedVehicleNumber: cs.AccusedVehicleNumber,
			InsuredName:          cs.InsuredName,
			InsuredPrimaryPhone:  cs.InsuredPrimaryPhone,
			VehicleMakeModel:     cs.VehicleMakeModel,
			ClaimAmount:          cs.ClaimAmount,
			State:                cs.State,
			District:             cs.District,
			AccidentDate:         cs.AccidentDate,
			IntimationDate:       cs.IntimationDate,
			CauseOfLoss:          cs.CauseOfLoss,
			TriggerNarrative:     cs.InsurerTriggerNarrative,
			IsReassigned:         cs.IsReassigned,
			ReworkCount:          cs.ReworkCount,
			AgingDays:            agingDays,
			TotalDurationSeconds: cs.TotalDurationSeconds,
			DurationFormatted:    formatSeconds(cs.TotalDurationSeconds),
			VerificationUUID:     cs.VerificationUUID,
			LockedPDFPath:        cs.LockedPDFPath,
			CreatedAt:            cs.CreatedAt,
			Contacts:             cs.Contacts,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"data": responseItems,
		"counts": gin.H{
			"total":            totalCount,
			"unassigned":       statusMap[string(models.StatusUnassigned)],
			"work_in_progress": statusMap[string(models.StatusWorkInProgress)],
			"review":           statusMap[string(models.StatusReview)],
			"completed":        statusMap[string(models.StatusCompleted)],
			"admin_sign_off":   statusMap[string(models.StatusAdminSignOff)],
		},
		"pagination": gin.H{
			"page":          page,
			"limit":         limit,
			"total_records": totalFiltered,
			"total_pages":   (totalFiltered + int64(limit) - 1) / int64(limit),
		},
	})
}

func (h *CaseHandler) GetCase(c *gin.Context) {
	id := c.Param("id")
	claims, exists := auth.GetUserClaims(c)
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var cs models.Case
	err := h.db.Preload("Insurer").
		Preload("AssignedAgent").
		Preload("Contacts").
		Preload("Observations").
		Where("id = ? OR case_number = ?", id, id).
		First(&cs).Error

	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "case not found"})
		return
	}

	// RBAC validation
	if claims.Role == models.RoleAgent && (cs.AssignedAgentID == nil || *cs.AssignedAgentID != claims.UserID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden: you are not assigned to this case"})
		return
	}
	if claims.Role == models.RoleInsurer && (claims.InsurerID == nil || cs.InsurerID != *claims.InsurerID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden: this claim belongs to another insurer"})
		return
	}

	// Load sub-resources: Call logs, Recordings, Documents, Screenshots, Audit logs
	var callLogs []models.CallLog
	h.db.Preload("Agent").Preload("Contact").Where("case_id = ?", cs.ID).Order("created_at DESC").Find(&callLogs)

	var recordings []models.Recording
	h.db.Preload("Chunks").Where("case_id = ?", cs.ID).Order("created_at DESC").Find(&recordings)

	var documents []models.CaseDocument
	h.db.Where("case_id = ?", cs.ID).Order("created_at DESC").Find(&documents)

	var screenshots []models.CaseScreenshot
	h.db.Where("case_id = ?", cs.ID).Order("timestamp_offset_seconds ASC, created_at DESC").Find(&screenshots)

	var auditLogs []models.CaseAuditLog
	h.db.Preload("Actor").Where("case_id = ?", cs.ID).Order("created_at DESC").Find(&auditLogs)

	var billing models.BillingLedger
	h.db.Where("case_id = ?", cs.ID).First(&billing)

	c.JSON(http.StatusOK, gin.H{
		"case":        cs,
		"call_logs":   callLogs,
		"recordings":  recordings,
		"documents":   documents,
		"screenshots": screenshots,
		"audit_logs":  auditLogs,
		"billing":     billing,
	})
}

type CreateCaseRequest struct {
	CaseNumber           string                 `json:"case_number"`
	InsurerID            string                 `json:"insurer_id" binding:"required"`
	AssignedAgentID      *string                `json:"assigned_agent_id"`
	VehicleClass         models.VehicleCategory `json:"vehicle_class" binding:"required"`
	ClaimType            models.ClaimCategory   `json:"claim_type" binding:"required"`
	PolicyNumber         string                 `json:"policy_number" binding:"required"`
	PolicyStartDate      *string                `json:"policy_start_date"`
	VehicleRegNumber     string                 `json:"vehicle_reg_number" binding:"required"`
	AccusedVehicleNumber *string                `json:"accused_vehicle_number"`
	InsuredName          string                 `json:"insured_name" binding:"required"`
	InsuredPrimaryPhone  string                 `json:"insured_primary_phone" binding:"required"`
	VehicleMakeModel     string                 `json:"vehicle_make_model"`
	ClaimAmount          float64                `json:"claim_amount"`
	State                string                 `json:"state" binding:"required"`
	District             string                 `json:"district" binding:"required"`
	CauseOfLoss          string                 `json:"cause_of_loss"`
	TriggerNarrative     string                 `json:"insurer_trigger_narrative"`
}

func (h *CaseHandler) CreateCase(c *gin.Context) {
	claims, _ := auth.GetUserClaims(c)

	var req CreateCaseRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	caseNum := req.CaseNumber
	if caseNum == "" {
		caseNum = fmt.Sprintf("MOT%08d", rand.Intn(99999999))
	}

	status := models.StatusUnassigned
	var assignedAt *time.Time
	if req.AssignedAgentID != nil && *req.AssignedAgentID != "" {
		status = models.StatusWorkInProgress
		t := time.Now().UTC()
		assignedAt = &t
	}

	var policyDate *time.Time
	if req.PolicyStartDate != nil && *req.PolicyStartDate != "" {
		if t, err := time.Parse("2006-01-02", *req.PolicyStartDate); err == nil {
			policyDate = &t
		}
	}

	newCase := models.Case{
		CaseNumber:              caseNum,
		InsurerID:               req.InsurerID,
		AssignedAgentID:         req.AssignedAgentID,
		Status:                  status,
		VehicleClass:            req.VehicleClass,
		ClaimType:               req.ClaimType,
		PolicyNumber:            req.PolicyNumber,
		PolicyStartDate:         policyDate,
		VehicleRegNumber:        strings.ToUpper(strings.TrimSpace(req.VehicleRegNumber)),
		AccusedVehicleNumber:    req.AccusedVehicleNumber,
		InsuredName:             req.InsuredName,
		InsuredPrimaryPhone:     req.InsuredPrimaryPhone,
		VehicleMakeModel:        req.VehicleMakeModel,
		ClaimAmount:             decimal.NewFromFloat(req.ClaimAmount),
		State:                   req.State,
		District:                req.District,
		CauseOfLoss:             req.CauseOfLoss,
		InsurerTriggerNarrative: req.TriggerNarrative,
		AssignedAt:              assignedAt,
	}

	if err := h.db.Create(&newCase).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create case: " + err.Error()})
		return
	}

	// Auto-register primary insured contact
	h.db.Create(&models.CaseContact{
		CaseID:    newCase.ID,
		Role:      models.ContactInsured,
		FullName:  req.InsuredName,
		Phone:     req.InsuredPrimaryPhone,
		IsPrimary: true,
	})

	// Log audit
	h.db.Create(&models.CaseAuditLog{
		CaseID:  newCase.ID,
		ActorID: claims.UserID,
		Action:  "CASE_CREATED",
		Remarks: fmt.Sprintf("Case %s created via direct addition", newCase.CaseNumber),
	})

	c.JSON(http.StatusCreated, newCase)
}

type AssignAgentRequest struct {
	AgentID            string `json:"agent_id" binding:"required"`
	ReassignmentReason string `json:"reassignment_reason"`
}

func (h *CaseHandler) AssignAgent(c *gin.Context) {
	caseID := c.Param("id")
	claims, _ := auth.GetUserClaims(c)

	var req AssignAgentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var cs models.Case
	if err := h.db.Where("id = ?", caseID).First(&cs).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "case not found"})
		return
	}

	var newAgent models.User
	if err := h.db.Where("id = ? AND role = ?", req.AgentID, models.RoleAgent).First(&newAgent).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid agent id"})
		return
	}

	isReassigned := cs.AssignedAgentID != nil && *cs.AssignedAgentID != req.AgentID
	now := time.Now().UTC()

	cs.AssignedAgentID = &req.AgentID
	cs.AssignedAt = &now
	if cs.Status == models.StatusUnassigned {
		cs.Status = models.StatusWorkInProgress
	}
	if isReassigned {
		cs.IsReassigned = true
	}

	h.db.Save(&cs)

	// Log audit
	remarks := fmt.Sprintf("Assigned to %s", newAgent.FullName)
	if isReassigned {
		remarks = fmt.Sprintf("Reassigned to %s. Reason: %s", newAgent.FullName, req.ReassignmentReason)
	}

	h.db.Create(&models.CaseAuditLog{
		CaseID:  cs.ID,
		ActorID: claims.UserID,
		Action:  "AGENT_ASSIGNED",
		Remarks: remarks,
	})

	c.JSON(http.StatusOK, gin.H{
		"status":        "success",
		"case_id":       cs.ID,
		"assigned_agent": newAgent.FullName,
		"case_status":   cs.Status,
		"is_reassigned": cs.IsReassigned,
	})
}

func (h *CaseHandler) BulkImport(c *gin.Context) {
	claims, _ := auth.GetUserClaims(c)

	fileHeader, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing csv file"})
		return
	}

	file, err := fileHeader.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "cannot open uploaded file"})
		return
	}
	defer file.Close()

	reader := csv.NewReader(file)
	headers, err := reader.Read()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid CSV file format"})
		return
	}

	headerMap := make(map[string]int)
	for idx, hName := range headers {
		clean := strings.ToLower(strings.TrimSpace(hName))
		clean = strings.ReplaceAll(clean, " ", "_")
		headerMap[clean] = idx
	}

	// Fetch default insurer
	var defaultInsurer models.Insurer
	h.db.First(&defaultInsurer)

	importedCount := 0
	var failedRows []string
	rowNum := 1

	for {
		record, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			failedRows = append(failedRows, fmt.Sprintf("Row %d: read error", rowNum))
			rowNum++
			continue
		}
		rowNum++

		getCol := func(key string) string {
			if idx, ok := headerMap[key]; ok && idx < len(record) {
				return strings.TrimSpace(record[idx])
			}
			return ""
		}

		caseNum := getCol("case_number")
		if caseNum == "" {
			caseNum = fmt.Sprintf("MOT%08d", rand.Intn(99999999))
		}

		regNum := strings.ToUpper(getCol("vehicle_reg_number"))
		if regNum == "" {
			failedRows = append(failedRows, fmt.Sprintf("Row %d: missing vehicle_reg_number", rowNum))
			continue
		}

		insuredName := getCol("insured_name")
		if insuredName == "" {
			insuredName = "Unknown Insured"
		}
		phone := getCol("insured_primary_phone")
		if phone == "" {
			phone = "+910000000000"
		}

		vClass := models.VehicleLMV
		if strings.Contains(strings.ToUpper(getCol("vehicle_class")), "HEAVY") || strings.Contains(strings.ToUpper(getCol("vehicle_class")), "COMMERCIAL") {
			vClass = models.VehicleHeavyCommercial
		}

		claimType := models.ClaimOD
		if ct := strings.ToUpper(getCol("claim_type")); ct == "TP" || ct == "IBNR" || ct == "281" {
			claimType = models.ClaimCategory(ct)
		}

		state := getCol("state")
		if state == "" {
			state = "Maharashtra"
		}
		district := getCol("district")
		if district == "" {
			district = "Mumbai"
		}

		policyNum := getCol("policy_number")
		if policyNum == "" {
			policyNum = fmt.Sprintf("POL-%06d", rand.Intn(999999))
		}

		amount, _ := strconv.ParseFloat(getCol("claim_amount"), 64)

		newCase := models.Case{
			CaseNumber:              caseNum,
			InsurerID:               defaultInsurer.ID,
			Status:                  models.StatusUnassigned,
			VehicleClass:            vClass,
			ClaimType:               claimType,
			PolicyNumber:            policyNum,
			VehicleRegNumber:        regNum,
			InsuredName:             insuredName,
			InsuredPrimaryPhone:     phone,
			VehicleMakeModel:        getCol("vehicle_make_model"),
			ClaimAmount:             decimal.NewFromFloat(amount),
			State:                   state,
			District:                district,
			CauseOfLoss:             getCol("cause_of_loss"),
			InsurerTriggerNarrative: getCol("insurer_trigger_narrative"),
		}

		if err := h.db.Create(&newCase).Error; err == nil {
			importedCount++
			h.db.Create(&models.CaseContact{
				CaseID:    newCase.ID,
				Role:      models.ContactInsured,
				FullName:  insuredName,
				Phone:     phone,
				IsPrimary: true,
			})
		} else {
			failedRows = append(failedRows, fmt.Sprintf("Row %d: %v", rowNum, err))
		}
	}

	// Audit log
	if claims != nil {
		h.db.Create(&models.CaseAuditLog{
			CaseID:  defaultInsurer.ID,
			ActorID: claims.UserID,
			Action:  "BULK_IMPORT",
			Remarks: fmt.Sprintf("Imported %d cases from file %s", importedCount, fileHeader.Filename),
		})
	}

	c.JSON(http.StatusCreated, gin.H{
		"imported_count": importedCount,
		"failed_rows":    failedRows,
	})
}

func (h *CaseHandler) DownloadTemplateCSV(c *gin.Context) {
	c.Header("Content-Disposition", "attachment; filename=motor_cases_import_template.csv")
	c.Header("Content-Type", "text/csv")

	writer := csv.NewWriter(c.Writer)
	_ = writer.Write([]string{
		"case_number",
		"vehicle_reg_number",
		"insured_name",
		"insured_primary_phone",
		"vehicle_class",
		"claim_type",
		"policy_number",
		"vehicle_make_model",
		"claim_amount",
		"state",
		"district",
		"cause_of_loss",
		"insurer_trigger_narrative",
	})
	_ = writer.Write([]string{
		"MOT18229999",
		"MH-02-XY-9876",
		"Sunil Transport Services",
		"+919876543210",
		"HEAVY_VEHICLE",
		"OD",
		"POL-ICICI-88120",
		"BharatBenz 2823C",
		"420000",
		"Maharashtra",
		"Thane",
		"Underpass clearance collision",
		"Verify loading height and check driver intoxication.",
	})
	writer.Flush()
}
