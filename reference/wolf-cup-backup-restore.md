# Wolf Cup Backup & Restore

Nightly SQLite snapshots of the live DB are uploaded to the Cloudflare R2 bucket
`wolf-cup-backup` at 03:00 ET. Retention: everything from the last 365 days plus
every 1st-of-month snapshot forever.

Separate R2 credentials from the photo bucket — blast-radius isolation.

## Environment variables (VPS `.env`)

```
R2_ACCOUNT_ID=<same as photo bucket>
R2_BACKUP_ACCESS_KEY_ID=<backup-token access key>
R2_BACKUP_SECRET_ACCESS_KEY=<backup-token secret>
R2_BACKUP_BUCKET_NAME=wolf-cup-backup
```

`R2_ACCOUNT_ID` is already present because the photo bucket needs it. Add the
three `R2_BACKUP_*` lines; restart the API container to pick them up.

## Manual snapshot (admin-only)

```
POST https://wolf.dagle.cloud/api/admin/backup/now
Cookie: session=<admin session>
```

Returns `{ key, bytesUploaded, pruned, durationMs }`. Use this before any
risky admin operation or after an important finalize.

## Listing backups

Any S3-compatible client works. Using AWS CLI:

```bash
export AWS_ACCESS_KEY_ID=<R2_BACKUP_ACCESS_KEY_ID>
export AWS_SECRET_ACCESS_KEY=<R2_BACKUP_SECRET_ACCESS_KEY>
export AWS_DEFAULT_REGION=auto

aws s3 ls \
  --endpoint-url https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com \
  s3://wolf-cup-backup/backups/
```

Keys are lexicographically date-sortable: `backups/wolf-cup-YYYY-MM-DD-HHMMSSZ.db.gz`.

## Restore drill

When something has gone wrong and you need to replace the live DB with a
specific snapshot:

```bash
# 1. Download the target snapshot to your workstation
aws s3 cp \
  --endpoint-url https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com \
  s3://wolf-cup-backup/backups/wolf-cup-2026-04-19-030000Z.db.gz \
  ./restore.db.gz

gunzip ./restore.db.gz   # → ./restore.db

# 2. Verify the snapshot is intact before touching production
sqlite3 ./restore.db "PRAGMA integrity_check;"   # expect: ok
sqlite3 ./restore.db "SELECT COUNT(*) FROM rounds;"

# 3. SSH to the VPS and stop the API container
ssh root@wolf.dagle.cloud
cd /path/to/wolf-cup
docker compose stop api

# 4. Back up the CURRENT live DB before overwriting (belt-and-suspenders)
cp /var/lib/docker/volumes/wolf-cup_sqlite_data/_data/wolf-cup.db \
   /var/lib/docker/volumes/wolf-cup_sqlite_data/_data/wolf-cup.db.pre-restore.$(date +%Y%m%d-%H%M%S).bak

# 5. Upload restore.db to the VPS (from your workstation), then on the VPS:
cp /tmp/restore.db /var/lib/docker/volumes/wolf-cup_sqlite_data/_data/wolf-cup.db

# 6. Start the API container
docker compose start api

# 7. Smoke-test
curl -s https://wolf.dagle.cloud/api/health
curl -s https://wolf.dagle.cloud/api/leaderboard | head -c 500
```

If something looks wrong after startup, the `.pre-restore.*.bak` file from step
4 is your undo button.

## When the nightly job fails

The cron wrapper logs `Backup failed (non-fatal):` to container stdout and
never crashes the API. Check `docker logs wolf-cup-api | grep -i backup`.

Common causes:
- `.env` on the VPS missing one of the three `R2_BACKUP_*` vars (startup logs
  `Backup bucket not configured — nightly backup disabled`)
- R2 API token was deleted or rotated without updating `.env`
- Cloudflare R2 outage (check status.cloudflare.com)

Re-run manually via `POST /api/admin/backup/now` once the underlying issue is
fixed.
