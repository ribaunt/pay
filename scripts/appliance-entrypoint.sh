#!/bin/sh
set -eu

DATA_DIR="/data"
PGDATA="$DATA_DIR/postgres"
WALLETS="$DATA_DIR/wallets"
CONFIG_FILE="$DATA_DIR/config/.env"

mkdir -p "$PGDATA" "$WALLETS" "$DATA_DIR/config"
chown -R postgres:postgres "$PGDATA"
chown -R monero:monero "$WALLETS"
# The app needs directory write access to remove files from a rejected keypair.
chgrp nextjs "$WALLETS"
chmod 770 "$WALLETS"
chown -R nextjs:nextjs "$DATA_DIR/config"

if [ ! -f "$CONFIG_FILE" ]; then
  umask 077
  SESSION_SECRET="$(openssl rand -hex 32)"
  WALLET_ENCRYPTION_KEY="$(openssl rand -hex 32)"
  MONERO_RPC_PASSWORD="$(openssl rand -hex 24)"
  MONERO_WALLET_PASSWORD="$(openssl rand -hex 24)"
  POSTGRES_PASSWORD="$(openssl rand -hex 24)"
  PAYMENT_API_KEY="$(openssl rand -hex 24)"
  CRON_SECRET="$(openssl rand -hex 24)"
  BACKUP_PASSPHRASE="$(openssl rand -hex 24)"
  SINGLE_USER_PASSWORD="$(openssl rand -hex 16)"

  cat > "$CONFIG_FILE" <<EOF
NODE_ENV=production
NEXT_TELEMETRY_DISABLED=1
DO_NOT_TRACK=1
PORT=3000
HOSTNAME=0.0.0.0
SESSION_SECRET=${SESSION_SECRET}
WALLET_ENCRYPTION_KEY=${WALLET_ENCRYPTION_KEY}
MONERO_RPC_USER=monero
MONERO_RPC_PASSWORD=${MONERO_RPC_PASSWORD}
MONERO_WALLET_PASSWORD=${MONERO_WALLET_PASSWORD}
MONERO_WALLET_ADDRESS=${MONERO_WALLET_ADDRESS:-}
MONERO_WALLET_VIEW_KEY=${MONERO_WALLET_VIEW_KEY:-}
MONERO_WALLET_RESTORE_HEIGHT=${MONERO_WALLET_RESTORE_HEIGHT:-0}
MONERO_WALLET_DESCRIPTION=${MONERO_WALLET_DESCRIPTION:-}
MONERO_NETWORK=${MONERO_NETWORK:-mainnet}
MONERO_DAEMON_ADDRESS=${MONERO_DAEMON_ADDRESS:-}
MONERO_DAEMON_MODE=full-scan
TRUST_PROXY=${TRUST_PROXY:-0}
SINGLE_USER_EMAIL=${SINGLE_USER_EMAIL:-admin@pay.local}
SINGLE_USER_PASSWORD=${SINGLE_USER_PASSWORD}
POSTGRES_USER=pay
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
POSTGRES_DB=pay
PAYMENT_API_KEY=${PAYMENT_API_KEY}
CRON_SECRET=${CRON_SECRET}
CRON_INTERVAL_SECONDS=${CRON_INTERVAL_SECONDS:-300}
BACKUP_PASSPHRASE=${BACKUP_PASSPHRASE}
EOF

  chown root:root "$CONFIG_FILE"
  chmod 600 "$CONFIG_FILE"

  echo ""
  echo "=== First boot: configuration generated ==="
  echo "Config: $CONFIG_FILE (mode 600)"
  echo "Sign in: ${SINGLE_USER_EMAIL:-admin@pay.local} / ${SINGLE_USER_PASSWORD}"
  echo "Change credentials in the config file and restart if needed."
  echo ""
fi

set -a
. "$CONFIG_FILE"
set +a

export NODE_ENV=production
export NEXT_TELEMETRY_DISABLED=1
export DO_NOT_TRACK=1
export PORT=3000
export HOSTNAME=0.0.0.0
export MONERO_WALLET_RPC_URL="http://127.0.0.1:18082"
export DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:5432/${POSTGRES_DB}?schema=public"

if [ "${MONERO_NETWORK}" = "stagenet" ]; then
  NET_FLAG="--stagenet"
  DEFAULT_DAEMON="xmr-lux.boldsuck.org:38081"
else
  NET_FLAG=""
  DEFAULT_DAEMON="xmr.4d2.org:18081"
fi
DAEMON="${MONERO_DAEMON_ADDRESS:-$DEFAULT_DAEMON}"

# PostgreSQL
export PGPASSWORD="$POSTGRES_PASSWORD"

if [ ! -f "$PGDATA/PG_VERSION" ]; then
  umask 077
  printf '%s\n' "$POSTGRES_PASSWORD" > /tmp/pgpass
  chown postgres:postgres /tmp/pgpass
  gosu postgres initdb -D "$PGDATA" -U "$POSTGRES_USER" \
    --pwfile=/tmp/pgpass --auth-local=trust --auth-host=scram-sha-256 \
    --encoding=UTF8 >/dev/null
  rm -f /tmp/pgpass
fi

gosu postgres pg_ctl -D "$PGDATA" \
  -o "-c listen_addresses=127.0.0.1 -c unix_socket_directories=/tmp" \
  -l "$PGDATA/server.log" -w start

gosu postgres psql -h 127.0.0.1 -U "$POSTGRES_USER" -d postgres \
  -tc "SELECT 1 FROM pg_database WHERE datname = '${POSTGRES_DB}'" | grep -q 1 \
  || gosu postgres createdb -h 127.0.0.1 -U "$POSTGRES_USER" "$POSTGRES_DB"

# monero-wallet-rpc
umask 077
printf 'rpc-login=%s:%s\n' "$MONERO_RPC_USER" "$MONERO_RPC_PASSWORD" > /data/config/wallet-rpc.conf
chown monero:monero /data/config/wallet-rpc.conf

gosu monero env HOME="$WALLETS" monero-wallet-rpc \
  --config-file=/data/config/wallet-rpc.conf \
  --rpc-bind-ip=127.0.0.1 \
  --rpc-bind-port=18082 \
  --wallet-dir="$WALLETS" \
  --daemon-address="$DAEMON" \
  $NET_FLAG &
RPC_PID=$!

cd /app
gosu nextjs env HOME=/app ./node_modules/.bin/prisma migrate deploy

gosu nextjs env HOME=/app node server.js &
APP_PID=$!

# Import the watch-only wallet from the environment when provided.
node /app/scripts/bootstrap-wallet.mjs || true

# Settlement and webhook retries are cron endpoints; run them on a timer so
# the appliance does not depend on an external scheduler.
CRON_INTERVAL="${CRON_INTERVAL_SECONDS:-300}"
(
  while true; do
    sleep "$CRON_INTERVAL"
    curl -sf --max-time 60 -X POST http://127.0.0.1:3000/api/cron/payment-links \
      -H "x-cron-secret: $CRON_SECRET" >/dev/null 2>&1 || true
    curl -sf --max-time 60 -X POST http://127.0.0.1:3000/api/cron/webhooks \
      -H "x-cron-secret: $CRON_SECRET" >/dev/null 2>&1 || true
  done
) &
CRON_PID=$!

cleanup() {
  kill "$APP_PID" 2>/dev/null || true
  kill "$CRON_PID" 2>/dev/null || true
  kill "$RPC_PID" 2>/dev/null || true
  gosu postgres pg_ctl -D "$PGDATA" -m fast stop >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

wait "$APP_PID"
