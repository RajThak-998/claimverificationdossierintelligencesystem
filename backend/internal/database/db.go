package database

import (
	"fmt"

	"motor-platform/internal/config"
	"motor-platform/internal/models"

	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// InitDB initializes PostgreSQL or SQLite based on configuration
func InitDB(cfg *config.Config) (*gorm.DB, error) {
	var dialector gorm.Dialector

	if cfg.DBDriver == "postgres" {
		dialector = postgres.Open(cfg.DBDSN)
	} else {
		// SQLite fallback for standalone / tests
		dialector = sqlite.Open(cfg.DBDSN)
	}

	gormConfig := &gorm.Config{
		Logger: logger.Default.LogMode(logger.Warn),
	}

	db, err := gorm.Open(dialector, gormConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to database (%s): %w", cfg.DBDriver, err)
	}

	// Auto-migrate tables
	if err := AutoMigrate(db); err != nil {
		return nil, fmt.Errorf("failed to auto-migrate: %w", err)
	}

	return db, nil
}

// AutoMigrate migrates all schema tables
func AutoMigrate(db *gorm.DB) error {
	return db.AutoMigrate(
		&models.Insurer{},
		&models.User{},
		&models.Case{},
		&models.CaseContact{},
		&models.CallLog{},
		&models.Recording{},
		&models.RecordingChunk{},
		&models.CaseDocument{},
		&models.CaseScreenshot{},
		&models.ObservationTemplate{},
		&models.CaseObservation{},
		&models.CaseAuditLog{},
		&models.BillingLedger{},
	)
}
