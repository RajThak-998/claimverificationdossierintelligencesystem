package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"motor-platform/internal/auth"
	"motor-platform/internal/config"
	"motor-platform/internal/database"
	"motor-platform/internal/handlers"
	"motor-platform/internal/models"
	"motor-platform/internal/pdf"
	"motor-platform/internal/storage"
	"motor-platform/internal/worker"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

func main() {
	log.Println("🚀 Starting Motor Claim Verification & Dossier Intelligence Platform API...")

	cfg := config.LoadConfig()

	// 1. Storage Provider Setup (Pillar 1: Storage Abstraction)
	var storageProvider storage.StorageProvider
	var err error

	if cfg.StorageDriver == "minio" || cfg.StorageDriver == "s3" {
		log.Printf("Connecting to MinIO / S3 at %s (bucket: %s)...", cfg.StorageEndpoint, cfg.StorageBucket)
		storageProvider, err = storage.NewMinIOStorageProvider(
			cfg.StorageEndpoint,
			cfg.StorageAccessKey,
			cfg.StorageSecretKey,
			cfg.StorageBucket,
			cfg.StorageUseSSL,
		)
		if err != nil {
			log.Printf("⚠️ MinIO init failed: %v. Falling back to local storage provider.", err)
			storageProvider, _ = storage.NewLocalStorageProvider(cfg.StorageBaseDir, cfg.StorageBaseURL)
		}
	} else {
		log.Printf("Using LocalStorageProvider at %s...", cfg.StorageBaseDir)
		storageProvider, err = storage.NewLocalStorageProvider(cfg.StorageBaseDir, cfg.StorageBaseURL)
		if err != nil {
			log.Fatalf("Failed to initialize storage provider: %v", err)
		}
	}

	// 2. Database Initialization
	db, err := database.InitDB(cfg)
	if err != nil {
		log.Printf("⚠️ PostgreSQL connection failed: %v. Switching to SQLite for self-contained runtime...", err)
		cfg.DBDriver = "sqlite"
		cfg.DBDSN = "motor_claims.db"
		db, err = database.InitDB(cfg)
		if err != nil {
			log.Fatalf("Fatal: Cannot initialize database: %v", err)
		}
	}

	// Seed database with sample data if empty
	if err := database.SeedDatabase(db); err != nil {
		log.Printf("Warning: Seed failed: %v", err)
	}

	// 3. Background Workers (Pillar 3: Decoupled 202 Async Execution)
	stitcher := worker.NewStitcher(db, storageProvider)
	pdfGenerator := pdf.NewGenerator(db, storageProvider, cfg.StorageBaseURL)

	// Async completer task called on sign-off
	asyncCompleter := func(caseID string) error {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()

		// 1. Stitch any ready recordings
		var recordings []models.Recording
		db.Where("case_id = ?", caseID).Find(&recordings)
		for _, rec := range recordings {
			_ = stitcher.StitchRecording(ctx, caseID, rec.ID)
		}

		// 2. Compile Certified PDF Dossier
		if err := pdfGenerator.CompileDossier(ctx, caseID); err != nil {
			log.Printf("Error compiling dossier for case %s: %v", caseID, err)
			return err
		}

		return nil
	}

	asyncStitcher := func(caseID, recordingID string) error {
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
			defer cancel()
			_ = stitcher.StitchRecording(ctx, caseID, recordingID)
		}()
		return nil
	}

	// 4. Handlers
	authHandler := handlers.NewAuthHandler(db, cfg)
	caseHandler := handlers.NewCaseHandler(db)
	recordingHandler := handlers.NewRecordingHandler(db, storageProvider, asyncStitcher)
	contactHandler := handlers.NewContactHandler(db)
	observationHandler := handlers.NewObservationHandler(db, cfg)
	reviewHandler := handlers.NewReviewHandler(db, asyncCompleter)
	billingHandler := handlers.NewBillingHandler(db)
	publicHandler := handlers.NewPublicHandler(db)

	// 5. Gin HTTP Server Setup
	if cfg.AppEnv == "production" {
		gin.SetMode(gin.ReleaseMode)
	}

	r := gin.Default()

	// CORS Setup
	corsConfig := cors.DefaultConfig()
	corsConfig.AllowAllOrigins = true
	corsConfig.AllowHeaders = []string{"Origin", "Content-Type", "Accept", "Authorization", "X-Requested-With"}
	corsConfig.AllowMethods = []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"}
	r.Use(cors.New(corsConfig))

	// Static Storage File Serving (for LocalStorageProvider)
	storageFileHandler := func(c *gin.Context) {
		relPath := strings.TrimPrefix(c.Param("filepath"), "/")
		cleanPath := filepath.Clean(relPath)
		fullPath := filepath.Join(cfg.StorageBaseDir, cleanPath)

		if fi, err := os.Stat(fullPath); err == nil && !fi.IsDir() {
			if strings.HasSuffix(cleanPath, ".pdf") {
				c.Header("Content-Disposition", "inline; filename="+filepath.Base(cleanPath))
				c.Header("Content-Type", "application/pdf")
			} else if strings.HasSuffix(cleanPath, ".webm") {
				c.Header("Content-Type", "video/webm")
			}
			c.File(fullPath)
			return
		}

		// Try downloading via storage provider
		reader, err := storageProvider.DownloadFile(c.Request.Context(), cleanPath)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "file not found"})
			return
		}
		defer reader.Close()

		mimeType := "application/octet-stream"
		if strings.HasSuffix(cleanPath, ".pdf") {
			mimeType = "application/pdf"
			c.Header("Content-Disposition", "inline; filename="+filepath.Base(cleanPath))
		} else if strings.HasSuffix(cleanPath, ".html") {
			mimeType = "text/html; charset=utf-8"
		} else if strings.HasSuffix(cleanPath, ".png") {
			mimeType = "image/png"
		} else if strings.HasSuffix(cleanPath, ".jpg") || strings.HasSuffix(cleanPath, ".jpeg") {
			mimeType = "image/jpeg"
		} else if strings.HasSuffix(cleanPath, ".webm") {
			mimeType = "video/webm"
		}
		c.DataFromReader(http.StatusOK, -1, mimeType, reader, nil)
	}
	r.GET("/storage/*filepath", storageFileHandler)
	r.HEAD("/storage/*filepath", storageFileHandler)

	// Public Health Endpoint
	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status":    "UP",
			"timestamp": time.Now().UTC().Format(time.RFC3339),
			"service":   "motor-claim-verification-platform",
		})
	})

	// API v1 Routes
	v1 := r.Group("/api/v1")
	{
		// Public Verification Endpoint (No Auth Required)
		v1.GET("/public/verify/dossier/:uuid", publicHandler.VerifyDossier)
		v1.GET("/public/dossier/:uuid/pdf", func(c *gin.Context) {
			uuidParam := c.Param("uuid")
			var cs models.Case
			if err := db.Where("verification_uuid = ? OR id = ? OR case_number = ?", uuidParam, uuidParam, uuidParam).First(&cs).Error; err != nil {
				c.JSON(http.StatusNotFound, gin.H{"error": "case not found"})
				return
			}

			if cs.LockedPDFPath == nil || *cs.LockedPDFPath == "" || strings.HasSuffix(*cs.LockedPDFPath, ".html") {
				_ = pdfGenerator.CompileDossier(c.Request.Context(), cs.ID)
				db.Where("id = ?", cs.ID).First(&cs)
			}

			if cs.LockedPDFPath != nil && *cs.LockedPDFPath != "" {
				reader, err := storageProvider.DownloadFile(c.Request.Context(), *cs.LockedPDFPath)
				if err == nil {
					defer reader.Close()
					disposition := "attachment"
					if c.Query("inline") == "true" {
						disposition = "inline"
					}
					c.Header("Content-Disposition", fmt.Sprintf("%s; filename=dossier_%s.pdf", disposition, cs.CaseNumber))
					c.DataFromReader(http.StatusOK, -1, "application/pdf", reader, nil)
					return
				}
			}

			c.JSON(http.StatusNotFound, gin.H{"error": "dossier not ready yet"})
		})
		v1.GET("/cases/template/csv", caseHandler.DownloadTemplateCSV)

		// Public Auth
		v1.POST("/auth/login", authHandler.Login)

		// Protected Routes
		protected := v1.Group("")
		protected.Use(auth.AuthMiddleware(cfg.JWTSecret))
		{
			// Current user & agents
			protected.GET("/auth/me", authHandler.Me)
			protected.GET("/auth/agents", authHandler.ListAgents)

			// Cases Vault
			protected.GET("/cases", caseHandler.ListCases)
			protected.GET("/cases/:id", caseHandler.GetCase)
			protected.POST("/cases", auth.RequireRole(models.RoleAdmin, models.RoleManager), caseHandler.CreateCase)
			protected.PATCH("/cases/:id/assign", auth.RequireRole(models.RoleAdmin, models.RoleManager), caseHandler.AssignAgent)
			protected.POST("/cases/bulk-import", auth.RequireRole(models.RoleAdmin, models.RoleManager), caseHandler.BulkImport)

			// Download compiled dossier
			protected.GET("/cases/:id/pdf/download", func(c *gin.Context) {
				caseID := c.Param("id")
				var cs models.Case
				if err := db.Where("id = ?", caseID).First(&cs).Error; err != nil {
					c.JSON(http.StatusNotFound, gin.H{"error": "case not found"})
					return
				}

				if cs.LockedPDFPath == nil || *cs.LockedPDFPath == "" || strings.HasSuffix(*cs.LockedPDFPath, ".html") {
					// Generate now if not ready or if old HTML
					_ = pdfGenerator.CompileDossier(c.Request.Context(), caseID)
					db.Where("id = ?", caseID).First(&cs)
				}

				if cs.LockedPDFPath != nil && *cs.LockedPDFPath != "" {
					reader, err := storageProvider.DownloadFile(c.Request.Context(), *cs.LockedPDFPath)
					if err == nil {
						defer reader.Close()
						disposition := "attachment"
						if c.Query("inline") == "true" {
							disposition = "inline"
						}
						c.Header("Content-Disposition", fmt.Sprintf("%s; filename=dossier_%s.pdf", disposition, cs.CaseNumber))
						c.DataFromReader(http.StatusOK, -1, "application/pdf", reader, nil)
						return
					}
				}

				c.JSON(http.StatusNotFound, gin.H{"error": "dossier not ready yet"})
			})

			// Tele-Verification & Media Streaming (Direct Recording & Snapshots)
			protected.POST("/cases/:id/recordings/direct", recordingHandler.UploadDirectRecording)
			protected.POST("/cases/:id/recordings/start", recordingHandler.StartRecording)
			protected.POST("/cases/:id/recordings/:recId/chunks", recordingHandler.UploadChunk)
			protected.POST("/cases/:id/recordings/:recId/stop", recordingHandler.StopRecording)
			protected.POST("/cases/:id/recordings/upload", recordingHandler.UploadDirectRecording)
			protected.POST("/cases/:id/screenshots", recordingHandler.UploadScreenshot)
			protected.POST("/cases/:id/documents", recordingHandler.UploadDocument)
			protected.GET("/files/stream", recordingHandler.GetFileStream)

			// Contacts & Follow-Up Recalls
			protected.POST("/cases/:id/contacts", contactHandler.AddContact)
			protected.POST("/cases/:id/calls", contactHandler.LogCall)
			protected.GET("/calls/due-recalls", contactHandler.GetDueRecalls)

			// Observations Engine & Submission
			protected.GET("/cases/:id/observations", observationHandler.GetObservations)
			protected.POST("/cases/:id/observations/draft", observationHandler.SaveDraft)
			protected.POST("/cases/:id/observations/improve-ai", auth.RequireRole(models.RoleAgent, models.RoleAdmin), observationHandler.ImproveWithAI)
			protected.POST("/cases/:id/submit", observationHandler.SubmitAndLock)

			// QA Review & Sign-Off
			protected.POST("/cases/:id/review/approve", auth.RequireRole(models.RoleAdmin, models.RoleManager), reviewHandler.ApproveReview)
			protected.POST("/cases/:id/review/reject", auth.RequireRole(models.RoleAdmin, models.RoleManager), reviewHandler.RejectReview)
			protected.POST("/cases/:id/admin/sign-off", auth.RequireRole(models.RoleAdmin), reviewHandler.AdminSignOff)

			// Commercial Metrics & Billing Ledger
			protected.GET("/billing/metrics", auth.RequireRole(models.RoleAdmin, models.RoleInsurer), billingHandler.GetMetrics)
			protected.GET("/billing/ledger", auth.RequireRole(models.RoleAdmin, models.RoleInsurer), billingHandler.GetLedger)
			protected.GET("/insurers", billingHandler.ListInsurers)
		}
	}

	addr := fmt.Sprintf(":%s", cfg.Port)
	log.Printf("✅ Server listening on %s", addr)
	if err := r.Run(addr); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
