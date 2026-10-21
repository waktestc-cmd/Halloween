#!/usr/bin/env bash
# Puts Escape the Convent on Cloud Run: one instance (the game lives in its memory), websockets kept
# open for up to an hour, everyone's connection sticking to that one instance.
#
# Run it from this folder, for example in Google Cloud Shell:
#   HOST_KEY=choose-a-secret ./deploy.sh                 # uses your current gcloud project
#   HOST_KEY=choose-a-secret ./deploy.sh my-project europe-west1
set -euo pipefail

PROJECT=${1:-$(gcloud config get-value project 2>/dev/null)}
REGION=${2:-europe-west1}
SERVICE=${SERVICE:-escape-the-convent}
: "${HOST_KEY:?Set HOST_KEY first, for example: HOST_KEY=pumpkin42 ./deploy.sh}"
[ -n "$PROJECT" ] || { echo "No project: pass one, or run gcloud config set project <id>"; exit 1; }

echo "Turning on the Cloud Run and build services (only slow the first time)..."
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com --project "$PROJECT"

echo "Building and deploying $SERVICE to $REGION in $PROJECT..."
gcloud run deploy "$SERVICE" \
  --project "$PROJECT" --region "$REGION" --source . \
  --allow-unauthenticated \
  --port 8080 \
  --min-instances 1 --max-instances 1 \
  --concurrency 100 \
  --session-affinity \
  --timeout 3600 \
  --no-cpu-throttling \
  --cpu 1 --memory 512Mi \
  --set-env-vars "HOST_KEY=$HOST_KEY"

URL=$(gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format 'value(status.url)')
echo
echo "Players open:     $URL"
echo "Big screen opens: $URL/host?key=$HOST_KEY"
echo "Afterwards, to stop paying for the always-on instance:"
echo "  gcloud run services update $SERVICE --project $PROJECT --region $REGION --min-instances 0"
