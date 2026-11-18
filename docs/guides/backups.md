---
icon: lucide/archive
---

# Backups

Two things need backing up: the PostgreSQL database and the wallet data volume. The included scripts encrypt both with AES-256-CBC using PBKDF2 and write files with a restrictive umask.

## Take a backup

```bash
BACKUP_PASSPHRASE='a-long-passphrase' sh scripts/backup.sh
```

To write somewhere else, pass a directory:

```bash
BACKUP_PASSPHRASE="$BACKUP_PASSPHRASE" sh scripts/backup.sh /mnt/backups/pay
```

The script produces:

```text
backups/
├── db-20261118-014007.sql.enc
└── wallet-20261118-014007.tar.gz.enc
```

Plaintext files are deleted after encryption. The passphrase comes from the environment, never from the command line arguments.

!!! note "Volume name"
    The wallet scripts refer to `pay_wallet_data`, which is the Compose project name `pay` plus the `wallet_data` volume. If you run the stack under a different project name, change that volume name in `scripts/backup.sh` and `scripts/restore.sh`.

## Restore

```bash
BACKUP_PASSPHRASE='a-long-passphrase' \
  sh scripts/restore.sh \
  backups/db-20261118-014007.sql.enc \
  backups/wallet-20261118-014007.tar.gz.enc
```

The restore script:

1. Decrypts both files into a temporary directory with `umask 077`.
2. Drops and recreates the `public` schema in PostgreSQL, then loads the dump.
3. Extracts the wallet archive into the volume.
4. Prints a reminder to restart the stack.

!!! danger "Restore replaces current data"
    The `public` schema is dropped before the dump is loaded, and wallet files are overwritten. Don't restore into a live stack without stopping writers first.

```bash
docker compose restart
```

## What is encrypted

| File | Contains |
| --- | --- |
| `db-*.sql.enc` | Users, API key hashes, wallets with encrypted view keys, subaddresses, payment requests, proofs, webhooks, and rate-limit buckets. |
| `wallet-*.tar.gz.enc` | The `wallet_data` volume: watch-only wallet files created by `monero-wallet-rpc`. |

Even though the database dump is encrypted, the view keys inside it are already AES-256-GCM encrypted with `WALLET_ENCRYPTION_KEY`. Keep that key safe: without it, restored wallets can't be opened even with a valid backup passphrase.

## Good practice

- Store backups off the app host and test a restore periodically.
- Keep `.env`, `./backups`, and any temporary restore directory at mode `600`/`700`.
- Rotate the backup passphrase by creating a fresh backup with the new value; old backups remain under the old passphrase.
- Back up before upgrades and before changing `WALLET_ENCRYPTION_KEY` or `MONERO_WALLET_PASSWORD`.
