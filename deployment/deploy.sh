#!/usr/bin/env bash
set -euo pipefail

# Build + push + deploy statehash-io to Cloud Run. Mirrors the style of
# smartbettors/sb-api's deployment. Secrets (signer key, Mongo URI, API keys)
# are provided via Secret Manager — never as plain env vars in prod.

export TAG="${TAG:-0.1.0}"
export GCP_PROJECT_ID="${GCP_PROJECT_ID:-kmnviz}"
export REGION="${REGION:-europe-west1}"
export SERVICE="${SERVICE:-statehash-io}"

npm run build

# One-time setup:
# gcloud artifacts repositories create "$SERVICE" \
#   --repository-format=docker \
#   --location="$REGION" \
#   --description="Docker images for $SERVICE"

IMAGE="$REGION-docker.pkg.dev/$GCP_PROJECT_ID/$SERVICE/app:$TAG"

docker build --platform linux/amd64 -t "$IMAGE" .
docker push "$IMAGE"

gcloud config set project "$GCP_PROJECT_ID"

# Concurrency 1 keeps the signer nonce-serialization trivial in v1. Raise
# once the service has been stress-tested.
gcloud run deploy "$SERVICE" \
  --image="$IMAGE" \
  --region="$REGION" \
  --platform=managed \
  --port=8080 \
  --memory=512Mi \
  --cpu=1 \
  --timeout=60 \
  --min-instances=0 \
  --max-instances=2 \
  --concurrency=1 \
  --allow-unauthenticated \
  --set-env-vars="NODE_ENV=production" \
  --set-env-vars="LOG_LEVEL=info" \
  --set-env-vars="PORT=8080" \
  --set-env-vars="STATEHASH_CHAIN_ID=8453" \
  --set-env-vars="STATEHASH_BASE_RPC_URL=<YOUR_BASE_RPC_URL>" \
  --set-env-vars="MONGODB_DB_NAME=statehash" \
  --set-secrets="STATEHASH_SIGNER_PRIVATE_KEY=statehash-signer-private-key:latest" \
  --set-secrets="MONGODB_URI=statehash-mongodb-uri:latest" \
  --set-secrets="STATEHASH_API_KEYS=statehash-api-keys:latest"
