package handlers

import (
	"net/http"

	"motor-platform/internal/auth"
	"motor-platform/internal/models"

	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

type BillingHandler struct {
	db *gorm.DB
}

func NewBillingHandler(db *gorm.DB) *BillingHandler {
	return &BillingHandler{db: db}
}

func (h *BillingHandler) GetMetrics(c *gin.Context) {
	claims, exists := auth.GetUserClaims(c)
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var insurers []models.Insurer
	if claims.Role == models.RoleInsurer && claims.InsurerID != nil {
		h.db.Where("id = ?", *claims.InsurerID).Find(&insurers)
	} else {
		h.db.Find(&insurers)
	}

	type InsurerBreakdown struct {
		InsurerID          string          `json:"insurer_id"`
		InsurerName        string          `json:"insurer_name"`
		TotalCases         int64           `json:"total_cases"`
		TotalSeconds       int64           `json:"total_seconds"`
		TotalTimeFormatted string          `json:"total_time_formatted"`
		BillableMinutes    int64           `json:"billable_minutes"`
		RatePerMinuteINR   decimal.Decimal `json:"rate_per_minute_inr"`
		TotalBilledINR     decimal.Decimal `json:"total_billed_inr"`
	}

	var breakdowns []InsurerBreakdown
	var totalBillableMinutes int64
	var totalSeconds int64
	grossBilled := decimal.NewFromInt(0)
	var completedCasesCount int64

	for _, ins := range insurers {
		var cases []models.Case
		h.db.Where("insurer_id = ? AND status = ?", ins.ID, models.StatusCompleted).Find(&cases)

		var insSec int64
		var insBillableMins int64
		insBilled := decimal.NewFromInt(0)

		for _, cs := range cases {
			insSec += int64(cs.TotalDurationSeconds)
			var bl models.BillingLedger
			if err := h.db.Where("case_id = ?", cs.ID).First(&bl).Error; err == nil {
				insBillableMins += int64(bl.BillableMinutes)
				insBilled = insBilled.Add(bl.TotalBilledINR)
			} else {
				// Calculate if not yet in ledger
				bm := int64((cs.TotalDurationSeconds + 59) / 60)
				if bm == 0 && cs.TotalDurationSeconds > 0 {
					bm = 1
				}
				insBillableMins += bm
				amt := ins.PerMinuteRateINR.Mul(decimal.NewFromInt(bm)).Add(decimal.NewFromFloat(750.00))
				insBilled = insBilled.Add(amt)
			}
		}

		breakdowns = append(breakdowns, InsurerBreakdown{
			InsurerID:          ins.ID,
			InsurerName:        ins.Name,
			TotalCases:         int64(len(cases)),
			TotalSeconds:       insSec,
			TotalTimeFormatted: formatSeconds(int(insSec)),
			BillableMinutes:    insBillableMins,
			RatePerMinuteINR:   ins.PerMinuteRateINR,
			TotalBilledINR:     insBilled,
		})

		totalBillableMinutes += insBillableMins
		totalSeconds += insSec
		grossBilled = grossBilled.Add(insBilled)
		completedCasesCount += int64(len(cases))
	}

	avgSeconds := int64(0)
	if completedCasesCount > 0 {
		avgSeconds = totalSeconds / completedCasesCount
	}

	c.JSON(http.StatusOK, gin.H{
		"total_billable_minutes": totalBillableMinutes,
		"gross_billed_inr":       grossBilled,
		"completed_cases_count":  completedCasesCount,
		"avg_call_duration":      formatSeconds(int(avgSeconds)),
		"insurers_breakdown":     breakdowns,
	})
}

func (h *BillingHandler) GetLedger(c *gin.Context) {
	claims, exists := auth.GetUserClaims(c)
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	query := h.db.Model(&models.BillingLedger{}).Preload("Case").Preload("Insurer")

	if claims.Role == models.RoleInsurer && claims.InsurerID != nil {
		query = query.Where("insurer_id = ?", *claims.InsurerID)
	}

	var items []models.BillingLedger
	if err := query.Order("created_at DESC").Find(&items).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to query ledger"})
		return
	}

	type LedgerResponseItem struct {
		ID                   string          `json:"id"`
		CaseID               string          `json:"case_id"`
		CaseNumber           string          `json:"case_number"`
		InsurerName          string          `json:"insurer_name"`
		VehicleRegNumber     string          `json:"vehicle_reg_number"`
		InsuredName          string          `json:"insured_name"`
		RecordingDurationSec int             `json:"recording_duration_seconds"`
		DurationFormatted    string          `json:"duration_formatted"`
		BillableMinutes      int             `json:"billable_minutes"`
		RatePerMinuteINR     decimal.Decimal `json:"rate_per_minute_inr"`
		BaseFeeINR           decimal.Decimal `json:"base_fee_inr"`
		TotalBilledINR       decimal.Decimal `json:"total_billed_inr"`
		InvoiceReference     string          `json:"invoice_reference"`
		IsPaid               bool            `json:"is_paid"`
		CreatedAt            string          `json:"created_at"`
		VerificationUUID     string          `json:"verification_uuid"`
	}

	var results []LedgerResponseItem
	for _, bl := range items {
		caseNum := ""
		regNum := ""
		insured := ""
		verUUID := ""
		if bl.Case != nil {
			caseNum = bl.Case.CaseNumber
			regNum = bl.Case.VehicleRegNumber
			insured = bl.Case.InsuredName
			verUUID = bl.Case.VerificationUUID
		}
		insName := ""
		if bl.Insurer != nil {
			insName = bl.Insurer.Name
		}

		results = append(results, LedgerResponseItem{
			ID:                   bl.ID,
			CaseID:               bl.CaseID,
			CaseNumber:           caseNum,
			InsurerName:          insName,
			VehicleRegNumber:     regNum,
			InsuredName:          insured,
			RecordingDurationSec: bl.RecordingDurationSeconds,
			DurationFormatted:    formatSeconds(bl.RecordingDurationSeconds),
			BillableMinutes:      bl.BillableMinutes,
			RatePerMinuteINR:     bl.RatePerMinuteINR,
			BaseFeeINR:           bl.BaseFeeINR,
			TotalBilledINR:       bl.TotalBilledINR,
			InvoiceReference:     bl.InvoiceReference,
			IsPaid:               bl.IsPaid,
			CreatedAt:            bl.CreatedAt.Format("02-Jan-2006 15:04:05 IST"),
			VerificationUUID:     verUUID,
		})
	}

	c.JSON(http.StatusOK, results)
}

func (h *BillingHandler) ListInsurers(c *gin.Context) {
	var insurers []models.Insurer
	h.db.Where("is_active = true").Find(&insurers)
	c.JSON(http.StatusOK, insurers)
}
