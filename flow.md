# 🌊 End-to-End System & Operational Workflows (flow.md)
### Motor Claim Verification & Dossier Intelligence Platform

This document describes the operational flow of data, state machines, user personas, background jobs, and error recovery lifecycles across the platform.

---

## 1. High-Level System Architecture & Flow

```mermaid
flowchart TD
    %% Personas
    ADMIN["👑 Admin / MD"]
    MGR["👔 QA Manager"]
    AGENT["🕵️ Investigator Agent"]
    INSURER["🏢 Client Insurer"]

    %% Intake
    INTAKE["Intake: Bulk CSV / Manual Add / API"] -->|Creates| UNASSIGNED["1. UNASSIGNED"]
    
    %% Assignment
    MGR -->|Assigns with Load Balancing| UNASSIGNED
    ADMIN -->|Assigns / Reassigns| UNASSIGNED
    UNASSIGNED -->|Assigned| WIP["2. WORK IN PROGRESS (WIP)"]

    %% Investigation in WIP
    subgraph WIP_Workbench ["Agent Investigation Workbench (7-Section Dossier)"]
        direction TB
        W1["WhatsApp Web Deep-Link & 'Chat & Record'"]
        W2["Browser Audio Mixer (Mic + Tab Audio)"]
        W3["5-Second MediaRecorder Slices to Storage"]
        W4["Live Video Screenshots & Evidence Uploads"]
        W5["Call Log & Follow-up Recall Timer"]
        W6["10 Mandatory Observation Findings (*)"]
        W7["Cascading Repudiation & Conclusion"]
        W1 --> W2 --> W3
    end
    WIP --> WIP_Workbench

    %% Submission & QA
    WIP_Workbench -->|Save Draft| WIP
    WIP_Workbench -->|Submit & Lock (* Validated)| REVIEW["3. REVIEW (QA Audit)"]
    
    %% Manager QA
    MGR -->|Audit Video & Observations| REVIEW
    REVIEW -->|Deficiency Found / Reject with Remarks| WIP
    REVIEW -->|Approve| ADMIN_SIGNOFF["4. ADMIN SIGN-OFF"]

    %% Admin Sign-Off & Release
    ADMIN -->|Commercial & Duration Audit| ADMIN_SIGNOFF
    ADMIN_SIGNOFF -->|Sign-Off Executed| COMPLETED["5. COMPLETED"]

    %% Async Background Compilation (202 Accepted)
    subgraph AsyncWorker ["Asynchronous Worker Queue (Redis + Asynq)"]
        direction TB
        B1["FFmpeg Stream-Copy Chunk Concatenation"]
        B2["SHA-256 Checksum Calculation"]
        B3["Tamper-Evident PDF Dossier Compilation with QR Code"]
        B4["Billing Ledger Calculation (Ceil Minutes * Rate)"]
        B1 --> B2 --> B3 --> B4
    end
    COMPLETED --> AsyncWorker

    %% Release & Release
    AsyncWorker --> VAULT["Archived Dossier Vault"]
    VAULT -->|Certified PDF & Master Audio/Video| INSURER
    VAULT -->|Commercial Billing Ledger & Invoices| ADMIN
```

---

## 2. Granular Step-by-Step Operational Flows

### Flow 1: Case Intake & Triage
1. **Intake Channel**: Manager or Admin uploads a bulk CSV batch or opens `+ Add Case` modal.
2. **Field Parsing & Validation**:
   - Case ID (e.g. `MOT18221241`, unique constraint).
   - Insurer ID, Insured Name, Vehicle Reg No, Policy No, Vehicle Class (`HEAVY_VEHICLE` vs `LMV`), Claim Type (`OD`, `TP`, `IBNR`, `281`).
   - Incident Details: Loss Date, Intimation Date, State, District, Cause of Loss, Insurer Trigger Narrative.
3. **Database Insertion**:
   - Case persisted in `cases` table with status `UNASSIGNED`.
   - Contact numbers parsed and inserted into `case_contacts` table (`INSURED`, `OWNER`, `DRIVER`).
   - Audit trail recorded in `case_audit_logs`.
4. **Display**: Appears immediately on Cases Intelligence Vault grid with status pill `UNASSIGNED` and real-time aging counter badge (`AGING: 0D`).

---

### Flow 2: Agent Assignment & Rebalancing
1. **Manager Action**: In Cases Vault grid or Dossier Modal, Manager views unassigned cases.
2. **Workload Visibility**: The assignment dropdown displays each agent's live active caseload (e.g. `Palak Gupta (12 active)`).
3. **Assignment Execution**:
   - Manager selects investigator.
   - Status transitions to `WORK_IN_PROGRESS`.
   - `assigned_agent_id` and `assigned_at` (UTC) recorded.
   - If reassigned from a prior agent, `is_reassigned = true` flag triggers an amber `REASSIGNED` pill and logs prior agent details in audit table.

---

### Flow 3: Tele-Verification & In-Browser Media Capture
1. **Agent Launches Session**: Agent opens Dossier Modal Section 2 and clicks **Chat & Record** next to contact.
2. **WhatsApp Web Deep Link**: System opens `https://web.whatsapp.com/send?phone=...` in a new browser tab.
3. **Hardware Stream Acquisition**:
   - Browser requests `getDisplayMedia` (agent chooses WhatsApp Web tab and checks "Also share tab audio").
   - Browser requests `getUserMedia` (agent's microphone).
   - Web Audio mixer blends both audio sources into a single stream.
4. **5-Second Chunking Loop**:
   - `MediaRecorder.start(5000)` fires every 5000ms.
   - Each chunk blob is pushed to client queue and uploaded to `POST /api/v1/cases/:id/recordings/:recId/chunks`.
   - Chunks stored in MinIO/S3 under `cases/:case_id/recordings/:rec_id/chunks/chunk_00000X.webm`.
5. **Live Snapshots**: While interrogating driver/insured, agent captures frame snapshots (hotkey/button). Saved to `case_screenshots`.
6. **Session Stop**: Agent clicks **Stop Recording**. Call duration is calculated in raw seconds and added to the case's cumulative recorded duration badge.

---

### Flow 4: Follow-up Call Logs & Recall Timers
1. If claimant line is busy or unanswered, agent chooses call disposition:
   - `GENERAL_NOTE`, `LINE_BUSY`, `RINGING_NO_ANSWER`, `ASKED_FOR_CALLBACK`, `HOSTILE_REFUSED`.
2. Agent selects **Recall Timer** (`15M`, `30M`, `1H`, `2H`, `4H`, `1D`, or `CUSTOM`).
3. Record saved in `call_logs` with UTC `recall_at`.
4. Platform notifies the agent when recall is due, highlighting the case in the Agent Hub.

---

### Flow 5: 10 Compulsory Observation Findings & Dynamic Forms
1. Agent opens Section 6 of Dossier Modal.
2. System loads schema template based on `vehicle_class` (`HEAVY_VEHICLE` vs `LMV`).
3. Agent populates the 10 compulsory fields (*):
   1. Insured Version (*)
   2. Driver Version (*)
   3. Pillion Rider / Cleaner Version (*)
   4. Relation with Insured / Driver (*)
   5. KYC Documents of All Contacted (*)
   6. Profession of Contacted (*)
   7. Hospital / Injury Remarks (*)
   8. Damages & Garage Remarks (*)
   9. Social Media & News Verification (*)
   10. Evidences Remarks (*)
4. **Section 7 Closure**:
   - Agent selects `Success Tagging (*)` (`Genuine`, `Repudiated`, `Compromised`, `Claim Withdrawn`).
   - If `Repudiated`, cascading dropdown displays dynamic repudiation grounds (`Driver Implant`, `Pre-Existing Damages`, `Invalid Permit`, `Overloading`, `Drunk & Drive`, `Staged Accident`).
   - Agent inputs Final Remarks (*).
5. **Save as Draft**: Persists data to PostgreSQL `JSONB` without validation; status remains `WORK_IN_PROGRESS`.
6. **Submit Report & Lock Case**: Validates all compulsory fields. On success, locks form editing and transitions status to `REVIEW`.

---

### Flow 6: QA Review & Manager Rework Loop
1. Manager inspects cases in `REVIEW` queue.
2. Manager plays back recorded tele-verification sessions and audits observation answers against uploaded documents (RC, DL, FIR, Weighbridge Slip).
3. **Branch A - Deficiency Identified (Rework)**:
   - Manager clicks **Reject to WIP** and enters mandatory rejection remarks.
   - Status reverts to `WORK_IN_PROGRESS`.
   - Case receives `REWORK` badge and agent is alerted with manager's specific deficiency notes.
4. **Branch B - Quality Passed**:
   - Manager clicks **Approve**.
   - Case advances to `ADMIN_SIGN_OFF`.

---

### Flow 7: Commercial Sign-Off & Asynchronous Release
1. Admin inspects cases in `ADMIN_SIGN_OFF`.
2. Admin reviews total recorded seconds and billable rate card.
3. Admin clicks **Sign-Off & Complete**:
   - Status transitions to `COMPLETED`.
   - API immediately returns `HTTP 202 Accepted`.
4. **Worker Queue (`hibiken/asynq`) takes over**:
   - Task `recording:stitch`: concatenates 5-second WebM chunks via `ffmpeg -c copy`.
   - Task `recording:hash`: calculates SHA-256 cryptographic checksum.
   - Task `dossier:pdf`: renders 6-page tamper-evident PDF with IST timestamps, SHA-256 hash stamp, and verification QR code.
   - Task `ledger:invoice`: records `recording_duration_seconds`, `billable_minutes = CEIL(duration / 60)`, and billed amount into `billing_ledger`.
5. Insurer portal gains instant access to download the certified PDF and view SHA-256 verification status.

---

### Flow 8: Public Cryptographic Verification Flow
1. Claims auditor or court official scans QR code on Page 1 of the PDF dossier.
2. Scanned URL opens `GET /api/v1/public/verify/dossier/:uuid`.
3. Platform validates the cryptographic checksum against database and storage records.
4. Auditor sees instant "✅ CERTIFIED UNTAMPERED" verification badge with full chain of custody and option to stream master recording.

---

## 3. End-to-End Verification & Automated Test Status

| Phase / Flow | Component / Endpoint | Test Type | Status | Verified Behavior |
|---|---|---|---|---|
| **Phase 0 & 1** | `POST /api/v1/auth/login` | Unit & E2E | ✅ PASS | Issue JWT with claims (`user_id`, `role`, `tenant_id`), reject invalid passwords with 401 |
| **Phase 1** | `GET /api/v1/cases` | Integration | ✅ PASS | RBAC row-level isolation (Admin global, Agent assigned-only, Insurer completed-only) |
| **Phase 1** | `POST /api/v1/cases/bulk-import` | Integration | ✅ PASS | CSV parsing, case numbering, primary contact auto-registration |
| **Phase 2** | `POST /api/v1/cases/:id/recordings/:recId/chunks` | Integration | ✅ PASS | 5-second slice streaming, relative storage persistence, duration increment |
| **Phase 2** | `GET /api/v1/calls/due-recalls` | Integration | ✅ PASS | Window-based recall query (`<= NOW() + 2h`), overdue flag calculation |
| **Phase 3** | `POST /api/v1/cases/:id/observations/draft` | Unit & E2E | ✅ PASS | Partial JSONB save without validation, case remains in `WORK_IN_PROGRESS` |
| **Phase 3** | `POST /api/v1/cases/:id/submit` | Unit & E2E | ✅ PASS | Strict 10 compulsory fields (*) validation, 422 on missing, transition to `REVIEW` |
| **Phase 4 & 5** | `POST /api/v1/cases/:id/review/reject` | Unit & E2E | ✅ PASS | Rework loop: returns to `WORK_IN_PROGRESS`, increments `rework_count`, audit logs remarks |
| **Phase 4 & 5** | `POST /api/v1/cases/:id/admin/sign-off` | Unit & E2E | ✅ PASS | 202 Accepted returned, asynchronous video stitching, SHA-256 calculation, PDF generation |
| **Phase 4** | `GET /api/v1/public/verify/dossier/:uuid` | E2E | ✅ PASS | Public endpoint returns `AUTHENTIC_UNTAMPERED`, SHA-256 checksum, recorded seconds |
| **Phase 5** | `GET /api/v1/billing/metrics` | E2E | ✅ PASS | Integer second summation, `CEIL(duration / 60)` billable minutes, rate card calculation |
| **Frontend** | `npm run build` (React + TypeScript) | Build | ✅ PASS | Clean Vite compilation in 1.84s, zero type errors, Tailwind bundle generated |

