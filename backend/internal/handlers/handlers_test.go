package handlers_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"motor-platform/internal/auth"
	"motor-platform/internal/config"
	"motor-platform/internal/database"
	"motor-platform/internal/handlers"
	"motor-platform/internal/models"
	"motor-platform/internal/pdf"
	"motor-platform/internal/storage"
	"motor-platform/internal/worker"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupTestEnvironment(t *testing.T) (*gin.Engine, *gorm.DB, *config.Config, storage.StorageProvider) {
	gin.SetMode(gin.TestMode)

	cfg := &config.Config{
		Port:               "8080",
		AppEnv:             "test",
		DBDriver:           "sqlite",
		DBDSN:              ":memory:",
		JWTSecret:          "test-jwt-secret-key-minimum-32-chars-long",
		JWTExpirationHours: 24,
		StorageBaseDir:     t.TempDir(),
		StorageBaseURL:     "http://localhost:8080",
	}

	db, err := gorm.Open(sqlite.Open(cfg.DBDSN), &gorm.Config{})
	if err != nil {
		t.Fatalf("Failed to open test db: %v", err)
	}

	if err := database.AutoMigrate(db); err != nil {
		t.Fatalf("Failed to migrate: %v", err)
	}
	if err := database.SeedDatabase(db); err != nil {
		t.Fatalf("Failed to seed: %v", err)
	}

	sp, err := storage.NewLocalStorageProvider(cfg.StorageBaseDir, cfg.StorageBaseURL)
	if err != nil {
		t.Fatalf("Failed to create storage: %v", err)
	}

	stitcher := worker.NewStitcher(db, sp)
	pdfGen := pdf.NewGenerator(db, sp, cfg.StorageBaseURL)

	asyncCompleter := func(caseID string) error {
		_ = pdfGen.CompileDossier(httptest.NewRequest("GET", "/", nil).Context(), caseID)
		return nil
	}

	authH := handlers.NewAuthHandler(db, cfg)
	caseH := handlers.NewCaseHandler(db)
	recH := handlers.NewRecordingHandler(db, sp, func(caseID, recID string) error {
		return stitcher.StitchRecording(httptest.NewRequest("GET", "/", nil).Context(), caseID, recID)
	})
	contactH := handlers.NewContactHandler(db)
	obsH := handlers.NewObservationHandler(db)
	revH := handlers.NewReviewHandler(db, asyncCompleter)
	billH := handlers.NewBillingHandler(db)
	pubH := handlers.NewPublicHandler(db)

	r := gin.New()
	r.Use(gin.Recovery())

	v1 := r.Group("/api/v1")
	{
		v1.GET("/public/verify/dossier/:uuid", pubH.VerifyDossier)
		v1.POST("/auth/login", authH.Login)

		protected := v1.Group("")
		protected.Use(auth.AuthMiddleware(cfg.JWTSecret))
		{
			protected.GET("/auth/me", authH.Me)
			protected.GET("/cases", caseH.ListCases)
			protected.GET("/cases/:id", caseH.GetCase)
			protected.POST("/cases", auth.RequireRole(models.RoleAdmin, models.RoleManager), caseH.CreateCase)
			protected.PATCH("/cases/:id/assign", auth.RequireRole(models.RoleAdmin, models.RoleManager), caseH.AssignAgent)

			protected.POST("/cases/:id/recordings/start", recH.StartRecording)
			protected.POST("/cases/:id/recordings/:recId/chunks", recH.UploadChunk)
			protected.POST("/cases/:id/recordings/:recId/stop", recH.StopRecording)

			protected.POST("/cases/:id/contacts", contactH.AddContact)
			protected.POST("/cases/:id/calls", contactH.LogCall)
			protected.GET("/calls/due-recalls", contactH.GetDueRecalls)

			protected.GET("/cases/:id/observations", obsH.GetObservations)
			protected.POST("/cases/:id/observations/draft", obsH.SaveDraft)
			protected.POST("/cases/:id/submit", obsH.SubmitAndLock)

			protected.POST("/cases/:id/review/approve", auth.RequireRole(models.RoleAdmin, models.RoleManager), revH.ApproveReview)
			protected.POST("/cases/:id/review/reject", auth.RequireRole(models.RoleAdmin, models.RoleManager), revH.RejectReview)
			protected.POST("/cases/:id/admin/sign-off", auth.RequireRole(models.RoleAdmin), revH.AdminSignOff)

			protected.GET("/billing/metrics", auth.RequireRole(models.RoleAdmin, models.RoleInsurer), billH.GetMetrics)
			protected.GET("/billing/ledger", auth.RequireRole(models.RoleAdmin, models.RoleInsurer), billH.GetLedger)
		}
	}

	return r, db, cfg, sp
}

func getAuthToken(t *testing.T, router *gin.Engine, email, password string) string {
	payload, _ := json.Marshal(map[string]string{
		"email":    email,
		"password": password,
	})
	req := httptest.NewRequest("POST", "/api/v1/auth/login", bytes.NewBuffer(payload))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("Login failed for %s: %s", email, w.Body.String())
	}

	var res struct {
		Token string `json:"token"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &res)
	return res.Token
}

func TestAuthLogin(t *testing.T) {
	router, _, _, _ := setupTestEnvironment(t)

	// 1. Success Admin login
	token := getAuthToken(t, router, "admin@agency.com", "Password123!")
	if token == "" {
		t.Fatal("Expected non-empty JWT token")
	}

	// 2. Failure wrong password
	payload, _ := json.Marshal(map[string]string{
		"email":    "admin@agency.com",
		"password": "WrongPassword!",
	})
	req := httptest.NewRequest("POST", "/api/v1/auth/login", bytes.NewBuffer(payload))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("Expected 401 for wrong password, got %d", w.Code)
	}
}

func TestCasesVaultRBAC(t *testing.T) {
	router, _, _, _ := setupTestEnvironment(t)

	adminToken := getAuthToken(t, router, "admin@agency.com", "Password123!")
	agentToken := getAuthToken(t, router, "agent.palak@agency.com", "Password123!")

	// Admin queries all cases
	req := httptest.NewRequest("GET", "/api/v1/cases", nil)
	req.Header.Set("Authorization", "Bearer "+adminToken)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("Admin list cases failed: %s", w.Body.String())
	}

	var adminResp struct {
		Data   []models.Case `json:"data"`
		Counts struct {
			Total int `json:"total"`
		} `json:"counts"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &adminResp)
	if adminResp.Counts.Total == 0 {
		t.Fatalf("Expected seeded cases for Admin")
	}

	// Agent queries cases - scoped strictly to assigned
	reqAgent := httptest.NewRequest("GET", "/api/v1/cases", nil)
	reqAgent.Header.Set("Authorization", "Bearer "+agentToken)
	wAgent := httptest.NewRecorder()
	router.ServeHTTP(wAgent, reqAgent)

	if wAgent.Code != http.StatusOK {
		t.Fatalf("Agent list cases failed: %s", wAgent.Body.String())
	}
}

func TestObservationValidationAndLockWorkflow(t *testing.T) {
	router, db, _, _ := setupTestEnvironment(t)

	agentToken := getAuthToken(t, router, "agent.palak@agency.com", "Password123!")
	mgrToken := getAuthToken(t, router, "manager.qa@agency.com", "Password123!")
	adminToken := getAuthToken(t, router, "admin@agency.com", "Password123!")

	// Case 1 is WIP assigned to Palak
	caseID := "case-hgv-101"

	// 1. Incomplete submission must be rejected with 422 Unprocessable Entity
	badPayload, _ := json.Marshal(map[string]interface{}{
		"observations_data": map[string]interface{}{
			"insured_version": "Short",
		},
		"conclusion_data": map[string]interface{}{},
	})
	reqBad := httptest.NewRequest("POST", fmt.Sprintf("/api/v1/cases/%s/submit", caseID), bytes.NewBuffer(badPayload))
	reqBad.Header.Set("Authorization", "Bearer "+agentToken)
	reqBad.Header.Set("Content-Type", "application/json")
	wBad := httptest.NewRecorder()
	router.ServeHTTP(wBad, reqBad)

	if wBad.Code != http.StatusUnprocessableEntity {
		t.Fatalf("Expected 422 for incomplete observation, got %d: %s", wBad.Code, wBad.Body.String())
	}

	// 2. Save as Draft must succeed without validating
	draftPayload, _ := json.Marshal(map[string]interface{}{
		"observations_data": map[string]interface{}{
			"insured_version": "Owner statement drafted partially.",
		},
	})
	reqDraft := httptest.NewRequest("POST", fmt.Sprintf("/api/v1/cases/%s/observations/draft", caseID), bytes.NewBuffer(draftPayload))
	reqDraft.Header.Set("Authorization", "Bearer "+agentToken)
	reqDraft.Header.Set("Content-Type", "application/json")
	wDraft := httptest.NewRecorder()
	router.ServeHTTP(wDraft, reqDraft)

	if wDraft.Code != http.StatusOK {
		t.Fatalf("Draft save failed: %s", wDraft.Body.String())
	}

	// Verify case is still WORK_IN_PROGRESS
	var cs models.Case
	db.Where("id = ?", caseID).First(&cs)
	if cs.Status != models.StatusWorkInProgress {
		t.Fatalf("Case should remain in WIP after draft, got %s", cs.Status)
	}

	// 3. Complete submission with all 10 mandatory fields
	completePayload, _ := json.Marshal(map[string]interface{}{
		"observations_data": map[string]interface{}{
			"insured_version":          "Insured dispatched truck from warehouse at 8 PM.",
			"driver_version":           "Driver stated stray cattle appeared on the dark highway lane.",
			"occupant_cleaner_version": "Cleaner confirms speed was under 50 km/h.",
			"relation_with_insured":    "Driver is a permanent payroll employee.",
			"kyc_documents":            "Aadhaar card and Commercial Badge DL verified.",
			"profession_contacted":     "Fleet logistics driver.",
			"hospital_injury_remarks":  "Nil hospitalization; first aid received.",
			"damages_garage_remarks":   "Front bumper, headlamp, and radiator cowl cracked.",
			"social_media_news":        "Checked local Highway patrol updates; no adverse notice.",
			"evidences_remarks":        "Fastag toll plaza stamp verified at 02:18 AM.",
			"cleaner_statement":        "Cleaner confirms vehicle sober driving.",
			"permit_validity_state":    "VALID",
		},
		"conclusion_data": map[string]interface{}{
			"success_tagging":       "Genuine",
			"ground_of_repudiation": "N/A - Claim Recommended Genuine",
			"conclusion":            "Physical damages are consistent with impact narrative.",
			"final_remarks":         "All 10 points substantiated by evidence. Recommend settlement.",
		},
	})

	reqSubmit := httptest.NewRequest("POST", fmt.Sprintf("/api/v1/cases/%s/submit", caseID), bytes.NewBuffer(completePayload))
	reqSubmit.Header.Set("Authorization", "Bearer "+agentToken)
	reqSubmit.Header.Set("Content-Type", "application/json")
	wSubmit := httptest.NewRecorder()
	router.ServeHTTP(wSubmit, reqSubmit)

	if wSubmit.Code != http.StatusOK {
		t.Fatalf("Complete submit failed: %s", wSubmit.Body.String())
	}

	// Verify case transitioned to REVIEW
	db.Where("id = ?", caseID).First(&cs)
	if cs.Status != models.StatusReview {
		t.Fatalf("Case should transition to REVIEW after submit, got %s", cs.Status)
	}

	// 4. Manager Rework Loop: Reject back to WIP with remarks
	rejectPayload, _ := json.Marshal(map[string]string{
		"rejection_remarks": "Driver license image is unclear; re-request high-res front/back photo.",
	})
	reqReject := httptest.NewRequest("POST", fmt.Sprintf("/api/v1/cases/%s/review/reject", caseID), bytes.NewBuffer(rejectPayload))
	reqReject.Header.Set("Authorization", "Bearer "+mgrToken)
	reqReject.Header.Set("Content-Type", "application/json")
	wReject := httptest.NewRecorder()
	router.ServeHTTP(wReject, reqReject)

	if wReject.Code != http.StatusOK {
		t.Fatalf("Manager reject failed: %s", wReject.Body.String())
	}

	db.Where("id = ?", caseID).First(&cs)
	if cs.Status != models.StatusWorkInProgress || cs.ReworkCount != 1 {
		t.Fatalf("Case should revert to WIP with rework_count=1, got status=%s, rework=%d", cs.Status, cs.ReworkCount)
	}

	// 5. Re-submit and Manager Approve
	reqResubmit := httptest.NewRequest("POST", fmt.Sprintf("/api/v1/cases/%s/submit", caseID), bytes.NewBuffer(completePayload))
	reqResubmit.Header.Set("Authorization", "Bearer "+agentToken)
	reqResubmit.Header.Set("Content-Type", "application/json")
	wResubmit := httptest.NewRecorder()
	router.ServeHTTP(wResubmit, reqResubmit)
	if wResubmit.Code != http.StatusOK {
		t.Fatalf("Re-submit failed: %s", wResubmit.Body.String())
	}

	reqApprove := httptest.NewRequest("POST", fmt.Sprintf("/api/v1/cases/%s/review/approve", caseID), nil)
	reqApprove.Header.Set("Authorization", "Bearer "+mgrToken)
	wApprove := httptest.NewRecorder()
	router.ServeHTTP(wApprove, reqApprove)

	if wApprove.Code != http.StatusOK {
		t.Fatalf("Manager approve failed: %s", wApprove.Body.String())
	}

	db.Where("id = ?", caseID).First(&cs)
	if cs.Status != models.StatusAdminSignOff {
		t.Fatalf("Case should be in ADMIN_SIGN_OFF, got %s", cs.Status)
	}

	// 6. Admin Sign-Off (Pillar 3: Returns 202 Accepted)
	reqSignOff := httptest.NewRequest("POST", fmt.Sprintf("/api/v1/cases/%s/admin/sign-off", caseID), nil)
	reqSignOff.Header.Set("Authorization", "Bearer "+adminToken)
	wSignOff := httptest.NewRecorder()
	router.ServeHTTP(wSignOff, reqSignOff)

	if wSignOff.Code != http.StatusAccepted {
		t.Fatalf("Expected 202 Accepted on Admin sign-off, got %d: %s", wSignOff.Code, wSignOff.Body.String())
	}

	db.Where("id = ?", caseID).First(&cs)
	if cs.Status != models.StatusCompleted {
		t.Fatalf("Case should be COMPLETED after sign-off, got %s", cs.Status)
	}
}

func Test5SecondChunkUploadPipeline(t *testing.T) {
	router, db, _, _ := setupTestEnvironment(t)
	agentToken := getAuthToken(t, router, "agent.palak@agency.com", "Password123!")

	caseID := "case-hgv-101"

	// 1. Start recording
	startReq := httptest.NewRequest("POST", fmt.Sprintf("/api/v1/cases/%s/recordings/start", caseID), bytes.NewBuffer([]byte(`{}`)))
	startReq.Header.Set("Authorization", "Bearer "+agentToken)
	startReq.Header.Set("Content-Type", "application/json")
	wStart := httptest.NewRecorder()
	router.ServeHTTP(wStart, startReq)

	if wStart.Code != http.StatusCreated {
		t.Fatalf("Start recording failed: %s", wStart.Body.String())
	}

	var startRes struct {
		RecordingID string `json:"recording_id"`
	}
	_ = json.Unmarshal(wStart.Body.Bytes(), &startRes)
	recID := startRes.RecordingID

	// 2. Upload Chunk 0 (5s)
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	_ = writer.WriteField("chunk_index", "0")
	part, _ := writer.CreateFormFile("chunk_file", "chunk_0.webm")
	part.Write([]byte("mock-webm-5sec-audio-video-chunk-0-data"))
	writer.Close()

	chunkReq := httptest.NewRequest("POST", fmt.Sprintf("/api/v1/cases/%s/recordings/%s/chunks", caseID, recID), body)
	chunkReq.Header.Set("Authorization", "Bearer "+agentToken)
	chunkReq.Header.Set("Content-Type", writer.FormDataContentType())
	wChunk := httptest.NewRecorder()
	router.ServeHTTP(wChunk, chunkReq)

	if wChunk.Code != http.StatusCreated {
		t.Fatalf("Chunk upload failed: %s", wChunk.Body.String())
	}

	// 3. Stop recording
	stopReq := httptest.NewRequest("POST", fmt.Sprintf("/api/v1/cases/%s/recordings/%s/stop", caseID, recID), bytes.NewBuffer([]byte(`{"duration_seconds": 5}`)))
	stopReq.Header.Set("Authorization", "Bearer "+agentToken)
	stopReq.Header.Set("Content-Type", "application/json")
	wStop := httptest.NewRecorder()
	router.ServeHTTP(wStop, stopReq)

	if wStop.Code != http.StatusOK {
		t.Fatalf("Stop recording failed: %s", wStop.Body.String())
	}

	var rec models.Recording
	db.Where("id = ?", recID).First(&rec)
	if rec.Status != models.RecordingReady {
		t.Fatalf("Expected recording status READY, got %s", rec.Status)
	}
}

func TestPublicVerificationEndpoint(t *testing.T) {
	router, _, _, _ := setupTestEnvironment(t)

	// Completed case 4 verification UUID: e3b0c442-98fc-1c14-9afb-fc8996fb9242
	uuid := "e3b0c442-98fc-1c14-9afb-fc8996fb9242"

	req := httptest.NewRequest("GET", fmt.Sprintf("/api/v1/public/verify/dossier/%s", uuid), nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("Public verify endpoint failed: %s", w.Body.String())
	}

	var res struct {
		VerificationStatus string `json:"verification_status"`
		CaseNumber         string `json:"case_number"`
		SHA256Checksum     string `json:"sha256_checksum"`
		RecordedDuration   int    `json:"recorded_duration_seconds"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &res)

	if res.VerificationStatus != "AUTHENTIC_UNTAMPERED" {
		t.Fatalf("Expected AUTHENTIC_UNTAMPERED, got %s", res.VerificationStatus)
	}
	if res.SHA256Checksum == "" {
		t.Fatalf("Expected valid SHA-256 hash")
	}
	if res.RecordedDuration != 1800 {
		t.Fatalf("Expected 1800 recorded seconds, got %d", res.RecordedDuration)
	}
}
