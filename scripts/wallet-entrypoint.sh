#!/bin/sh
set -eu

NETWORK="${MONERO_NETWORK:-mainnet}"
case "$NETWORK" in
  mainnet)
    NET_FLAG=""
    DEFAULT_DAEMON="node.moneroworld.com:18081"
    ;;
  stagenet)
    NET_FLAG="--stagenet"
    DEFAULT_DAEMON="xmr-lux.boldsuck.org:38081"
    ;;
  *)
    echo "Invalid MONERO_NETWORK: $NETWORK (expected mainnet or stagenet)" >&2
    exit 1
    ;;
esac

DAEMON="${MONERO_DAEMON_ADDRESS:-$DEFAULT_DAEMON}"

if [ -n "${MONERO_DAEMON_PROXY:-}" ]; then
  PROXY_ARG="--proxy=${MONERO_DAEMON_PROXY}"
else
  PROXY_ARG=""
fi

# Keep RPC credentials out of argv and the process table.
CONFIG_FILE="/tmp/monero-wallet-rpc.conf"
umask 077
printf 'rpc-login=%s:%s\n' "$MONERO_RPC_USER" "$MONERO_RPC_PASSWORD" > "$CONFIG_FILE"

mkdir -p /data/wallets

echo "Starting monero-wallet-rpc in $NETWORK mode, daemon: $DAEMON, proxy: ${MONERO_DAEMON_PROXY:-none}"

exec monero-wallet-rpc \
  --config-file="$CONFIG_FILE" \
  --rpc-bind-ip=0.0.0.0 \
  --rpc-bind-port=18082 \
  --confirm-external-bind \
  --wallet-dir=/data/wallets \
  --daemon-address="$DAEMON" \
  $PROXY_ARG \
  $NET_FLAG \
  "$@"
