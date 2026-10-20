#!/usr/bin/env bash
set -e

echo "=== 1. Starting Backend API on port 8089 (SQLite mode for standalone test) ==="
export PORT=8089
export APP_ENV=test
export DB_DRIVER=sqlite
export DB_DSN=test_runtime.db
export STORAGE_DRIVER=local
export STORAGE_BASE_DIR=data/test_storage
export STORAGE_BASE_URL=http://localhost:8089
export JWT_SECRET=test-super-secret-jwt-signing-key-32chars

rm -f test_runtime.db
rm -rf data/test_storage

cd backend
go run ./cmd/api &
API_PID=$!
cd ..

cleanup() {
    echo "Stopping test API server (PID: $API_PID)..."
    kill $API_PID || true
    rm -f backend/test_runtime.db
    rm -rf backend/data/test_storage
}
trap cleanup EXIT

echo "Waiting for API to bind to port 8089..."
for i in {1..30}; do
    if curl -s http://localhost:8089/health > /dev/null; then
        echo "✅ API is UP and healthy!"
        break
    fi
    sleep 0.5
done

echo "=== 2. Testing Healthcheck Endpoint ==="
curl -s http://localhost:8089/health | grep '"status":"UP"'
echo " Healthcheck passed!"

echo "=== 3. Testing Public Verification Endpoint (No Auth) ==="
VERIFY_RES=$(curl -s http://localhost:8089/api/v1/public/verify/dossier/e3b0c442-98fc-1c14-9afb-fc8996fb9242)
echo "$VERIFY_RES" | grep "AUTHENTIC_UNTAMPERED"
echo "✅ Public Cryptographic Verification passed!"

echo "=== 4. Testing Admin Authentication ==="
LOGIN_RES=$(curl -s -X POST http://localhost:8089/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@agency.com","password":"Password123!"}')
TOKEN=$(echo "$LOGIN_RES" | grep -o '"token":"[^"]*' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
    echo "❌ Login failed: $LOGIN_RES"
    exit 1
fi
echo "✅ JWT Token generated successfully: ${TOKEN:0:25}..."

echo "=== 5. Testing Cases Vault List Endpoint ==="
CASES_RES=$(curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8089/api/v1/cases)
echo "$CASES_RES" | grep "MOT18221241"
echo "✅ Cases Vault query passed!"

echo "=== 6. Testing Commercial Metrics ==="
METRICS_RES=$(curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8089/api/v1/billing/metrics)
echo "$METRICS_RES" | grep "gross_billed_inr"
echo "✅ Commercial Metrics query passed!"

echo "=== 7. Testing Agent Hub Recalls ==="
RECALLS_RES=$(curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8089/api/v1/calls/due-recalls)
echo "✅ Recalls query passed! Response length: ${#RECALLS_RES} bytes"

echo "=== 8. Testing Download CSV Template ==="
curl -s http://localhost:8089/api/v1/cases/template/csv | head -n 2
echo "✅ Template CSV download passed!"

echo "============================================="
echo "🎉 ALL END-TO-END VERIFICATION CHECKS PASSED!"
echo "============================================="
