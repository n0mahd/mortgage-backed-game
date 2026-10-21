const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { getConfig, getCorsOptions } = require('./config');
const db = require('./db');
const { router: authRouter } = require('./routes/auth');

const config = getConfig();
const PORT = config.port;
const HOST = config.host;
const JWT_SECRET = config.jwtSecret;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: getCorsOptions(config)
});

if (config.trustProxy !== false) {
    app.set('trust proxy', config.trustProxy);
}

const roomsRouter = require('./routes/rooms')(io);
const gamesRouter = require('./routes/games')(io);
const { createMcpRouter } = require('./mcp/server');

app.use(cors(getCorsOptions(config)));
app.use(express.json({ limit: config.requestBodyLimit }));

// Routes
app.use('/api/auth', authRouter);
app.use('/api/rooms', roomsRouter);
app.use('/api/games', gamesRouter);
app.use('/api/mcp', createMcpRouter(io));

// Health check
app.get('/api/health', (_req, res) => {
    try {
        const ping = db.prepare(`SELECT 1 AS ok`).get();
        const migrations = db.prepare(`SELECT COUNT(*) AS count FROM schema_migrations`).get();
        res.json({
            ok: ping.ok === 1,
            env: config.env,
            uptimeSeconds: Math.floor(process.uptime()),
            db: {
                ok: ping.ok === 1,
                migrationsApplied: Number(migrations.count || 0),
            },
        });
    } catch (err) {
        res.status(503).json({
            ok: false,
            env: config.env,
            db: { ok: false },
            error: err.message,
        });
    }
});

// ----------------------------------------------------------------
// Socket.io — real-time events
// ----------------------------------------------------------------

// Authenticate socket via token query param or auth header
io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) return next(); // allow unauthenticated (read-only observer)
    try {
        const payload = jwt.verify(token, JWT_SECRET);
        socket.userId = payload.sub;
    } catch {
        return next(new Error('Invalid token'));
    }
    next();
});

io.on('connection', (socket) => {
    // Join a room's Socket.io channel
    socket.on('join_room', (roomId, ack) => {
        const reply = typeof ack === 'function' ? ack : () => {};
        if (!socket.userId) {
            reply({ ok: false, error: 'Not authenticated' });
            return;
        }
        const membership = db.prepare(`
            SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?
        `).get(roomId, socket.userId);
        if (!membership) {
            reply({ ok: false, error: 'Not a room member' });
            return;
        }
        socket.join(`room:${roomId}`);
        reply({ ok: true });
    });

    // Leave a room's channel
    socket.on('leave_room', (roomId) => {
        socket.leave(`room:${roomId}`);
    });

    socket.on('disconnect', () => {});
});


if (require.main === module) {
    server.listen(PORT, HOST, () => {
        console.log(`Mortgage Backed Game backend running env=${config.env} host=${HOST} port=${PORT} db=${config.dbPath}`);
    });
}

module.exports = { app, server, io };
