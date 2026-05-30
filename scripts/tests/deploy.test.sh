#!/usr/bin/env bash
# deploy.test.sh — Unit tests for deploy.sh using mock kubectl.
#
# Tests:
#   1. Migration phase failure halts rollout before kubectl set image is called.
#   2. API-rollout health check failure triggers kubectl rollout undo.
#
# Mock approach:
#   - A mock `kubectl` is injected via PATH that records invocations and
#     returns exit codes controlled by test-local env vars.
#   - MOCK_KUBECTL_DIR is prepended to PATH so the mock overrides the real kubectl.
#   - The mock writes each call to a log file for assertion.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEPLOY_SH="${REPO_ROOT}/deploy.sh"
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

MOCK_KUBECTL="${TMP_DIR}/kubectl"
INVOCATION_LOG="${TMP_DIR}/invocations.log"

pass_count=0
fail_count=0

pass() {
  echo "  PASS: $1"
  pass_count=$((pass_count + 1))
}

fail() {
  echo "  FAIL: $1"
  fail_count=$((fail_count + 1))
}

assert_contains() {
  local haystack="$1"
  local needle="$2"
  local label="$3"
  if echo "${haystack}" | grep -qF "${needle}"; then
    pass "${label}"
  else
    fail "${label} — expected '${needle}' in output"
    echo "  Output was: ${haystack:0:500}"
  fi
}

assert_not_contains() {
  local haystack="$1"
  local needle="$2"
  local label="$3"
  if ! echo "${haystack}" | grep -qF "${needle}"; then
    pass "${label}"
  else
    fail "${label} — did not expect '${needle}' in output"
  fi
}

assert_file_contains() {
  local file="$1"
  local needle="$2"
  local label="$3"
  if grep -qF "${needle}" "${file}" 2>/dev/null; then
    pass "${label}"
  else
    fail "${label} — expected '${needle}' in ${file}"
    cat "${file}" 2>/dev/null || echo "(file not found)"
  fi
}

assert_file_not_contains() {
  local file="$1"
  local needle="$2"
  local label="$3"
  if ! grep -qF "${needle}" "${file}" 2>/dev/null; then
    pass "${label}"
  else
    fail "${label} — did not expect '${needle}' in ${file}"
  fi
}

# ---------------------------------------------------------------------------
# Write mock kubectl
# ---------------------------------------------------------------------------

write_mock_kubectl() {
  local migration_exit="${MOCK_MIGRATE_EXIT:-0}"
  local rollout_exit="${MOCK_ROLLOUT_EXIT:-0}"
  local healthz_response="${MOCK_HEALTHZ_RESPONSE:-{\"status\":\"ok\"}}"
  local healthz_exit="${MOCK_HEALTHZ_EXIT:-0}"

  cat > "${MOCK_KUBECTL}" << 'MOCKEOF'
#!/usr/bin/env bash
# Mock kubectl — records all invocations and simulates configurable failures.

INVOCATION_LOG="${INVOCATION_LOG:-/tmp/kubectl-invocations.log}"
MOCK_MIGRATE_EXIT="${MOCK_MIGRATE_EXIT:-0}"
MOCK_ROLLOUT_EXIT="${MOCK_ROLLOUT_EXIT:-0}"

# Record invocation
echo "$*" >> "${INVOCATION_LOG}"

# Handle specific commands
case "$*" in
  "apply -f -")
    # Migration job creation — always succeeds
    exit 0
    ;;
  wait\ job/commission-migrate-*\ --namespace=*\ --for=condition=complete\ *)
    # Migration job wait
    exit "${MOCK_MIGRATE_EXIT}"
    ;;
  "delete job"*|"logs --namespace"*|"delete job"*)
    exit 0
    ;;
  "set image deployment/commission-app"*)
    exit 0
    ;;
  "rollout status deployment/commission-app"*)
    exit "${MOCK_ROLLOUT_EXIT}"
    ;;
  "rollout undo deployment/commission-app"*)
    echo "deployment.apps/commission-app rolled back"
    exit 0
    ;;
  "rollout status deployment/worker-"*|"rollout undo deployment/worker-"*)
    exit 0
    ;;
  get\ namespace\ *|get\ secret\ *|get\ deployment\ *)
    exit 0
    ;;
  *)
    # Default: succeed silently
    exit 0
    ;;
esac
MOCKEOF

  chmod +x "${MOCK_KUBECTL}"
}

# ---------------------------------------------------------------------------
# Test 1: Migration failure halts rollout before kubectl set image
# ---------------------------------------------------------------------------

echo ""
echo "Test 1: Migration phase failure halts rollout"
echo "----------------------------------------------"

: > "${INVOCATION_LOG}"

write_mock_kubectl

export PATH="${TMP_DIR}:${PATH}"
export INVOCATION_LOG
export MOCK_MIGRATE_EXIT=1
export MOCK_ROLLOUT_EXIT=0
export DEPLOY_NAMESPACE="commission-demo"
export APP_DEPLOYMENT="commission-app"
export APP_CONTAINER_NAME="app"
export DEPLOY_HOST="localhost"
export HEALTH_MAX_RETRIES=1
export HEALTH_RETRY_INTERVAL=1
export IMAGE_REPO="ghcr.io/test/commission-mgmt"

# Stub aws and curl so phases 3+4 don't fail on missing binaries
export PATH="${TMP_DIR}:${PATH}"
cat > "${TMP_DIR}/curl" << 'EOF'
#!/usr/bin/env bash
echo '{"status":"ok"}'
exit 0
EOF
chmod +x "${TMP_DIR}/curl"

output=$(bash "${DEPLOY_SH}" "sha-test001" 2>&1 || true)

assert_contains "${output}" "Migration Job failed" \
  "Migration failure is reported"

assert_file_not_contains "${INVOCATION_LOG}" "set image" \
  "kubectl set image is NOT called after migration failure"

# ---------------------------------------------------------------------------
# Test 2: API rollout health check failure triggers rollback
# ---------------------------------------------------------------------------

echo ""
echo "Test 2: API rollout health check failure triggers rollback"
echo "----------------------------------------------------------"

: > "${INVOCATION_LOG}"

export MOCK_MIGRATE_EXIT=0
export MOCK_ROLLOUT_EXIT=1

# Make curl return a non-ok response for the health check
cat > "${TMP_DIR}/curl" << 'EOF'
#!/usr/bin/env bash
# Simulate /healthz returning 503 (no {"status":"ok"} in body)
echo '{"status":"error","message":"db not ready"}'
exit 0
EOF
chmod +x "${TMP_DIR}/curl"

output=$(bash "${DEPLOY_SH}" "sha-test002" 2>&1 || true)

assert_contains "${output}" "rolled back" \
  "Rollback is triggered on API rollout failure"

assert_file_contains "${INVOCATION_LOG}" "rollout undo deployment/commission-app" \
  "kubectl rollout undo is called after health check failure"

# ---------------------------------------------------------------------------
# Test 3: Successful deploy calls set image and does NOT undo
# ---------------------------------------------------------------------------

echo ""
echo "Test 3: Successful deploy path"
echo "------------------------------"

: > "${INVOCATION_LOG}"

export MOCK_MIGRATE_EXIT=0
export MOCK_ROLLOUT_EXIT=0

cat > "${TMP_DIR}/curl" << 'EOF'
#!/usr/bin/env bash
echo '{"status":"ok"}'
exit 0
EOF
chmod +x "${TMP_DIR}/curl"

output=$(bash "${DEPLOY_SH}" "sha-test003" 2>&1 || true)

assert_file_contains "${INVOCATION_LOG}" "set image deployment/commission-app" \
  "kubectl set image is called on successful deploy"

assert_file_not_contains "${INVOCATION_LOG}" "rollout undo" \
  "kubectl rollout undo is NOT called on successful deploy"

assert_contains "${output}" "completed successfully" \
  "Success message appears on successful deploy"

# ---------------------------------------------------------------------------
# Results
# ---------------------------------------------------------------------------

echo ""
echo "==============================="
echo "Results: ${pass_count} passed, ${fail_count} failed"
echo "==============================="

if [[ "${fail_count}" -gt 0 ]]; then
  exit 1
fi
