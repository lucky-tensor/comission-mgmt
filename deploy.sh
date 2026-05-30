#!/usr/bin/env bash
# deploy.sh — health-gated ordered rollout for zero-downtime deployments.
#
# Usage:
#   ./deploy.sh <image-tag>
#
# Example:
#   ./deploy.sh sha-abc1234
#   ./deploy.sh v1.2.3
#
# Phases (each gates on a health check before the next begins):
#   1. DB migrations  — k8s Job running packages/db/migrate.ts; gate: job completion
#   2. API server     — kubectl set image deployment/commission-app; gate: GET /healthz
#   3. Workers        — kubectl set image per WORKER_TYPES; gate: pod Ready condition
#   4. Static web     — aws s3 sync + CDN invalidation; gate: sync succeeds
#
# Environment variables (required at deploy time):
#   IMAGE_REPO        — container image repository (default: ghcr.io/<owner>/commission-mgmt)
#   API_URL           — base URL for the running API server (default: http://<host>:31415)
#   DATABASE_URL      — postgres connection string (injected via superfield-api-secrets)
#   CDN_DISTRIBUTION  — CloudFront distribution ID for cache invalidation (optional)
#   S3_BUCKET         — S3 bucket name for static web assets (optional)
#   WORKER_TYPES      — space-separated list of worker types (default: empty — skip worker phase)
#   DEPLOY_NAMESPACE  — kubernetes namespace (default: commission-demo)

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <image-tag>" >&2
  exit 1
fi

IMAGE_TAG="$1"
IMAGE_REPO="${IMAGE_REPO:-ghcr.io/lucky-tensor/commission-mgmt}"
IMAGE="${IMAGE_REPO}:${IMAGE_TAG}"

# Health gate settings
HEALTH_MAX_RETRIES="${HEALTH_MAX_RETRIES:-30}"
HEALTH_RETRY_INTERVAL="${HEALTH_RETRY_INTERVAL:-2}"

# API health check URL
APP_DEPLOYMENT="${APP_DEPLOYMENT:-commission-app}"
APP_CONTAINER_NAME="${APP_CONTAINER_NAME:-app}"
API_HEALTHZ_URL="${API_URL:-http://${DEPLOY_HOST:-localhost}:31415}/healthz"

# Worker deployment names — e.g. "commission" → worker-commission
WORKER_TYPES="${WORKER_TYPES:-}"
DEPLOY_NAMESPACE="${DEPLOY_NAMESPACE:-commission-demo}"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

log() {
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*"
}

die() {
  log "ERROR: $*" >&2
  exit 1
}

# run_migration_job — creates a k8s Job that runs DB migrations inside the app
# image, waits for completion, then deletes the job.
# The DB is only reachable inside the cluster, so migrations must run there.
run_migration_job() {
  local image="$1"
  local namespace="${DEPLOY_NAMESPACE}"
  local job_name="commission-migrate-$(date +%s)"

  log "Creating migration Job ${job_name} in namespace ${namespace}..."
  kubectl apply -f - <<MANIFEST
apiVersion: batch/v1
kind: Job
metadata:
  name: ${job_name}
  namespace: ${namespace}
  labels:
    app: commission-migrate
spec:
  ttlSecondsAfterFinished: 600
  backoffLimit: 0
  template:
    metadata:
      labels:
        app: commission-migrate
    spec:
      restartPolicy: Never
      containers:
        - name: migrate
          image: ${image}
          command: ["bun", "run", "packages/db/migrate.ts"]
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: superfield-api-secrets
                  key: DATABASE_URL
            - name: ANALYTICS_DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: superfield-api-secrets
                  key: ANALYTICS_DATABASE_URL
            - name: AUDIT_DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: superfield-api-secrets
                  key: AUDIT_DATABASE_URL
          resources:
            requests:
              cpu: "50m"
              memory: "128Mi"
            limits:
              cpu: "500m"
              memory: "512Mi"
MANIFEST

  log "Waiting for migration Job to complete (up to ${HEALTH_MAX_RETRIES}s)..."
  if ! kubectl wait "job/${job_name}" \
      --namespace="${namespace}" \
      --for=condition=complete \
      --timeout="${HEALTH_MAX_RETRIES}s"; then
    log "Migration Job failed — fetching logs..."
    kubectl logs --namespace="${namespace}" \
      --selector="app=commission-migrate" --tail=100 || true
    kubectl delete job "${job_name}" --namespace="${namespace}" --ignore-not-found || true
    return 1
  fi

  log "Migration Job completed successfully."
  kubectl delete job "${job_name}" --namespace="${namespace}" --ignore-not-found || true
}

# wait_for_healthz <url> — polls the given URL until it returns HTTP 200 with {"status":"ok"}.
wait_for_healthz() {
  local url="$1"
  local attempt=0
  log "Waiting for healthz at ${url} (up to $((HEALTH_MAX_RETRIES * HEALTH_RETRY_INTERVAL))s)..."
  while [[ $attempt -lt $HEALTH_MAX_RETRIES ]]; do
    local response
    response=$(curl -sf --max-time 5 "${url}" 2>/dev/null || true)
    if echo "${response}" | grep -q '"status":"ok"'; then
      log "Healthz OK."
      return 0
    fi
    attempt=$((attempt + 1))
    log "  Not healthy yet (attempt ${attempt}/${HEALTH_MAX_RETRIES}), retrying in ${HEALTH_RETRY_INTERVAL}s..."
    sleep "${HEALTH_RETRY_INTERVAL}"
  done
  return 1
}

# wait_for_pod_ready <deployment> — polls kubectl until all pods in the deployment are Ready.
wait_for_pod_ready() {
  local deployment="$1"
  log "Waiting for pods in ${deployment} to become Ready..."
  kubectl rollout status "deployment/${deployment}" \
    --namespace="${DEPLOY_NAMESPACE}" \
    --timeout="$((HEALTH_MAX_RETRIES * HEALTH_RETRY_INTERVAL))s"
}

# ---------------------------------------------------------------------------
# Phase 1: DB migrations
# ---------------------------------------------------------------------------

log "=== Phase 1: DB migrations ==="

if ! run_migration_job "${IMAGE}"; then
  die "Migration Job failed — aborting rollout."
fi

log "Phase 1 complete."

# ---------------------------------------------------------------------------
# Phase 2: API server rollout
# ---------------------------------------------------------------------------

log "=== Phase 2: API server rollout ==="

log "Updating ${APP_DEPLOYMENT} deployment to image: ${IMAGE}"
kubectl set image "deployment/${APP_DEPLOYMENT}" "${APP_CONTAINER_NAME}=${IMAGE}" \
  --namespace="${DEPLOY_NAMESPACE}"

log "Waiting for API rollout to complete..."
if ! kubectl rollout status "deployment/${APP_DEPLOYMENT}" \
    --namespace="${DEPLOY_NAMESPACE}" \
    --timeout="$((HEALTH_MAX_RETRIES * HEALTH_RETRY_INTERVAL))s"; then
  log "Rollout status timed out — triggering rollback..."
  kubectl rollout undo "deployment/${APP_DEPLOYMENT}" --namespace="${DEPLOY_NAMESPACE}"
  die "API server rollout failed — rolled back deployment."
fi

log "Verifying API health at ${API_HEALTHZ_URL}..."
if ! wait_for_healthz "${API_HEALTHZ_URL}"; then
  log "API health check failed — triggering rollback..."
  kubectl rollout undo "deployment/${APP_DEPLOYMENT}" --namespace="${DEPLOY_NAMESPACE}"
  die "API server did not become healthy — rolled back deployment."
fi

log "Phase 2 complete."

# ---------------------------------------------------------------------------
# Phase 3: Worker rollouts (per type, one at a time)
# ---------------------------------------------------------------------------

log "=== Phase 3: Worker rollouts ==="

if [[ -z "${WORKER_TYPES}" ]]; then
  log "No WORKER_TYPES defined — skipping worker phase."
else
  for worker_type in ${WORKER_TYPES}; do
    deployment="worker-${worker_type}"
    log "Updating ${deployment} to image: ${IMAGE}"
    kubectl set image "deployment/${deployment}" "worker=${IMAGE}" \
      --namespace="${DEPLOY_NAMESPACE}"

    log "Waiting for ${deployment} rollout to complete..."
    if ! kubectl rollout status "deployment/${deployment}" \
        --namespace="${DEPLOY_NAMESPACE}" \
        --timeout="$((HEALTH_MAX_RETRIES * HEALTH_RETRY_INTERVAL))s"; then
      log "Rollout status timed out for ${deployment} — triggering rollback..."
      kubectl rollout undo "deployment/${deployment}" --namespace="${DEPLOY_NAMESPACE}"
      die "Worker rollout failed for ${deployment} — rolled back deployment."
    fi

    if ! wait_for_pod_ready "${deployment}"; then
      log "Pod readiness check failed for ${deployment} — triggering rollback..."
      kubectl rollout undo "deployment/${deployment}" --namespace="${DEPLOY_NAMESPACE}"
      die "Worker ${deployment} did not become Ready — rolled back deployment."
    fi

    log "Worker ${deployment} is healthy."
  done
fi

log "Phase 3 complete."

# ---------------------------------------------------------------------------
# Phase 4: Static web assets (optional — skipped if S3_BUCKET unset)
# ---------------------------------------------------------------------------

log "=== Phase 4: Static web assets ==="

if [[ -z "${S3_BUCKET:-}" ]]; then
  log "S3_BUCKET not set — skipping static web phase."
else
  STATIC_DIST_PATH="${STATIC_DIST_PATH:-apps/web/dist}"

  if [[ ! -d "${STATIC_DIST_PATH}" ]]; then
    die "Static assets directory not found: ${STATIC_DIST_PATH}"
  fi

  log "Syncing static assets to s3://${S3_BUCKET}/ ..."
  if ! aws s3 sync "${STATIC_DIST_PATH}" "s3://${S3_BUCKET}/" --delete; then
    die "Static web sync failed."
  fi

  if [[ -n "${CDN_DISTRIBUTION:-}" ]]; then
    log "Invalidating CDN distribution ${CDN_DISTRIBUTION}..."
    if ! aws cloudfront create-invalidation \
        --distribution-id "${CDN_DISTRIBUTION}" \
        --paths "/*"; then
      log "WARNING: CDN invalidation failed — clients may see stale assets until TTL expires."
    fi
  fi

  log "Static web assets deployed."
fi

log "Phase 4 complete."

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------

log "Rollout of ${IMAGE} completed successfully."
