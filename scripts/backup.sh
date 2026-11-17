#!/bin/sh
# Back up Postgres and the Monero wallet data volume, encrypted at rest.
# Usage: BACKUP_PASSPHRASE=... sh scripts/backup.sh [output-directory]
set -eu

: "${BACKUP_PASSPHRASE:?set BACKUP_PASSPHRASE before backing up}"
umask 077

OUT="${1:-./backups}"
mkdir -p "$OUT"
STAMP="$(date +%Y%m%d-%H%M%S)"

COMPOSE_USER="${POSTGRES_USER:-pay}"
COMPOSE_DB="${POSTGRES_DB:-pay}"

DB_PLAIN="$OUT/db-$STAMP.sql"
DB_ENC="$DB_PLAIN.enc"
WALLET_PLAIN="$OUT/wallet-$STAMP.tar.gz"
WALLET_ENC="$WALLET_PLAIN.enc"

echo "Backing up Postgres..."
docker compose exec -T db pg_dump -U "$COMPOSE_USER" "$COMPOSE_DB" > "$DB_PLAIN"
chmod 600 "$DB_PLAIN"
openssl enc -aes-256-cbc -pbkdf2 -in "$DB_PLAIN" -out "$DB_ENC" -pass env:BACKUP_PASSPHRASE
rm -f "$DB_PLAIN"

echo "Backing up wallet data..."
docker run --rm \
  -v pay_wallet_data:/data:ro \
  -v "$(cd "$OUT" && pwd)":/backup \
  alpine@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc \
  tar czf "/backup/$(basename "$WALLET_PLAIN")" -C /data .
chmod 600 "$WALLET_PLAIN"
openssl enc -aes-256-cbc -pbkdf2 -in "$WALLET_PLAIN" -out "$WALLET_ENC" -pass env:BACKUP_PASSPHRASE
rm -f "$WALLET_PLAIN"

echo "Backup complete: $DB_ENC, $WALLET_ENC"
