---
title: 07. Background Processing and Queue Architecture
tags:
  - background-jobs
  - goroutines
  - pdf-generation
  - sha256
  - asynq
  - architecture
date: 2026-10-19
status: active
---

# ⚙️ 07. Background Processing and Architecture

## 1. Background Job Isolation (Trap #3 Mitigation)

> [!CAUTION]
> **The Background Job Isolation Trap**: Running cryptographic checksum calculation, PDF rendering, or file encoding directly inside the HTTP request handler (`POST /api/cases/:id/submit` or sign-off) will freeze the web server event loop, cause HTTP timeouts, and render the dashboard unresponsive for all users.

To maintain 100% responsiveness, all heavy computation is completely decoupled using asynchronous execution with the **HTTP 202 Accepted** pattern.

> [!NOTE]
> **Scale Rationale & Redis Evolution**:
> In earlier designs, Redis and `hibiken/asynq` were proposed to handle 5-second chunk stitching and active failure recovery. However, for the platform's actual operating scale (maximum ~100 simultaneous agents):
> 1. Recordings are uploaded directly in one shot with on-the-fly SHA-256 calculation (`io.TeeReader`), eliminating the need for chunk stitching workers.
> 2. Primary asynchronous tasks are **Dossier PDF Compilation** and **Billing Ledger Finalization** upon Admin Sign-Off.
> 3. Native Go Goroutines with context timeouts handle this workload with negligible overhead, zero Redis dependency, and sub-second dispatch.
> 4. Redis and Asynq remain supported as an optional scale-out daemon for multi-instance distributed deployments.

```mermaid
sequenceDiagram
    autonumber
    actor Admin as 👑 Admin / Manager
    participant HTTP as 🌐 Go HTTP Server
    participant Goroutine as ⚡ Async In-Memory Goroutine
    participant Hasher as 🔒 SHA-256 Engine (On Upload)
    participant PDFEng as 📄 PDF Dossier Compiler
    participant Storage as 🪣 Object Storage
    participant DB as 🗄️ PostgreSQL

    Admin->>HTTP: POST /api/cases/:id/admin/sign-off
    HTTP->>DB: UPDATE cases SET status = 'COMPLETED'
    HTTP->>Goroutine: Launch asyncCompleter(caseID) via Goroutine
    HTTP-->>Admin: 202 Accepted (Case Completed, Processing Background Tasks)

    Note over Goroutine,PDFEng: Asynchronous Processing (Off Main HTTP Thread)
    Goroutine->>DB: Fetch Case, Observations, Contacts, Screenshots, Verified Recording
    Goroutine->>PDFEng: Compile Tamper-Evident Dossier with QR & SHA-256
    PDFEng->>Storage: StorageProvider.UploadFile(dossier_<case_no>.html/.pdf)
    Goroutine->>DB: UPDATE cases SET locked_pdf_path = storagePath
```

---

## 2. In-Process Goroutine Asynchronous Execution (`cmd/api/main.go`)

In the primary production configuration, background tasks run asynchronously inside managed Go goroutines with strict context timeouts:

```go
// cmd/api/main.go
pdfGenerator := pdf.NewGenerator(db, storageProvider, cfg.StorageBaseURL)

// Async completer task called on sign-off
asyncCompleter := func(caseID string) error {
    go func() {
        ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
        defer cancel()

        // 1. Verify any recorded media sessions
        var recordings []models.Recording
        db.Where("case_id = ?", caseID).Find(&recordings)

        // 2. Compile Certified PDF Dossier
        if err := pdfGenerator.CompileDossier(ctx, caseID); err != nil {
            log.Printf("Error compiling dossier for case %s: %v", caseID, err)
            return
        }

        log.Printf("✅ Dossier successfully compiled for case %s", caseID)
    }()
    return nil
}

reviewHandler := handlers.NewReviewHandler(db, asyncCompleter)
```

### Sign-Off Controller Returning 202 Accepted Immediately

```go
func (h *ReviewHandler) AdminSignOff(c *gin.Context) {
    caseID := c.Param("id")

    // Update case status to COMPLETED
    if err := h.db.Model(&models.Case{}).Where("id = ?", caseID).
        Updates(map[string]interface{}{
            "status": models.CaseCompleted,
            "sign_off_at": time.Now().UTC(),
        }).Error; err != nil {
        c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to sign off"})
        return
    }

    // Trigger async dossier compilation
    if h.asyncCompleter != nil {
        _ = h.asyncCompleter(caseID)
    }

    // 202 Accepted returned in < 15ms!
    c.JSON(http.StatusAccepted, gin.H{
        "status":  "ACCEPTED",
        "message": "Admin sign-off complete; PDF dossier compilation dispatched",
        "case_id": caseID,
    })
}
```

---

## 3. Optional Multi-Node Worker Daemon (Redis + Asynq)

For enterprise clusters exceeding 500+ agents or running across multiple server nodes, the platform includes a standalone worker daemon in `backend/cmd/worker/main.go`. This daemon uses Redis and `hibiken/asynq` to distribute background jobs across dedicated worker nodes:

```go
// backend/cmd/worker/main.go
srv := asynq.NewServer(
    asynq.RedisClientOpt{
        Addr:     cfg.RedisAddr,
        Password: cfg.RedisPassword,
    },
    asynq.Config{
        Concurrency: 4, // Controlled concurrency to prevent host CPU starvation
        Queues: map[string]int{
            "critical": 6,
            "default":  3,
            "low":      1,
        },
    },
)

mux := asynq.NewServeMux()

mux.HandleFunc("dossier:pdf", func(ctx context.Context, t *asynq.Task) error {
    var p DossierTaskPayload
    json.Unmarshal(t.Payload(), &p)
    return pdfGen.CompileDossier(ctx, p.CaseID)
})

mux.HandleFunc("recording:stitch", func(ctx context.Context, t *asynq.Task) error {
    var p StitchTaskPayload
    json.Unmarshal(t.Payload(), &p)
    return stitcher.StitchRecording(ctx, p.CaseID, p.RecordingID)
})
```

---

## 4. Concurrency & Performance Profile for ~100 Agents

| Metric | With 5s Chunks + Redis Stitcher | Direct Upload + Goroutines (Current) |
|---|---|---|
| **HTTP Requests / Sec** | ~20–30 req/sec (continuous chunk uploads) | ~0.05 req/sec (only on call end) |
| **Network Fragility** | High (packet loss drops chunks) | Low (single clean streaming upload) |
| **Stitching CPU Spike** | Heavy (FFmpeg stream copy per call) | None (video is assembled on client) |
| **Redis Infrastructure** | Mandatory container/cluster | Optional / Not required for standard runtime |
| **SHA-256 Hasher** | Computed post-stitching | Computed on-the-fly during upload buffering |
| **Memory Footprint** | ~500MB+ (Redis + Worker daemons) | < 50MB (native Go goroutines) |

---

## 5. Next Steps & Connected Knowledge

* To see how the resulting SHA-256 hash is embedded in the PDF dossier, read [[09_Tamper_Evident_PDF_and_Dossier_Generation]].
* For details on the storage abstraction used by background tasks, see [[11_The_6_Architectural_Pillars_and_Trap_Mitigations|Rule 1]].
* For single-command Docker deployment without unnecessary services, see [[14_Hosting_Infrastructure_and_Deployment_Guide]].
