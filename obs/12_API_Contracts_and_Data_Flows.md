---
title: 12. API Contracts and Data Flows
tags:
  - api
  - rest-api
  - openapi
  - contracts
  - endpoints
date: 2026-10-19
status: active
---

# 🔌 12. API Contracts and Data Flows

## 1. Global API Standards

All endpoints adhere to standard RESTful principles:
* **Base URL**: `/api/v1`
* **Authentication**: HTTP Bearer Token (`Authorization: Bearer <jwt_token>`).
* **Content Types**: `application/json` (default), `multipart/form-data` (file & chunk uploads).
* **Timestamps**: All timestamps in request and response payloads are strict **UTC ISO 8601** (`2026-10-19T10:00:00Z`).
* **Durations**: All durations are non-negative integer seconds (`duration_seconds: 1224`).
* **Standard HTTP Codes**:
  * `200 OK`: Request succeeded.
  * `201 Created`: Resource persisted.
  * `202 Accepted`: Asynchronous job enqueued (processing in background).
  * `400 Bad Request`: Malformed payload or validation error.
  * `401 Unauthorized`: Missing or invalid JWT.
  * `403 Forbidden`: User role lacks permission for this action.
  * `404 Not Found`: Case or resource not found.
  * `422 Unprocessable Entity`: Mandatory observation fields missing during submit.

---

## 2. Authentication & Session Endpoints

### `POST /api/v1/auth/login`
Authenticates a user and returns a stateless JWT.
* **Request**:
  ```json
  {
    "email": "agent.palak@agency.com",
    "password": "SecurePassword123!"
  }
  ```
* **Response (200 OK)**:
  ```json
  {
    "token": "eyJhbGciOiJIUzI1NiIsIn...",
    "expires_at": "2026-10-20T10:00:00Z",
    "user": {
      "id": "e2a1b4c3-1111-2222-3333-444455556666",
      "email": "agent.palak@agency.com",
      "full_name": "Palak Gupta",
      "role": "AGENT",
      "team_id": "b3c2d1e0-7777-8888-9999-000011112222"
    }
  }
  ```

---

## 3. Cases Vault Endpoints

### `GET /api/v1/cases`
Queries cases scoped automatically to the caller's role (see [[02_User_Roles_and_RBAC_Matrix]]).
* **Query Parameters**:
  * `status`: `UNASSIGNED | WORK_IN_PROGRESS | REVIEW | ADMIN_SIGN_OFF | COMPLETED`
  * `vehicle_class`: `HEAVY_VEHICLE | LMV`
  * `claim_type`: `OD | TP | IBNR | 281`
  * `search`: Free text search on Case ID, Registration Number, Insured Name, Phone.
  * `page`: integer (default 1), `limit`: integer (default 25).
* **Response (200 OK)**:
  ```json
  {
    "data": [
      {
        "id": "c1f8a3d2-3333-4444-5555-666677778888",
        "case_number": "MOT18221241",
        "status": "WORK_IN_PROGRESS",
        "vehicle_class": "HEAVY_VEHICLE",
        "claim_type": "OD",
        "insured_name": "Ramesh Kumar",
        "vehicle_reg_number": "MH-12-AB-1234",
        "assigned_agent": {
          "id": "e2a1b4c3-...",
          "name": "Palak Gupta",
          "active_cases_count": 12
        },
        "is_reassigned": false,
        "aging_days": 2,
        "total_duration_seconds": 1224,
        "created_at": "2026-10-17T08:30:00Z"
      }
    ],
    "pagination": { "page": 1, "limit": 25, "total_records": 142 }
  }
  ```

### `POST /api/v1/cases/bulk-import`
Imports a batch of claims via CSV or Excel file (`multipart/form-data`).
* **Roles**: Admin, Manager.
* **Response (201 Created)**:
  ```json
  {
    "imported_count": 48,
    "failed_rows": []
  }
  ```

### `PATCH /api/v1/cases/:id/assign`
Assigns or reassigns an investigator to a case.
* **Request**:
  ```json
  {
    "agent_id": "e2a1b4c3-1111-2222-3333-444455556666",
    "reassignment_reason": "Reallocated due to agent medical leave"
  }
  ```

---

## 4. Tele-Verification & Media Streaming Endpoints

### `POST /api/v1/cases/:id/recordings/start`
Initializes a new recording session before starting the WhatsApp Web stream.
* **Request**:
  ```json
  {
    "contact_id": "9a8b7c6d-5555-6666-7777-888899990000"
  }
  ```
* **Response (201 Created)**:
  ```json
  {
    "recording_id": "rec_7f8e9d0c-1234-5678-90ab-cdef12345678",
    "status": "STREAMING",
    "started_at": "2026-10-19T14:00:00Z"
  }
  ```

### `POST /api/v1/cases/:id/recordings/:recId/chunks`
Streams sequential 5-second media slices from the browser (see [[06_Tele_Verification_and_Media_Recording_Pipeline]]).
* **Content-Type**: `multipart/form-data`
* **Form Fields**:
  * `chunk_index`: `0`, `1`, `2`, ...
  * `chunk_file`: Binary file stream (`.webm`).
* **Response (201 Created)**:
  ```json
  {
    "chunk_index": 0,
    "size_bytes": 782910,
    "status": "PERSISTED"
  }
  ```

### `POST /api/v1/cases/:id/recordings/:recId/stop`
Stops the recording session and calculates final session runtime.
* **Request**:
  ```json
  {
    "duration_seconds": 1224
  }
  ```
* **Response (200 OK)**:
  ```json
  {
    "recording_id": "rec_7f8e9d0c-...",
    "status": "READY_FOR_STITCHING",
    "duration_seconds": 1224
  }
  ```

---

## 5. Dossier Observation & Submission Endpoints

### `POST /api/v1/cases/:id/observations/draft`
Persists partial progress of the observation form without validating `*` fields.
* **Request**:
  ```json
  {
    "observations_data": {
      "insured_version": "Owner stated vehicle was driven by salaried driver...",
      "kyc_documents": "Aadhaar verified via DigiLocker"
    }
  }
  ```
* **Response (200 OK)**:
  ```json
  { "status": "DRAFT_SAVED", "updated_at": "2026-10-19T14:30:00Z" }
  ```

### `POST /api/v1/cases/:id/submit`
Validates all 10 mandatory fields, locks editing, and pushes case to QA `REVIEW`.
* **Validation**: If any mandatory `*` field is null or empty, returns `422 Unprocessable Entity` with a list of missing field names.
* **Response (200 OK)**:
  ```json
  {
    "case_id": "c1f8a3d2-...",
    "status": "REVIEW",
    "locked_at": "2026-10-19T15:00:00Z"
  }
  ```

---

## 6. QA Review & Sign-Off Endpoints

### `POST /api/v1/cases/:id/review/approve`
Manager approves case and advances to `ADMIN_SIGN_OFF`.
* **Roles**: Manager, Admin.

### `POST /api/v1/cases/:id/review/reject`
Manager rejects dossier back to investigator for rework.
* **Request**:
  ```json
  {
    "rejection_remarks": "Driver license photocopy is blurry. Call owner back and get high-res copy via WhatsApp."
  }
  ```
* **Response (200 OK)**:
  ```json
  { "case_id": "c1f8a3d2-...", "status": "WORK_IN_PROGRESS", "rework_count": 1 }
  ```

### `POST /api/v1/cases/:id/admin/sign-off`
Admin validates total duration, applies financial sign-off, and transitions case to `COMPLETED`.
* **Roles**: Admin.
* **Response (202 Accepted)**:
  ```json
  {
    "status": "ACCEPTED",
    "message": "Case completed; video stitching and PDF compilation enqueued",
    "job_id": "asynq_job_998877"
  }
  ```

---

## 7. Public Cryptographic Verification Endpoint

### `GET /api/v1/public/verify/dossier/:uuid`
Publicly accessible endpoint (no auth required) used by court auditors scanning the QR code on the physical/PDF dossier:
* **Response (200 OK)**:
  ```json
  {
    "verification_status": "AUTHENTIC_UNTAMPERED",
    "case_number": "MOT18221241",
    "insurer": "ICICI Lombard General Insurance",
    "vehicle_reg_number": "MH-12-AB-1234",
    "sha256_checksum": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "recorded_duration_seconds": 1224,
    "completed_at": "2026-10-19T16:00:00Z",
    "certified_pdf_url": "https://storage.platform.com/cases/MOT18221241/dossier.pdf?signature=..."
  }
  ```

---

## 8. Next Steps & Connected Knowledge

* For handling failures during these API calls, see [[13_Edge_Cases_and_Failure_Recovery]].
* For background job orchestration triggered by the `202 Accepted` response, see [[07_Background_Processing_and_Queue_Architecture]].
* For deploying these APIs with Nginx SSL, see [[14_Hosting_Infrastructure_and_Deployment_Guide]].
