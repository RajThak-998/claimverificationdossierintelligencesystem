package storage

import (
	"context"
	"fmt"
	"io"
	"net/url"
	"strings"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

// MinIOStorageProvider connects to any S3-compatible service (AWS S3, MinIO, Cloudflare R2).
type MinIOStorageProvider struct {
	client *minio.Client
	bucket string
}

func NewMinIOStorageProvider(endpoint, accessKey, secretKey, bucket string, useSSL bool, region ...string) (*MinIOStorageProvider, error) {
	cleanEndpoint := strings.TrimPrefix(endpoint, "http://")
	cleanEndpoint = strings.TrimPrefix(cleanEndpoint, "https://")

	reg := "ap-south-1"
	if len(region) > 0 && region[0] != "" {
		reg = region[0]
	}

	client, err := minio.New(cleanEndpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: useSSL,
		Region: reg,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to init minio client: %w", err)
	}

	// Auto-create bucket if it doesn't exist
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	exists, err := client.BucketExists(ctx, bucket)
	if err == nil && !exists {
		_ = client.MakeBucket(ctx, bucket, minio.MakeBucketOptions{Region: reg})
	}

	return &MinIOStorageProvider{
		client: client,
		bucket: bucket,
	}, nil
}

func (m *MinIOStorageProvider) UploadFile(ctx context.Context, file io.Reader, path string, size int64, contentType string) (string, error) {
	cleanPath := strings.TrimPrefix(path, "/")
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	info, err := m.client.PutObject(ctx, m.bucket, cleanPath, file, size, minio.PutObjectOptions{
		ContentType: contentType,
	})
	if err != nil {
		return "", fmt.Errorf("failed to put object %s: %w", cleanPath, err)
	}

	return info.Key, nil
}

func (m *MinIOStorageProvider) DownloadFile(ctx context.Context, path string) (io.ReadCloser, error) {
	cleanPath := strings.TrimPrefix(path, "/")
	obj, err := m.client.GetObject(ctx, m.bucket, cleanPath, minio.GetObjectOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to get object %s: %w", cleanPath, err)
	}
	return obj, nil
}

func (m *MinIOStorageProvider) GetSignedURL(ctx context.Context, path string, expiry time.Duration) (string, error) {
	cleanPath := strings.TrimPrefix(path, "/")
	reqParams := make(url.Values)
	presignedURL, err := m.client.PresignedGetObject(ctx, m.bucket, cleanPath, expiry, reqParams)
	if err != nil {
		return "", fmt.Errorf("failed to generate presigned URL: %w", err)
	}
	return presignedURL.String(), nil
}

func (m *MinIOStorageProvider) DeleteFile(ctx context.Context, path string) error {
	cleanPath := strings.TrimPrefix(path, "/")
	return m.client.RemoveObject(ctx, m.bucket, cleanPath, minio.RemoveObjectOptions{})
}
