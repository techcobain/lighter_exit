#!/usr/bin/env bash
# Deploys one published image to the AWS Lightsail container service.
#
#   AWS_PROFILE=<profile> scripts/deploy-lightsail.sh <commit sha>
#
# The image is built and published by .github/workflows/image.yml on every push
# to `prod`, tagged with the commit sha. Deploy by sha rather than by the moving
# `prod` tag, so the service always pulls exactly what was asked for.
set -euo pipefail

TAG="${1:?usage: scripts/deploy-lightsail.sh <commit sha of a published image>}"
SERVICE="${LIGHTSAIL_SERVICE:-lighter-exit}"
REGION="${LIGHTSAIL_REGION:-ap-northeast-1}"
IMAGE="${LIGHTSAIL_IMAGE:-ghcr.io/techcobain/lighter_exit}:${TAG}"
PORT=8787

# CLIENT_IP_HEADER: Lightsail's load balancer appends the client address to
# X-Forwarded-For; the server rate limits by the last entry.
containers=$(cat <<JSON
{
  "app": {
    "image": "${IMAGE}",
    "ports": { "${PORT}": "HTTP" },
    "environment": {
      "PORT": "${PORT}",
      "CLIENT_IP_HEADER": "x-forwarded-for"
    }
  }
}
JSON
)
endpoint=$(cat <<JSON
{
  "containerName": "app",
  "containerPort": ${PORT},
  "healthCheck": { "path": "/healthz", "intervalSeconds": 10, "timeoutSeconds": 5, "healthyThreshold": 2, "unhealthyThreshold": 3, "successCodes": "200" }
}
JSON
)

echo "Deploying ${IMAGE} to ${SERVICE} (${REGION})"
aws lightsail create-container-service-deployment \
  --region "${REGION}" \
  --service-name "${SERVICE}" \
  --containers "${containers}" \
  --public-endpoint "${endpoint}" \
  --query 'containerService.{state:state,version:nextDeployment.version,deployment:nextDeployment.state,url:url}' \
  --output table

echo "Follow it with:"
echo "  aws lightsail get-container-services --region ${REGION} --service-name ${SERVICE} --query 'containerServices[0].{state:state,current:currentDeployment.state,next:nextDeployment.state}'"
