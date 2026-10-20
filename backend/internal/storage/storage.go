package storage

import (
	"context"
	"io"
	"time"
)

// StorageProvider defines the contract for persistent file operations.
// Critical Pillar #1: Business logic and DB records only reference relative object keys,
// never hardcoded local paths.
type StorageProvider interface {
	UploadFile(ctx context.Context, file io.Reader, path string, size int64, contentType string) (string, error)
	DownloadFile(ctx context.Context, path string) (io.ReadCloser, error)
	GetSignedURL(ctx context.Context, path string, expiry time.Duration) (string, error)
	DeleteFile(ctx context.Context, path string) error
}
