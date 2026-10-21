'use strict';

// HTTP and Socket.IO server: mounts the API routes and authenticates sockets.

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { getConfig, getCorsOptions } = require('./config');
const db = require('./db');
const presence = require('./services/presence');
const { canViewRoom } = require('./services/rooms');
const { setSocketServer } = require('./services/roomEvents');
const { readToken, makeToken } = require('./auth');
const { createMcpRouter } = require('./mcp/server');

const config = getConfig();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: getCorsOptions(config)
});
setSocketServer(io);

if (config.trustProxy !== false) {
    app.set('trust proxy', config.trustProxy);
}

app.use(cors(getCorsOptions(config)));
app.use(express.json({ limit: config.requestBodyLimit }));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/rooms', require('./routes/rooms'));
app.use('/api/games', require('./routes/games'));
app.use('/api/mcp', createMcpRouter());
app.use('/api/push', require('./routes/push'));

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

// Errors never expose stacks or server paths to clients, whatever the env.
app.use((err, _req, res, _next) => {
    const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 500 ? err.status : 500;
    if (status === 500) console.error('Unhandled request error:', err.message);
    if (res.headersSent) return;
    res.status(status).json({ error: status === 500 ? 'Internal server error' : err.message });
});

// ----------------------------------------------------------------
// Socket.io — real-time events
// ----------------------------------------------------------------

// Authenticate socket via token query param or auth header
io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) return next(); // allow unauthenticated (read-only observer)
    const result = readToken(token);
    if (!result) return next(new Error('Invalid token'));
    socket.userId = result.userId;
    socket.staleToken = result.stale;
    next();
});

io.on('connection', (socket) => {
    // Hand a replacement to clients still holding a previous-secret token.
    if (socket.staleToken) socket.emit('auth:token_refreshed', makeToken(socket.userId));

    // Join a room's Socket.io channel
    socket.on('join_room', (roomId, ack) => {
        const reply = typeof ack === 'function' ? ack : () => {};
        if (!socket.userId) {
            reply({ ok: false, error: 'Not authenticated' });
            return;
        }
        if (!canViewRoom(roomId, socket.userId)) {
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

    // The game page reports whether it is on screen, so turn alerts are only
    // pushed to players who aren't looking at the game.
    socket.on('presence', (state) => {
        if (!socket.userId) return;
        presence.setVisible(socket.userId, socket.id, !!state?.visible);
    });

    socket.on('disconnect', () => presence.forgetSocket(socket.userId, socket.id));
});


if (require.main === module) {
    server.listen(config.port, config.host, () => {
        console.log(`Mortgage Backed Game backend running env=${config.env} host=${config.host} port=${config.port} db=${config.dbPath}`);
    });
}

module.exports = { app, server, io };
