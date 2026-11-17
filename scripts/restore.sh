#!/bin/sh
# Restore an encrypted backup created by backup.sh.
# Usage: BACKUP_PASSPHRASE=... sh scripts/restore.sh <db.sql.enc> <wallet.tar.gz.enc>
set -eu

: "${BACKUP_PASSPHRASE:?set BACKUP_PASSPHRASE before restoring}"

DB_DUMP="${1:?usage: restore.sh <db.sql.enc> <wallet.tar.gz.enc>}"
WALLET_ARCHIVE="${2:?usage: restore.sh <db.sql.enc> <wallet.tar.gz.enc>}"

[ -f "$DB_DUMP" ] || { echo "DB dump not found: $DB_DUMP" >&2; exit 1; }
[ -f "$WALLET_ARCHIVE" ] || { echo "Wallet archive not found: $WALLET_ARCHIVE" >&2; exit 1; }

TMPDIR="$(mktemp -d ./.restore-XXXXXX)"
trap 'rm -rf "$TMPDIR"' EXIT
umask 077

DB_PLAIN="$TMPDIR/db.sql"
WALLET_PLAIN="$TMPDIR/wallet.tar.gz"

openssl enc -d -aes-256-cbc -pbkdf2 -in "$DB_DUMP" -out "$DB_PLAIN" -pass env:BACKUP_PASSPHRASE
openssl enc -d -aes-256-cbc -pbkdf2 -in "$WALLET_ARCHIVE" -out "$WALLET_PLAIN" -pass env:BACKUP_PASSPHRASE

COMPOSE_USER="${POSTGRES_USER:-pay}"
COMPOSE_DB="${POSTGRES_DB:-pay}"

echo "Restoring Postgres..."
docker compose exec -T db psql -U "$COMPOSE_USER" -d "$COMPOSE_DB" \
  -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;' >/dev/null
docker compose exec -T db psql -U "$COMPOSE_USER" -d "$COMPOSE_DB" < "$DB_PLAIN" >/dev/null

echo "Restoring wallet data..."
docker run --rm \
  -v pay_wallet_data:/data \
  -v "$(cd "$TMPDIR" && pwd)":/backup:ro \
  alpine@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc \
  tar xzf /backup/wallet.tar.gz -C /data

echo "Restore complete. Restart the stack: docker compose restart"
