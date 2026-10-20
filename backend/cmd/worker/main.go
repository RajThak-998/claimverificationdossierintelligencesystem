package main

import (
	"context"
	"encoding/json"
	"log"
	"os"
	"os/signal"
	"syscall"

	"motor-platform/internal/config"
	"motor-platform/internal/database"
	"motor-platform/internal/pdf"
	"motor-platform/internal/storage"
	"motor-platform/internal/worker"

	"github.com/hibiken/asynq"
)

type StitchTaskPayload struct {
	CaseID      string `json:"case_id"`
	RecordingID string `json:"recording_id"`
}

type DossierTaskPayload struct {
	CaseID string `json:"case_id"`
}

func main() {
	log.Println("🛠️ Starting Motor Claim Verification Background Worker Daemon...")

	cfg := config.LoadConfig()

	// Storage
	var storageProvider storage.StorageProvider
	var err error
	if cfg.StorageDriver == "minio" || cfg.StorageDriver == "s3" {
		storageProvider, err = storage.NewMinIOStorageProvider(
			cfg.StorageEndpoint,
			cfg.StorageAccessKey,
			cfg.StorageSecretKey,
			cfg.StorageBucket,
			cfg.StorageUseSSL,
		)
		if err != nil {
			storageProvider, _ = storage.NewLocalStorageProvider(cfg.StorageBaseDir, cfg.StorageBaseURL)
		}
	} else {
		storageProvider, _ = storage.NewLocalStorageProvider(cfg.StorageBaseDir, cfg.StorageBaseURL)
	}

	// Database
	db, err := database.InitDB(cfg)
	if err != nil {
		cfg.DBDriver = "sqlite"
		cfg.DBDSN = "motor_claims.db"
		db, _ = database.InitDB(cfg)
	}

	stitcher := worker.NewStitcher(db, storageProvider)
	pdfGen := pdf.NewGenerator(db, storageProvider, cfg.StorageBaseURL)

	// Redis Asynq Server setup
	srv := asynq.NewServer(
		asynq.RedisClientOpt{
			Addr:     cfg.RedisAddr,
			Password: cfg.RedisPassword,
		},
		asynq.Config{
			Concurrency: 4, // Pillar 3: Controlled concurrency to prevent host CPU starvation
			Queues: map[string]int{
				"critical": 6,
				"default":  3,
				"low":      1,
			},
		},
	)

	mux := asynq.NewServeMux()

	mux.HandleFunc("recording:stitch", func(ctx context.Context, t *asynq.Task) error {
		var p StitchTaskPayload
		if err := json.Unmarshal(t.Payload(), &p); err != nil {
			return err
		}
		return stitcher.StitchRecording(ctx, p.CaseID, p.RecordingID)
	})

	mux.HandleFunc("dossier:pdf", func(ctx context.Context, t *asynq.Task) error {
		var p DossierTaskPayload
		if err := json.Unmarshal(t.Payload(), &p); err != nil {
			return err
		}
		return pdfGen.CompileDossier(ctx, p.CaseID)
	})

	go func() {
		if err := srv.Run(mux); err != nil {
			log.Printf("Asynq server note: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("Shutting down worker daemon gracefully...")
	srv.Shutdown()
}
