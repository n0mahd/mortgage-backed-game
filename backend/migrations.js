function migrate(db) {
    db.exec(`PRAGMA foreign_keys = ON`);
    db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            id TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
    `);

    apply(db, '001_initial_schema', () => {
        db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                email TEXT UNIQUE,
                is_anonymous INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS otps (
                id TEXT PRIMARY KEY,
                email TEXT NOT NULL,
                code TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                used INTEGER NOT NULL DEFAULT 0,
                attempts INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS rooms (
                id TEXT PRIMARY KEY,
                invite_code TEXT NOT NULL UNIQUE,
                host_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                max_players INTEGER NOT NULL DEFAULT 4,
                status TEXT NOT NULL DEFAULT 'waiting',
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS room_members (
                id TEXT PRIMARY KEY,
                room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                player_name TEXT NOT NULL,
                joined_at TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE (room_id, user_id)
            );

            CREATE TABLE IF NOT EXISTS games (
                id TEXT PRIMARY KEY,
                room_id TEXT NOT NULL UNIQUE REFERENCES rooms(id) ON DELETE CASCADE,
                game_state TEXT NOT NULL,
                current_player_index INTEGER NOT NULL DEFAULT 0,
                state_version INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS game_events (
                id TEXT PRIMARY KEY,
                game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
                player_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                event_type TEXT NOT NULL,
                event_data TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
        `);
    });

    apply(db, '002_state_version_and_actions', () => {
        const gameColumns = db.prepare(`PRAGMA table_info(games)`).all().map(col => col.name);
        if (!gameColumns.includes('state_version')) {
            db.exec(`ALTER TABLE games ADD COLUMN state_version INTEGER NOT NULL DEFAULT 0`);
        }
        const otpColumns = db.prepare(`PRAGMA table_info(otps)`).all().map(col => col.name);
        if (!otpColumns.includes('attempts')) {
            db.exec(`ALTER TABLE otps ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0`);
        }
        db.exec(`
            CREATE TABLE IF NOT EXISTS game_actions (
                id TEXT PRIMARY KEY,
                game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
                actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                action_id TEXT NOT NULL,
                action_type TEXT NOT NULL,
                request_json TEXT NOT NULL DEFAULT '{}',
                result_json TEXT NOT NULL DEFAULT '{}',
                state_version INTEGER NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE (game_id, action_id)
            );
            CREATE INDEX IF NOT EXISTS idx_game_events_game_created
                ON game_events (game_id, created_at DESC);
        `);
    });

    apply(db, '003_operational_hot_path_indexes', () => {
        db.exec(`
            CREATE INDEX IF NOT EXISTS idx_room_members_room_joined
                ON room_members (room_id, joined_at ASC);
            CREATE INDEX IF NOT EXISTS idx_room_members_user_joined
                ON room_members (user_id, joined_at DESC);
            CREATE INDEX IF NOT EXISTS idx_games_room
                ON games (room_id);
            CREATE INDEX IF NOT EXISTS idx_game_actions_game_created
                ON game_actions (game_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_game_actions_actor_created
                ON game_actions (actor_user_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_otps_email_used_expires
                ON otps (email, used, expires_at);
            CREATE INDEX IF NOT EXISTS idx_rooms_status_created
                ON rooms (status, created_at DESC);
        `);
    });

    apply(db, '004_device_transfer_codes', () => {
        db.exec(`
            CREATE TABLE IF NOT EXISTS device_transfer_codes (
                code_hash TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                expires_at TEXT NOT NULL,
                used_at TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_device_transfer_codes_user
                ON device_transfer_codes (user_id);
        `);
    });

    apply(db, '005_rejoin_requests', () => {
        db.exec(`
            CREATE TABLE IF NOT EXISTS rejoin_requests (
                id TEXT PRIMARY KEY,
                room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
                member_id TEXT REFERENCES room_members(id) ON DELETE CASCADE,
                secret_hash TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                decided_by TEXT REFERENCES users(id) ON DELETE SET NULL,
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_rejoin_requests_room_status
                ON rejoin_requests (room_id, status);
        `);
    });

    // Host-issued seats for AI agents. The key is the agent's only credential
    // (MCP tools take it on every call); only its SHA-256 hash is stored.
    apply(db, '006_agent_seats', () => {
        db.exec(`
            CREATE TABLE IF NOT EXISTS agent_seats (
                id TEXT PRIMARY KEY,
                room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
                key_hash TEXT NOT NULL UNIQUE,
                label TEXT,
                created_by TEXT NOT NULL REFERENCES users(id),
                user_id TEXT REFERENCES users(id),
                joined_at TEXT,
                revoked_at TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_agent_seats_room ON agent_seats (room_id);
            CREATE INDEX IF NOT EXISTS idx_agent_seats_user ON agent_seats (user_id);
        `);
    });

    apply(db, '007_push_subscriptions', () => {
        db.exec(`
            CREATE TABLE IF NOT EXISTS push_subscriptions (
                endpoint TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                p256dh TEXT NOT NULL,
                auth TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                last_success_at TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user
                ON push_subscriptions (user_id, created_at DESC);
        `);
    });
}

function apply(db, id, fn) {
    const existing = db.prepare(`SELECT id FROM schema_migrations WHERE id = ?`).get(id);
    if (existing) return;
    fn();
    db.prepare(`INSERT INTO schema_migrations (id) VALUES (?)`).run(id);
}

module.exports = { migrate };
