package database

import (
	"log"
	"time"

	"motor-platform/internal/models"

	"github.com/shopspring/decimal"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

// SeedDatabase inserts realistic default insurers, users, templates, and cases
func SeedDatabase(db *gorm.DB) error {
	var count int64
	db.Model(&models.User{}).Count(&count)
	if count > 0 {
		return nil // Already seeded
	}

	log.Println("🌱 Seeding database with initial production demo data...")

	// 1. Insurers
	icici := models.Insurer{
		ID:               "ins-icici-lombard-001",
		Name:             "ICICI Lombard General Insurance",
		Code:             "ICICI_LOMBARD",
		ContactEmail:     "claims.investigation@icicilombard.com",
		PerMinuteRateINR: decimal.NewFromFloat(50.00),
		IsActive:         true,
	}
	bajaj := models.Insurer{
		ID:               "ins-bajaj-allianz-002",
		Name:             "Bajaj Allianz General Insurance",
		Code:             "BAJAJ_ALLIANZ",
		ContactEmail:     "motor.claims@bajajallianz.co.in",
		PerMinuteRateINR: decimal.NewFromFloat(45.00),
		IsActive:         true,
	}
	tata := models.Insurer{
		ID:               "ins-tata-aig-003",
		Name:             "Tata AIG General Insurance",
		Code:             "TATA_AIG",
		ContactEmail:     "investigations@tataaig.com",
		PerMinuteRateINR: decimal.NewFromFloat(55.00),
		IsActive:         true,
	}
	db.Create(&icici)
	db.Create(&bajaj)
	db.Create(&tata)

	// 2. Users (Password for all: Password123!)
	hashedPassword, _ := bcrypt.GenerateFromPassword([]byte("Password123!"), bcrypt.DefaultCost)
	passHash := string(hashedPassword)

	admin := models.User{
		ID:           "usr-admin-001",
		Email:        "admin@agency.com",
		PasswordHash: passHash,
		FullName:     "Vikram Malhotra (Director / Owner)",
		Role:         models.RoleAdmin,
		IsActive:     true,
	}
	manager := models.User{
		ID:           "usr-manager-002",
		Email:        "manager.qa@agency.com",
		PasswordHash: passHash,
		FullName:     "Sanjay Rao (QA Lead)",
		Role:         models.RoleManager,
		IsActive:     true,
	}
	agentPalak := models.User{
		ID:           "usr-agent-003",
		Email:        "agent.palak@agency.com",
		PasswordHash: passHash,
		FullName:     "Palak Gupta (Senior Investigator)",
		Role:         models.RoleAgent,
		IsActive:     true,
	}
	agentRahul := models.User{
		ID:           "usr-agent-004",
		Email:        "agent.rahul@agency.com",
		PasswordHash: passHash,
		FullName:     "Rahul Sharma (Field Investigator)",
		Role:         models.RoleAgent,
		IsActive:     true,
	}
	insurerUser := models.User{
		ID:           "usr-insurer-005",
		InsurerID:    &icici.ID,
		Email:        "claims@icicilombard.com",
		PasswordHash: passHash,
		FullName:     "Amit Verma (ICICI Claims Manager)",
		Role:         models.RoleInsurer,
		IsActive:     true,
	}

	db.Create(&admin)
	db.Create(&manager)
	db.Create(&agentPalak)
	db.Create(&agentRahul)
	db.Create(&insurerUser)

	// 3. Observation Templates
	heavyTemplate := models.ObservationTemplate{
		VehicleClass: models.VehicleHeavyCommercial,
		Version:      1,
		IsActive:     true,
		FieldsSchema: models.JSONMap{
			"required_fields": []string{
				"insured_version",
				"driver_version",
				"occupant_cleaner_version",
				"relation_with_insured",
				"kyc_documents",
				"profession_contacted",
				"hospital_injury_remarks",
				"damages_garage_remarks",
				"social_media_news",
				"evidences_remarks",
				"cleaner_statement",
				"weighbridge_slip_verified",
				"permit_validity_state",
			},
		},
	}
	lmvTemplate := models.ObservationTemplate{
		VehicleClass: models.VehicleLMV,
		Version:      1,
		IsActive:     true,
		FieldsSchema: models.JSONMap{
			"required_fields": []string{
				"insured_version",
				"driver_version",
				"occupant_cleaner_version",
				"relation_with_insured",
				"kyc_documents",
				"profession_contacted",
				"hospital_injury_remarks",
				"damages_garage_remarks",
				"social_media_news",
				"evidences_remarks",
			},
		},
	}
	db.Create(&heavyTemplate)
	db.Create(&lmvTemplate)

	// 4. Sample Cases
	now := time.Now().UTC()
	yesterday := now.Add(-24 * time.Hour)
	twoDaysAgo := now.Add(-48 * time.Hour)
	fiveDaysAgo := now.Add(-120 * time.Hour)

	// Case 1: WIP Heavy Vehicle (Palak)
	case1 := models.Case{
		ID:                     "case-hgv-101",
		CaseNumber:             "MOT18221241",
		InsurerID:              icici.ID,
		AssignedAgentID:        &agentPalak.ID,
		Status:                 models.StatusWorkInProgress,
		VehicleClass:           models.VehicleHeavyCommercial,
		ClaimType:              models.ClaimOD,
		PolicyNumber:           "POL-ICICI-99210-A",
		PolicyStartDate:        &fiveDaysAgo,
		VehicleRegNumber:       "MH-12-AB-1234",
		InsuredName:            "Ramesh Kumar Transports",
		InsuredPrimaryPhone:    "+919876543210",
		VehicleMakeModel:       "Tata Prima 4028.S (14-Wheeler)",
		ClaimAmount:            decimal.NewFromFloat(385000.00),
		State:                  "Maharashtra",
		District:               "Pune",
		AccidentDate:           &twoDaysAgo,
		IntimationDate:         &yesterday,
		CauseOfLoss:            "Rear-end rollover collision on highway",
		InsurerTriggerNarrative: "Old damages suspected; driver implant suspected as regular driver had expired commercial badge.",
		TotalDurationSeconds:   1224, // 20m 24s
		AssignedAt:             &twoDaysAgo,
		VerificationUUID:       "verify-case-101-uuid",
		CreatedAt:              twoDaysAgo,
	}
	db.Create(&case1)

	// Contacts for Case 1
	db.Create(&models.CaseContact{
		CaseID:    case1.ID,
		Role:      models.ContactInsured,
		FullName:  "Ramesh Kumar",
		Phone:     "+919876543210",
		IsPrimary: true,
	})
	db.Create(&models.CaseContact{
		CaseID:    case1.ID,
		Role:      models.ContactDriverOfVehicle,
		FullName:  "Sunil Shinde",
		Phone:     "+919123456789",
		IsPrimary: false,
	})

	// Call logs & recall for Case 1
	recallTime := now.Add(30 * time.Minute)
	db.Create(&models.CallLog{
		CaseID:      case1.ID,
		AgentID:     agentPalak.ID,
		Disposition: models.DispLineBusy,
		Notes:       "Driver phone engaged on commercial haul; recall scheduled in 30 mins.",
		RecallAt:    &recallTime,
	})

	// Draft observations for Case 1
	db.Create(&models.CaseObservation{
		CaseID:          case1.ID,
		VehicleClass:    case1.VehicleClass,
		TemplateVersion: 1,
		ObservationsData: models.JSONMap{
			"insured_version":          "Vehicle dispatched on 18-Oct carrying FMCG cargo towards Pune depot.",
			"driver_version":           "Driver claimed steering lock failed at 2:30 AM near Talegaon toll plaza.",
			"occupant_cleaner_version": "Cleaner confirms vehicle speed was ~45 km/h before swerve.",
			"relation_with_insured":    "Driver is a permanent payroll employee for 3 years.",
			"kyc_documents":            "Aadhaar, Heavy Goods Vehicle Commercial License checked.",
			"profession_contacted":     "Fleet logistics driver.",
			"hospital_injury_remarks":  "Driver sustained minor forearm lacerations; treated at Talegaon PHC.",
			"damages_garage_remarks":   "Front bumper, steering rod, radiator cowl, and front left axle damaged.",
			"social_media_news":        "Checked Highway Police Pune control room Twitter feed; accident noted at 02:45 AM.",
			"evidences_remarks":        "Fastag deduction at Talegaon plaza recorded at 02:18 AM.",
			"cleaner_statement":        "Cleaner confirms driver was alert and sober.",
			"weighbridge_slip_verified": true,
			"permit_validity_state":    "VALID",
		},
		ConclusionData: models.JSONMap{
			"success_tagging":        "Repudiated",
			"ground_of_repudiation":  "Pre-Existing / Old / Manipulated Damages",
			"final_closure_status":   "INVESTIGATION_COMPLETE",
			"conclusion":             "Discrepancy found in cabin crush timeline vs radiator impact.",
			"final_remarks":          "Independent mechanical inspection required for pre-existing chassis twist.",
		},
	})

	// Evidentiary Documents for Case 1 (Palak Gupta - Work In Progress)
	db.Create(&models.CaseDocument{
		CaseID:        case1.ID,
		UploadedByID:  agentPalak.ID,
		DocCategory:   models.DocRC,
		FileName:      "MH12AB1234_Registration_Certificate.pdf",
		StoragePath:   "cases/case-hgv-101/documents/MH12AB1234_Registration_Certificate.pdf",
		FileSizeBytes: 4250,
		MimeType:      "application/pdf",
		CreatedAt:     twoDaysAgo,
	})
	db.Create(&models.CaseDocument{
		CaseID:        case1.ID,
		UploadedByID:  agentPalak.ID,
		DocCategory:   models.DocDL,
		FileName:      "Sunil_Shinde_Commercial_Driving_License.pdf",
		StoragePath:   "cases/case-hgv-101/documents/Sunil_Shinde_Commercial_Driving_License.pdf",
		FileSizeBytes: 3980,
		MimeType:      "application/pdf",
		CreatedAt:     twoDaysAgo,
	})
	db.Create(&models.CaseDocument{
		CaseID:        case1.ID,
		UploadedByID:  agentPalak.ID,
		DocCategory:   models.DocFIRGDCompromise,
		FileName:      "Talegaon_Police_Station_GD_Memo.pdf",
		StoragePath:   "cases/case-hgv-101/documents/Talegaon_Police_Station_GD_Memo.pdf",
		FileSizeBytes: 4520,
		MimeType:      "application/pdf",
		CreatedAt:     twoDaysAgo,
	})
	db.Create(&models.CaseDocument{
		CaseID:        case1.ID,
		UploadedByID:  agentPalak.ID,
		DocCategory:   models.DocCommercialPermit,
		FileName:      "National_Goods_Permit_and_Fitness.pdf",
		StoragePath:   "cases/case-hgv-101/documents/National_Goods_Permit_and_Fitness.pdf",
		FileSizeBytes: 4120,
		MimeType:      "application/pdf",
		CreatedAt:     twoDaysAgo,
	})
	db.Create(&models.CaseDocument{
		CaseID:        case1.ID,
		UploadedByID:  agentPalak.ID,
		DocCategory:   models.DocLoadChallanWeighbridge,
		FileName:      "Talegaon_Weighbridge_Gross_Weight_Challan.pdf",
		StoragePath:   "cases/case-hgv-101/documents/Talegaon_Weighbridge_Gross_Weight_Challan.pdf",
		FileSizeBytes: 3840,
		MimeType:      "application/pdf",
		CreatedAt:     twoDaysAgo,
	})
	db.Create(&models.CaseDocument{
		CaseID:        case1.ID,
		UploadedByID:  agentPalak.ID,
		DocCategory:   models.DocGarageEstimate,
		FileName:      "Apex_Heavy_Motors_Repair_Estimate.pdf",
		StoragePath:   "cases/case-hgv-101/documents/Apex_Heavy_Motors_Repair_Estimate.pdf",
		FileSizeBytes: 4780,
		MimeType:      "application/pdf",
		CreatedAt:     yesterday,
	})

	// In-Call Live Screenshots for Case 1
	db.Create(&models.CaseScreenshot{
		CaseID:                 case1.ID,
		UploadedByID:           agentPalak.ID,
		StoragePath:            "cases/case-hgv-101/screenshots/odometer_and_chassis_punch.png",
		TimestampOffsetSeconds: 135,
		Caption:                "Odometer reading 142,890 km & chassis plate MAT448021N7M12345 inspected",
		CreatedAt:              twoDaysAgo,
	})
	db.Create(&models.CaseScreenshot{
		CaseID:                 case1.ID,
		UploadedByID:           agentPalak.ID,
		StoragePath:            "cases/case-hgv-101/screenshots/cabin_crush_and_steering_rod.png",
		TimestampOffsetSeconds: 340,
		Caption:                "Front left cabin impact & bent steering tie-rod assembly",
		CreatedAt:              twoDaysAgo,
	})
	db.Create(&models.CaseScreenshot{
		CaseID:                 case1.ID,
		UploadedByID:           agentPalak.ID,
		StoragePath:            "cases/case-hgv-101/screenshots/driver_face_and_badge.png",
		TimestampOffsetSeconds: 490,
		Caption:                "Driver Sunil Shinde holding commercial authorization badge B-992144",
		CreatedAt:              twoDaysAgo,
	})

	// Case 2: UNASSIGNED LMV Case
	case2 := models.Case{
		ID:                     "case-lmv-202",
		CaseNumber:             "MOT18225567",
		InsurerID:              bajaj.ID,
		Status:                 models.StatusUnassigned,
		VehicleClass:           models.VehicleLMV,
		ClaimType:              models.ClaimOD,
		PolicyNumber:           "POL-BAJAJ-55102-C",
		VehicleRegNumber:       "DL-01-XY-9081",
		InsuredName:            "Pooja Deshmukh",
		InsuredPrimaryPhone:    "+919811223344",
		VehicleMakeModel:       "Hyundai Creta 1.5 SX",
		ClaimAmount:            decimal.NewFromFloat(94000.00),
		State:                  "Delhi",
		District:               "South Delhi",
		AccidentDate:           &yesterday,
		IntimationDate:         &now,
		CauseOfLoss:            "Hit a divider near Ring Road flyover",
		InsurerTriggerNarrative: "Intimation delayed by 10 days; check alcohol involvement & driving license authenticity.",
		TotalDurationSeconds:   0,
		VerificationUUID:       "verify-case-202-uuid",
		CreatedAt:              yesterday,
	}
	db.Create(&case2)
	db.Create(&models.CaseContact{
		CaseID:    case2.ID,
		Role:      models.ContactInsured,
		FullName:  "Pooja Deshmukh",
		Phone:     "+919811223344",
		IsPrimary: true,
	})

	// Case 3: REVIEW Queue Case (Submitted by Rahul)
	case3 := models.Case{
		ID:                     "case-review-303",
		CaseNumber:             "MOT18228899",
		InsurerID:              icici.ID,
		AssignedAgentID:        &agentRahul.ID,
		Status:                 models.StatusReview,
		VehicleClass:           models.VehicleLMV,
		ClaimType:              models.ClaimOD,
		PolicyNumber:           "POL-ICICI-44119-B",
		VehicleRegNumber:       "KA-03-MN-7711",
		InsuredName:            "Karthik Subramanian",
		InsuredPrimaryPhone:    "+919845012345",
		VehicleMakeModel:       "Maruti Suzuki Brezza ZXi",
		ClaimAmount:            decimal.NewFromFloat(68000.00),
		State:                  "Karnataka",
		District:               "Bengaluru Urban",
		AccidentDate:           &twoDaysAgo,
		IntimationDate:         &yesterday,
		CauseOfLoss:            "Tree branch fell on parked vehicle during rainstorm",
		InsurerTriggerNarrative: "Verify if vehicle was parked in open public road or private garage; check weather logs.",
		TotalDurationSeconds:   950, // 15m 50s
		AssignedAt:             &twoDaysAgo,
		SubmittedAt:            &now,
		VerificationUUID:       "verify-case-303-uuid",
		CreatedAt:              twoDaysAgo,
	}
	db.Create(&case3)
	db.Create(&models.CaseContact{
		CaseID:    case3.ID,
		Role:      models.ContactInsured,
		FullName:  "Karthik Subramanian",
		Phone:     "+919845012345",
		IsPrimary: true,
	})
	db.Create(&models.CaseObservation{
		CaseID:          case3.ID,
		VehicleClass:    case3.VehicleClass,
		TemplateVersion: 1,
		ObservationsData: models.JSONMap{
			"insured_version":          "Parked outside apartment premises on 18-Oct night during storm.",
			"driver_version":           "Self-driven by insured.",
			"occupant_cleaner_version": "No occupants at time of incident.",
			"relation_with_insured":    "Self-driven.",
			"kyc_documents":            "Aadhaar card and Smart Card DL verified.",
			"profession_contacted":     "Software Consultant at Manyata Tech Park.",
			"hospital_injury_remarks":  "Nil injuries.",
			"damages_garage_remarks":   "Roof dent, windshield shattered, hood scratched.",
			"social_media_news":        "IMD weather bulletin confirmed thunderstorm with 55km/h wind gusts on 18-Oct.",
			"evidences_remarks":        "Apartment security guard statement recorded and photos collected.",
		},
		ConclusionData: models.JSONMap{
			"success_tagging":        "Genuine",
			"ground_of_repudiation":  "N/A - Claim Recommended Genuine",
			"final_closure_status":   "APPROVED_FOR_PAYMENT",
			"conclusion":             "All physical evidence matches storm intimation narrative.",
			"final_remarks":          "Claim genuine; loss payable subject to policy deductible.",
		},
	})

	// Case 4: COMPLETED Case (Signed off by Admin, Invoiced)
	case4 := models.Case{
		ID:                     "case-completed-404",
		CaseNumber:             "MOT18219900",
		InsurerID:              icici.ID,
		AssignedAgentID:        &agentPalak.ID,
		Status:                 models.StatusCompleted,
		VehicleClass:           models.VehicleHeavyCommercial,
		ClaimType:              models.ClaimTP,
		PolicyNumber:           "POL-ICICI-11002-Z",
		VehicleRegNumber:       "GJ-06-TT-5544",
		AccusedVehicleNumber:   func(s string) *string { return &s }("GJ-01-AB-9999"),
		InsuredName:            "Gujarat Cargo Movers LLP",
		InsuredPrimaryPhone:    "+919723456780",
		VehicleMakeModel:       "Ashok Leyland Ecomet 1215",
		ClaimAmount:            decimal.NewFromFloat(520000.00),
		State:                  "Gujarat",
		District:               "Vadodara",
		AccidentDate:           &fiveDaysAgo,
		IntimationDate:         &twoDaysAgo,
		CauseOfLoss:            "Collided with auto-rickshaw on state highway",
		InsurerTriggerNarrative: "Check driver license commercial badge endorsement; third party compensation liability check.",
		TotalDurationSeconds:   1800, // 30 minutes exact
		AssignedAt:             &fiveDaysAgo,
		SubmittedAt:            &twoDaysAgo,
		CompletedAt:            &yesterday,
		VerificationUUID:       "e3b0c442-98fc-1c14-9afb-fc8996fb9242",
		CreatedAt:              fiveDaysAgo,
	}
	db.Create(&case4)
	db.Create(&models.CaseContact{
		CaseID:    case4.ID,
		Role:      models.ContactInsured,
		FullName:  "Bhavin Patel (Partner)",
		Phone:     "+919723456780",
		IsPrimary: true,
	})

	// Master recording for Case 4
	checksum := "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
	masterPath := "cases/case-completed-404/recordings/rec_master.webm"
	db.Create(&models.Recording{
		ID:                "rec-completed-001",
		CaseID:            case4.ID,
		AgentID:           agentPalak.ID,
		Status:            models.RecordingReady,
		DurationSeconds:   1800,
		MasterStoragePath: &masterPath,
		SHA256Checksum:    &checksum,
		FileSizeBytes:     24500000,
		MimeType:          "video/webm",
		StartedAt:         fiveDaysAgo,
		StoppedAt:         &yesterday,
	})

	// Billing ledger for Case 4
	db.Create(&models.BillingLedger{
		CaseID:                   case4.ID,
		InsurerID:                icici.ID,
		RecordingDurationSeconds: 1800,
		BillableMinutes:          30,
		RatePerMinuteINR:         decimal.NewFromFloat(50.00),
		BaseFeeINR:               decimal.NewFromFloat(750.00),
		TotalBilledINR:           decimal.NewFromFloat(2250.00), // (30 * 50) + 750 = 2250
		InvoiceReference:         "INV-2026-OCT-1001",
		IsPaid:                   false,
	})

	log.Println("✅ Database seeded successfully with 4 sample cases across all states, 5 users, and templates.")
	return nil
}
