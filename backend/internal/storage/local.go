package storage

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// LocalStorageProvider implements StorageProvider using a base directory on disk.
type LocalStorageProvider struct {
	baseDir string
	baseURL string
}

func NewLocalStorageProvider(baseDir, baseURL string) (*LocalStorageProvider, error) {
	if err := os.MkdirAll(baseDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create base storage dir: %w", err)
	}
	return &LocalStorageProvider{
		baseDir: baseDir,
		baseURL: strings.TrimRight(baseURL, "/"),
	}, nil
}

func (l *LocalStorageProvider) resolve(relPath string) string {
	clean := filepath.Clean(relPath)
	clean = strings.TrimPrefix(clean, "/")
	return filepath.Join(l.baseDir, clean)
}

func (l *LocalStorageProvider) UploadFile(ctx context.Context, file io.Reader, path string, size int64, contentType string) (string, error) {
	fullPath := l.resolve(path)
	if err := os.MkdirAll(filepath.Dir(fullPath), 0755); err != nil {
		return "", fmt.Errorf("failed to create dir: %w", err)
	}

	out, err := os.Create(fullPath)
	if err != nil {
		return "", fmt.Errorf("failed to create file: %w", err)
	}
	defer out.Close()

	if _, err := io.Copy(out, file); err != nil {
		return "", fmt.Errorf("failed to write data: %w", err)
	}

	url := fmt.Sprintf("%s/storage/%s", l.baseURL, strings.TrimPrefix(filepath.ToSlash(path), "/"))
	return url, nil
}

func (l *LocalStorageProvider) DownloadFile(ctx context.Context, path string) (io.ReadCloser, error) {
	fullPath := l.resolve(path)
	f, err := os.Open(fullPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open file %s: %w", path, err)
	}
	return f, nil
}

func (l *LocalStorageProvider) GetSignedURL(ctx context.Context, path string, expiry time.Duration) (string, error) {
	url := fmt.Sprintf("%s/storage/%s", l.baseURL, strings.TrimPrefix(filepath.ToSlash(path), "/"))
	return url, nil
}

func (l *LocalStorageProvider) DeleteFile(ctx context.Context, path string) error {
	fullPath := l.resolve(path)
	return os.Remove(fullPath)
}
