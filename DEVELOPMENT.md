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

When you are ready to produce the standalone Windows executable and installer for release or teammate testing:

```bash
cd frontend

# Step 1: Typecheck & build the React frontend with relative assets
npm run build

# Step 2: Package Windows executable & NSIS installer
npm run electron:build
```

### 📂 Build Outputs (`frontend/release/`)
Once packaging finishes (~30–60 seconds), you will find:
1. **Portable Unpacked Executable (Double-click to run immediately without installation):**
   ```
   frontend/release/win-unpacked/Claim Verification Intelligence.exe
   ```
2. **Standard Windows NSIS Installer (.exe):**
   ```
   frontend/release/Claim Verification Intelligence Setup 1.0.0.exe
   ```

---

## 🔑 5. Pre-Seeded Test Accounts

The local database comes pre-seeded with 4 test personas:

| Role | Email | Password | Primary Workflow |
|---|---|---|---|
| **Director / Admin** | `admin@agency.com` | `Password123!` | Commercials, rate cards, ledger audit, final sign-off |
| **QA Manager** | `manager.qa@agency.com` | `Password123!` | Case triage, agent workload rebalance, review & reject/approve |
| **Investigator Agent** | `agent.palak@agency.com` | `Password123!` | WhatsApp tele-verification, 5s recording, 10 observation fields |
| **Client Insurer** | `client.icici@agency.com` | `Password123!` | Company-filtered case tracking, certified PDF inspection |

*(Tip: On the login screen, you can also click any of the **1-Click Quick Persona Login** buttons to sign in instantly).*

---

## 🛠️ 6. Quick Troubleshooting

* **Blank White Screen in Packaged App:**  
  Always run `npm run build` inside `frontend/` before `npm run electron:build` so `dist/index.html` has relative `./assets/...` paths.
* **Backend Connection / Network Errors:**  
  Make sure `motor-api.exe` (or `go run ./cmd/api`) is running in the background on port `8080`.
* **WhatsApp Call Deep Links:**  
  Clicking WhatsApp links in the app triggers `whatsapp://...` directly to the native Windows WhatsApp Desktop app without navigating or reloading the main dashboard window.
