'use strict';

// Host offers, the receiving player's side (services/hostTransfers.js). The
// host makes and cancels offers through routes/rooms.js.

const express = require('express');
const { requireAuth } = require('../auth');
const { listMyHostTransfers, acceptHostTransfer, declineHostTransfer } = require('../services/hostTransfers');

const router = express.Router();

// GET /api/host-transfers/mine — pending offers made to me
router.get('/mine', requireAuth, (req, res) => {
    res.json(listMyHostTransfers(req.userId));
});

// POST /api/host-transfers/:id/accept — 403 code 'account_required' for guests
router.post('/:id/accept', requireAuth, (req, res) => {
    res.json({ room: acceptHostTransfer({ transferId: req.params.id, userId: req.userId }) });
});

// POST /api/host-transfers/:id/decline
router.post('/:id/decline', requireAuth, (req, res) => {
    declineHostTransfer({ transferId: req.params.id, userId: req.userId });
    res.json({ ok: true });
});

module.exports = router;
