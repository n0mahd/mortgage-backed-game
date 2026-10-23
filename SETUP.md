# Mortgage Backed Monopoly - Setup

The current live architecture is a static frontend plus an Express, Socket.IO, and SQLite backend. There is no build step for the frontend.

## Development

Use dev-only ports and data paths. Do not use production port `80`, backend port `3010`, or production data directories for testing.

```bash
mkdir -p /mnt/ssd/dev-data/mortgage-backed
PORT=3111 \
DB_PATH=/mnt/ssd/dev-data/mortgage-backed/game.db \
JWT_SECRET=dev-secret-change-me \
CORS_ORIGINS=http://100.110.102.49:3011,http://pi.taildb6607.ts.net:3011,http://localhost:3011 \
npm --prefix backend run start
```

Serve the static frontend on the phone-facing dev port with dev API and Socket.IO proxying to `3111`:

```bash
PORT=3011 DEV_BACKEND_ORIGIN=http://127.0.0.1:3111 npm run dev:web
```

Phone test URLs:

- `http://100.110.102.49:3011`
- `http://pi.taildb6607.ts.net:3011`

## Production

Production is served by nginx on public port `80` for `mortgage.abdlh.com`. nginx proxies `/api/` and `/socket.io/` to the backend on `127.0.0.1:3010`.

Backend production configuration must include:

```bash
APP_ENV=production
PORT=3010
DB_PATH=/mnt/ssd/projects/mortgage-backed/backend/game.db
JWT_SECRET=<long-random-secret>
CORS_ORIGINS=https://mortgage.abdlh.com,http://mortgage.abdlh.com
ALLOW_STATE_REPAIR=false
LOG_OTPS=false
```

The backend refuses to start in production without an explicit `DB_PATH`, explicit CORS origins, and a non-default `JWT_SECRET`.

### Rotating `JWT_SECRET` without signing anyone out

1. Set `JWT_SECRET_PREVIOUS` to the current secret and `JWT_SECRET` to a new one (`openssl rand -base64 48`), then restart. Tokens signed with the old secret keep working, and the server answers each one with a new-secret token that the browser swaps in.
2. Leave it for a week or two, so players who open the game in that time move over. The old secret still works during the window, so keep it short after a leak.
3. Remove `JWT_SECRET_PREVIOUS` and restart. Tokens signed with the old secret stop working; tokens swapped during the window last until they expire (30 days in today's production config). Email players sign back in with a code; guests rejoin through the room code with another player's approval.

## Architecture

- Clients render state and submit actions.
- The backend owns dice, rules, money movement, turn order, event logging, and state persistence.
- Normal game mutation uses `POST /api/games/:id/actions`.
- Direct whole-state patching is disabled unless `ALLOW_STATE_REPAIR=true`, and then only the host may use `host_state_repair`.
- SQLite stores rooms, members, users, current game snapshots, append-only events, and idempotent action records.

## Backups

Run a daily SQLite backup, retaining 14 days by default:

```bash
DB_PATH=/mnt/ssd/projects/mortgage-backed/backend/game.db \
BACKUP_DIR=/mnt/ssd/backups/mortgage-backed \
scripts/backup-db.sh
```

Restore to a dev database for rehearsal:

```bash
DB_PATH=/mnt/ssd/dev-data/mortgage-backed/restore-rehearsal.db \
scripts/restore-db.sh /mnt/ssd/backups/mortgage-backed/game-YYYYMMDDTHHMMSSZ.db
```

Production restore requires the backend to be stopped first and an explicit confirmation flag:

```bash
sudo systemctl stop mortgage-backend
CONFIRM_RESTORE=restore-production \
DB_PATH=/mnt/ssd/projects/mortgage-backed/backend/game.db \
scripts/restore-db.sh /mnt/ssd/backups/mortgage-backed/game-YYYYMMDDTHHMMSSZ.db
sudo systemctl start mortgage-backend
```

The restore script checks the backup before copying, preserves the current database in a pre-restore backup directory when one exists, and checks the restored database afterward.

## Verification

Backend:

```bash
npm --prefix backend test -- --runInBand
```

E2E against dev ports:

```bash
BASE_URL=http://100.110.102.49:3011 \
API_BASE_URL=http://100.110.102.49:3111/api \
npm run test:e2e
```

Release real-player E2E against dev-only ports and a dev-only SQLite database:

```bash
npm run test:e2e:real-game
```
