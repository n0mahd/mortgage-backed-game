'use strict';

// Reads mail that the dev backend sent (through Resend) to the user's AgentMail
// test inboxes. Only `received` messages newer than `since` count, so earlier
// runs' codes are never reused.

const fs = require('fs');
const os = require('os');
const path = require('path');

// The maintainer's AgentMail test inboxes live outside the (public) repo: one
// address per line in ~/.config/verify-mortgage/inboxes, or VERIFY_AGENTMAIL_INBOXES
// (comma-separated). Without them, email seats use made-up addresses whose codes
// are read from the dev DB, and --email is refused.
const INBOX_FILE = process.env.VERIFY_AGENTMAIL_INBOX_FILE || path.join(os.homedir(), '.config', 'verify-mortgage', 'inboxes');

function loadInboxes() {
    const raw = process.env.VERIFY_AGENTMAIL_INBOXES || (() => { try { return fs.readFileSync(INBOX_FILE, 'utf8'); } catch { return ''; } })();
    return raw.split(/[\s,]+/).map(x => x.trim()).filter(Boolean).slice(0, 3);
}

const INBOXES = loadInboxes();
const FAKE_EMAILS = [1, 2, 3].map(n => `verify-seat-${n}@example.test`);
const KEY_FILE = process.env.VERIFY_AGENTMAIL_KEY_FILE
    || path.join(os.homedir(), '.config', 'alf-layla-verify', 'agentmail.key');
const API = 'https://api.agentmail.to/v0';

function agentmailKey() {
    return fs.readFileSync(KEY_FILE, 'utf8').trim();
}

async function api(address, suffix) {
    const res = await fetch(`${API}/inboxes/${encodeURIComponent(address)}${suffix}`, {
        headers: { Authorization: `Bearer ${agentmailKey()}` },
    });
    if (!res.ok) throw new Error(`AgentMail ${res.status} for ${address}${suffix}`);
    return res.json();
}

async function inboxReachable(address) {
    await api(address, '');
    return true;
}

// Waits for a received message whose subject contains `subject`, newer than
// `since` (ms). Returns { subject, text, timestamp, from }.
async function waitForMail(address, { subject, since, timeoutMs = 90000 }) {
    const deadline = Date.now() + timeoutMs;
    let seen = [];
    while (Date.now() < deadline) {
        const { messages = [] } = await api(address, '/messages?limit=20');
        seen = messages.filter(m => new Date(m.timestamp).getTime() >= since - 5000);
        const hit = seen.find(m => (m.subject || '').includes(subject) && (m.labels || []).includes('received'));
        if (hit) {
            const full = await api(address, `/messages/${encodeURIComponent(hit.message_id)}`);
            return { subject: full.subject, text: full.text || full.preview || '', html: full.html || '', timestamp: full.timestamp, from: full.from };
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
    const summary = seen.map(m => `"${m.subject}" [${(m.labels || []).join(',')}]`).join('; ') || 'none';
    throw new Error(`No mail "${subject}" reached ${address} within ${timeoutMs / 1000}s (recent: ${summary})`);
}

module.exports = { INBOXES, INBOX_FILE, FAKE_EMAILS, KEY_FILE, inboxReachable, waitForMail };
