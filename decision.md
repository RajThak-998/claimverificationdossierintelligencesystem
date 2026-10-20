# 🏛️ Architecture & Engineering Decision Records (decision.md)
### Motor Claim Verification & Dossier Intelligence Platform

This document logs all critical architectural, security, design, and implementation decisions made throughout the platform lifecycle, along with the technical rationale, tradeoffs, and compliance justifications.

---

## Decision Index

| ID | Title | Date | Status | Category |
|---|---|---|---|---|
| **DEC-001** | Dual-Tier Go REST Backend & React SPA Architecture | 2026-10-20 | Approved | System Architecture |
| **DEC-002** | Storage Abstraction Layer (S3 / MinIO / Local) | 2026-10-20 | Approved | Storage & Persistence |
| **DEC-003** | 5-Second MediaRecorder Chunking over Multipart Stream | 2026-10-20 | Approved | Media Pipeline |
| **DEC-004** | Decoupled Background Worker Queue with 202 Accepted | 2026-10-20 | Approved | Asynchronous Processing |
| **DEC-005** | PostgreSQL 16 with JSONB Dynamic Observation Engine | 2026-10-20 | Approved | Database & Data Modeling |
| **DEC-006** | Stateless JWT Auth with Composable Role-Based Access Control | 2026-10-20 | Approved | Security & RBAC |
| **DEC-007** | Strict UTC Database Persistence with Presentation-Layer IST | 2026-10-20 | Approved | Data Integrity & Timezones |
| **DEC-008** | Non-Floating-Point Integer Seconds for Billable Ledger | 2026-10-20 | Approved | Commercials & Invoicing |
| **DEC-009** | Dual-Stream Web Audio Merging for In-Browser Tele-Verification | 2026-10-20 | Approved | Telephony & Evidence |
| **DEC-010** | Calming, Trust-Inducing UI Design System for Non-Tech Users | 2026-10-20 | Approved | UI/UX Design System |
| **DEC-011** | Tamper-Evident SHA-256 Checksums and Scannable Verification QR | 2026-10-20 | Approved | Legal Defensibility & PDF |
| **DEC-012** | Database Driver Switcher (PostgreSQL Production & SQLite Local/CI) | 2026-10-20 | Approved | Data Persistence |
| **DEC-013** | Graceful Fallback Byte-Concatenation for FFmpeg Stream Copy | 2026-10-20 | Approved | Media Resilience |
| **DEC-014** | Self-Contained HTML/PDF Report with Base64 QR Code Embedding | 2026-10-20 | Approved | Legal PDF Architecture |
| **DEC-015** | Interactive 1-Click Multi-Role Demonstrator Bar | 2026-10-20 | Approved | Testing & Evaluation |

---

## Detailed Decision Records

### DEC-001: Dual-Tier Go REST Backend & React SPA Architecture
* **Context**: The platform needs to handle high concurrency, media streaming, background stitching, and complex interactive UI workflows for non-technical insurance investigators, QA leads, and commercial executives.
* **Decision**: 
  - Backend: Go 1.25+ with Gin web framework, utilizing native goroutines and minimal memory footprint.
  - Frontend: React 18+ with TypeScript, Vite for lightning-fast build/HMR, TailwindCSS for clean, calm styling, and Lucide Icons for clarity.
* **Rationale**:
  - Go compiles to a single, zero-dependency, high-throughput binary with predictable latency and rock-solid native streaming capabilities.
  - React + TypeScript guarantees type safety across complex dossier forms, media events, and state mutations.
  - Complete decoupling enables independent scaling on AWS (ECS/EKS or EC2 behind ALB).

---

### DEC-002: Storage Abstraction Layer (`StorageProvider`)
* **Context**: Hardcoding local paths like `/uploads/...` causes deployment failure in containerized, cloud, or serverless production environments (AWS S3, Cloudflare R2, MinIO).
* **Decision**: Implement a unified `StorageProvider` Go interface with methods `UploadFile`, `DownloadFile`, `GetSignedURL`, and `DeleteFile`. Provide `MinIOStorageProvider` / `S3StorageProvider` and a `LocalStorageProvider` fallback for dev/testing.
* **Rationale**:
  - All database columns (`storage_path`, `master_storage_path`) store relative object keys (e.g. `cases/MOT18221241/recordings/...`), never host-specific file system paths.
  - Switching between local dev, containerized MinIO, and AWS S3 requires changing only `.env` settings (`STORAGE_DRIVER=s3`).

---

### DEC-003: 5-Second MediaRecorder Chunking over Multipart Stream
* **Context**: Single giant blob uploads at the end of 1-2 hour calls fail over field cellular hotspots, exhaust browser heap, and cause total evidence loss on tab close or crash.
* **Decision**: Slice browser media capture into 5-second intervals via `MediaRecorder.start(5000)`, uploading chunks sequentially to `POST /api/v1/cases/:id/recordings/:recId/chunks`.
* **Rationale**:
  - Each chunk is small (~500KB to 1MB), easily transmitted even over degraded 3G/4G.
  - If a disconnect occurs, chunks are buffered in the client queue/IndexedDB and re-sent with exponential backoff.
  - If the tab terminates unexpectedly, 99.8% of call minutes are already persisted on storage.

---

### DEC-004: Decoupled Background Worker Queue with 202 Accepted
* **Context**: Stitching dozens of video chunks via FFmpeg, calculating SHA-256 hashes, and rendering multipage PDFs takes 5–30+ seconds. Running this on HTTP request threads blocks the server and triggers gateway timeouts.
* **Decision**: HTTP submission and sign-off endpoints return `202 Accepted` immediately, enqueuing background tasks to Redis via Asynq / Go worker pool.
* **Rationale**:
  - Keeps HTTP response latency under 30ms.
  - Isolates worker CPU usage with controlled worker concurrency (e.g., 4 concurrent jobs) to prevent server CPU starvation.
  - Provides automatic retries and dead-letter queue (DLQ) support.

---

### DEC-005: PostgreSQL 16 with JSONB Dynamic Observation Engine
* **Context**: Investigation observation schemas differ significantly between Heavy Commercial Vehicles (weighbridge, national permit, cleaner statement, loading challan) and Light Motor Vehicles (pillion rider, family relation, private garage). Hardcoding fixed columns requires destructive migrations for every new vehicle class or insurer requirement.
* **Decision**: Store structured observation findings and closure conclusions in PostgreSQL `JSONB` columns (`observations_data`, `conclusion_data`), validated against vehicle-class schemas stored in `observation_templates`.
* **Rationale**:
  - Zero-downtime additions of specialized investigation questions.
  - Retains relational integrity for core entities (cases, insurers, users, contacts, recordings, billing) while providing document flexibility for observation details.

---

### DEC-006: Stateless JWT Auth with Composable Role-Based Access Control (RBAC)
* **Context**: Platform serves 4 distinct personas (Admin, Manager, Agent, Insurer) with strict data isolation and permission boundaries.
* **Decision**: Issue stateless cryptographic HMAC-SHA256 JWT tokens containing `user_id`, `role`, and `tenant_id`. Authorization enforced via composable Gin middleware: `RequireRole("ADMIN", "MANAGER", ...)` and row-level SQL filtering.
* **Rationale**:
  - Eliminates server session state in memory, allowing instant horizontal scaling.
  - Row-level filtering prevents horizontal privilege escalation (agents only access their assigned cases; insurers only access their company's completed cases).

---

### DEC-007: Strict UTC Database Persistence with Presentation-Layer IST
* **Context**: Commercial claims in Indian insurance must be legally defensible with zero dispute over intimation timestamps, loss dates, and call durations.
* **Decision**: Persist all timestamps in PostgreSQL as `TIMESTAMPTZ` in pure UTC. Format to Indian Standard Time (`IST / UTC+05:30`) strictly at the UI display layer and PDF dossier generation template.
* **Rationale**:
  - Avoids DST discrepancies, server timezone configuration errors, and cross-region serialization mismatches.

---

### DEC-008: Non-Floating-Point Integer Seconds for Billable Ledger
* **Context**: Fractional minutes (e.g., 18.42 minutes) lead to rounding discrepancies and billing disputes with insurers.
* **Decision**: All recording durations are persisted as strict integer seconds (`duration_seconds: 1104`). The commercial billing engine uses contractual ceiling arithmetic: `billable_minutes = CEIL(duration_seconds / 60)`.
* **Rationale**:
  - Exact mathematical reproducibility.
  - Insurers can audit each second of call time against the SHA-256 verified master recording.

---

### DEC-009: Dual-Stream Web Audio Merging for Tele-Verification
* **Context**: Standard browser screen sharing captures only tab audio (remote claimant) or microphone audio (investigator), leaving one party muted and invalidating the legal standing of the recorded statement.
* **Decision**: Use Web Audio API `AudioContext` and `MediaStreamDestination` to mix the microphone input stream and the WhatsApp Web browser tab audio stream into a single synchronized audio track combined with the screen video track.
* **Rationale**:
  - Legally admissible, dual-party audio record.
  - Automatically alerts the investigator with a banner if "Also share tab audio" was omitted in the browser prompt.

---

### DEC-010: Calming, Trust-Inducing UI Design System for Non-Tech Users
* **Context**: Claims investigators, garage assessors, and QA clerks often have low technical proficiency and work under high pressure. Busy or cluttered interfaces increase error rates.
* **Decision**: Develop a clean, soothing UI with deep slate and ocean navy primary tones, crisp mint/emerald verification indicators, soft amber warnings, high legibility typography, clear button labels, and 1-click workflows.
* **Rationale**:
  - Minimizes cognitive load and reduces operational mistakes.
  - Fosters confidence, trust, and professional calm during stressful investigations.

---

### DEC-011: Tamper-Evident SHA-256 Checksums and Scannable Verification QR
* **Context**: Insurance dossiers are presented before claim rejection committees and court tribunals (MACT). Proof of untampered evidence is paramount.
* **Decision**: Compute SHA-256 cryptographic checksums of the concatenated recording, print the 64-character hex hash on Page 1 of the Certified PDF Dossier, and embed a scannable QR code resolving to a public verification endpoint.
* **Rationale**:
  - Any alteration to the media file or dossier invalidates the checksum.
  - Court auditors can instantly scan the QR code to verify validity against the platform's public cryptographic registry.

---

### DEC-012: Database Driver Switcher (PostgreSQL Production & SQLite Local/CI)
* **Context**: Production on AWS requires PostgreSQL 16 with UUID and JSONB support, while local developers, automated CI/CD runners, and fast test suites must be able to boot instantly without spinning up a full PostgreSQL cluster.
* **Decision**: Support both `DB_DRIVER=postgres` and `DB_DRIVER=sqlite` using GORM dialectors, custom `JSONMap` scanner/valuer, and automatic schema migrations.
* **Rationale**:
  - Zero-friction developer onboarding and lightning-fast test execution (< 1 second for full integration suites).
  - Production deployments on AWS simply set `DB_DRIVER=postgres` with zero code changes.

---

### DEC-013: Graceful Fallback Byte-Concatenation for FFmpeg Stream Copy
* **Context**: In real-world field conditions or container environments where FFmpeg might encounter malformed chunk headers or missing codecs, video stitching must not crash the worker or lose recorded evidence.
* **Decision**: Attempt stream-copy concatenation via `ffmpeg -c copy`. If FFmpeg exits with an error, gracefully fallback to byte-wise chunk concatenation and calculate SHA-256 over the assembled stream.
* **Rationale**:
  - 100% fault-tolerant evidence retention.
  - Guarantees that neither workers nor background jobs ever crash or stall when processing field uploads.

---

### DEC-014: Self-Contained HTML/PDF Report with Base64 QR Code Embedding
* **Context**: PDF dossiers must be scannable and verifiable both in printed paper format and in digital viewing across all devices without depending on third-party external CDN image URLs.
* **Decision**: Render legal dossiers using self-contained HTML templates with inline CSS and base64-embedded QR codes generated server-side via `github.com/skip2/go-qrcode`.
* **Rationale**:
  - Works offline, in air-gapped environments, and in courtrooms without external network dependencies.
  - Instant in-browser preview and print-to-PDF fidelity.

---

### DEC-015: Interactive 1-Click Multi-Role Demonstrator Bar
* **Context**: Stakeholders, non-technical insurance managers, and auditors evaluating the platform must be able to test all 4 personas (Admin, Manager, Agent, Insurer) seamlessly without manually logging in and out with different passwords.
* **Decision**: Provide 1-click persona switching buttons on the login screen and an interactive profile switcher in the top navigation bar.
* **Rationale**:
  - Greatly simplifies evaluation and user acceptance testing (UAT).
  - Demonstrates strict RBAC row-level data isolation dynamically.

