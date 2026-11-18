#!/bin/sh
# One-command installer for the Ribaunt Pay appliance.
# Usage: curl -fsSL https://pay.ribaunt.com/install.sh | sh
set -eu

VERSION="${PAY_VERSION:-latest}"
IMAGE="ghcr.io/ribaunt/pay:${VERSION}"

command -v docker >/dev/null 2>&1 || {
  echo "Docker is required. Install Docker Engine then rerun." >&2
  exit 1
}

if [ -z "${MONERO_DAEMON_ADDRESS:-}" ]; then
  printf 'Monero daemon address (host:port): '
  read -r MONERO_DAEMON_ADDRESS
fi

[ -n "$MONERO_DAEMON_ADDRESS" ] || {
  echo "A Monero daemon address is required." >&2
  exit 1
}

MONERO_NETWORK="${MONERO_NETWORK:-mainnet}"
TRUST_PROXY="${TRUST_PROXY:-0}"
CONTAINER="${PAY_CONTAINER:-pay}"
VOLUME="${PAY_VOLUME:-pay-data}"

echo "Pulling ${IMAGE}..."
docker pull "$IMAGE"

docker volume create "$VOLUME" >/dev/null
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true

docker run -d \
  --name "$CONTAINER" \
  --restart unless-stopped \
  -p 3000:3000 \
  -v "${VOLUME}:/data" \
  -e "MONERO_NETWORK=${MONERO_NETWORK}" \
  -e "MONERO_DAEMON_ADDRESS=${MONERO_DAEMON_ADDRESS}" \
  -e "TRUST_PROXY=${TRUST_PROXY}" \
  "$IMAGE" >/dev/null

echo "Waiting for http://localhost:3000/api/health ..."
for i in $(seq 1 60); do
  if curl -sf http://localhost:3000/api/health >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

curl -s http://localhost:3000/api/health || true
echo ""
echo "Installed. First-run credentials were printed once to:"
echo "  docker logs ${CONTAINER}"
echo "Config is stored in the ${VOLUME} volume at /data/config/.env (mode 600)."
