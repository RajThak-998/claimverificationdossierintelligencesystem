# 🛠️ Developer Quickstart & Build Guide
> **Motor Claim Verification & Dossier Intelligence Platform**  
> Complete guide for teammates to run, develop, compile, and package the backend and Windows Electron app.

---

## 📋 1. Prerequisites

Before starting, ensure your Windows machine has:
* **Node.js**: v20+ (with `npm`)
* **Go**: v1.25+
* *(Optional)* **GCC / MinGW**: For compiling CGO SQLite binaries (already present on standard MSYS2/MinGW setups).
* *(No Docker required)*: The backend boots automatically with an embedded SQLite database and local disk storage fallback.

---

## ⚡ 2. First-Time Setup (Install Dependencies)

Open a terminal at the project root:

```bash
# 1. Install frontend & Electron packages
cd frontend
npm install

# 2. Download Go backend dependencies
cd ../backend
go mod download
cd ..
```

---

## 🚀 3. Running in Daily Development Mode

For rapid development with Hot-Module-Reloading (HMR):

### Step 1: Start Backend (Terminal 1)
```bash
cd backend
go run ./cmd/api
```
* Automatically uses SQLite (`motor_claims.db`) and local storage (`data/storage/`).
* Seeds 4 sample cases, rate cards, and 5 test user accounts.
* Listens on **`http://localhost:8080`**.
* Health check: `curl http://localhost:8080/health`

### Step 2: Start React Frontend Dev Server (Terminal 2)
```bash
cd frontend
npm run dev
```
* Starts Vite dev server on **`http://localhost:3000`**.

### Step 3: Launch Electron Window (Terminal 3)
```bash
cd frontend
npm run electron
```
* Launches the Electron desktop shell pointing to `http://localhost:3000` with live reload.

---

## 📦 4. Compiling & Packaging the Windows Executable (`.exe`)

When you are ready to produce the standalone Windows executable and installer for release, teammate testing, or client delivery:

```bash
cd frontend

# Step 1: Typecheck & build the React frontend with relative assets
npm run build

# Step 2: Package Windows standalone single executable & installer
npm run electron:build
```

### 📂 Build Outputs (`frontend/release/`)
Once packaging finishes (~45–60 seconds), you will find:
1. **Single Standalone Executable (Zero Installation Required — Deliverable to Clients):**
   ```
   frontend/release/Claim Verification Intelligence-Standalone.exe
   ```
   * *This is a single self-contained `.exe` file that clients can run directly on any Windows PC with no setup wizard or installer.*
2. **Standard Windows NSIS Installer (.exe):**
   ```
   frontend/release/Claim Verification Intelligence Setup 1.0.0.exe
   ```
3. **Unpacked Development Folder:**
   ```
   frontend/release/win-unpacked/Claim Verification Intelligence.exe
   ```

---

## ☁️ 5. Connecting to a Hosted Cloud Backend

The Windows app is built to connect effortlessly to either a local backend or your hosted cloud production backend:

### Option A: 1-Click Runtime Configuration (No Recompilation Needed!)
1. Open the application.
2. On the Login Screen, click the **`🌐 Server: http://localhost:8080`** button at the bottom.
3. Paste your cloud backend URL (e.g. `https://claims-api.yourdomain.com`).
4. The app refreshes and immediately routes all API calls, WhatsApp tele-verification sessions, chunk uploads, and dossier downloads through your cloud server!

### Option B: Build-Time Cloud Bake
To bake your cloud backend URL permanently into the `.exe` binary:
```bash
cd frontend
$env:VITE_API_URL="https://claims-api.yourdomain.com"
npm run build
npm run electron:build
```

---

## 🔑 6. Pre-Seeded Test Accounts

The local database comes pre-seeded with 4 test personas:

| Role | Email | Password | Primary Workflow |
|---|---|---|---|
| **Director / Admin** | `admin@agency.com` | `Password123!` | Commercials, rate cards, ledger audit, final sign-off |
| **QA Manager** | `manager.qa@agency.com` | `Password123!` | Case triage, agent workload rebalance, review & reject/approve |
| **Investigator Agent** | `agent.palak@agency.com` | `Password123!` | WhatsApp tele-verification, 5s recording, 10 observation fields |
| **Client Insurer** | `client.icici@agency.com` | `Password123!` | Company-filtered case tracking, certified PDF inspection |

*(Tip: On the login screen, you can also click any of the **1-Click Quick Persona Login** buttons to sign in instantly).*

---

## 🛠️ 7. Operational Architecture & Troubleshooting

* **Floating Controls & Background WhatsApp Window:**  
  The floating pill overlay uses native Windows `type: 'toolbar'` (`WS_EX_TOOLWINDOW`) with `focusable: false`. This ensures that dragging or clicking the floating pills never minimizes or de-activates the background WhatsApp Desktop window.
* **Manual Recording Control:**  
  Clicking "WhatsApp Call" opens WhatsApp Desktop and brings up the floating controls in ready state `[ ● REC ]`. Recording starts only when the agent explicitly clicks `● REC`, and stops when clicking `■ STOP`.
* **Zero-Prompt Capture with System Audio:**  
  Electron's `session.defaultSession.setDisplayMediaRequestHandler` auto-selects the primary screen with Windows loopback system audio (`audio: 'loopback'`).
* **Instant Numeric Frame Grab Badge:**  
  Capturing screenshots displays a clean, minimal `#1`, `#2` numeric badge without verbose toast messages.
* **Legal PDF Dossier Generation via Microsoft Edge / Chrome:**  
  The Go backend detects Microsoft Edge (`msedge.exe`) or Google Chrome (`chrome.exe`) automatically at standard Windows locations (`C:\Program Files (x86)\Microsoft\Edge\...`) and compiles genuine, certified PDFs.
* **WebM Video Seeking & Chunk Stitching:**  
  The backend stitches 5-second WebM chunks. When `ffmpeg.exe` is available in `%PATH%` or `backend/bin/ffmpeg.exe`, it runs stream copy (`-c copy`) to inject proper WebM Cues headers, enabling seamless timeline seeking.
* **Blank White Screen in Packaged App:**  
  Always run `npm run build` inside `frontend/` before `npm run electron:build` so `dist/index.html` has relative `./assets/...` paths (`base: './'`).
