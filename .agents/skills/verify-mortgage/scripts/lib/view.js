'use strict';

// The agent's eyes and hands: a compact text view of one seat's screen with a
// numbered list of the controls a person could use, and helpers that act on
// those numbers. Refs are written onto the elements as data-vm-ref; when the
// game re-renders and drops them, actions fall back to the control's kind and
// label from the last look.

// Runs in the page. Keep it self-contained (no closures over Node values).
function snapshotInPage({ maxTextChars }) {
    const visible = el => {
        if (!el || !el.isConnected) return false;
        const style = getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    };
    const clean = text => String(text || '').replace(/\s+/g, ' ').trim();

    const modals = [...document.querySelectorAll('.modal, [role="dialog"], #hotseat-interstitial')].filter(visible);
    const modal = modals[modals.length - 1] || null;
    const activeSection = document.querySelector('.section.active');
    const scopes = modal
        ? [modal]
        : [document.querySelector('.header'), document.querySelector('.nav-tabs'), document.getElementById('turn-banner'), activeSection]
            .filter(Boolean);
    const scopeRoots = scopes.length && document.querySelector('.nav-tabs') ? scopes : [document.body];

    document.querySelectorAll('[data-vm-ref]').forEach(el => el.removeAttribute('data-vm-ref'));

    const labelFor = el => {
        const aria = el.getAttribute('aria-label');
        if (aria) return clean(aria);
        if (el.id) {
            const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
            if (label) return clean(label.innerText);
        }
        const wrapping = el.closest('label');
        if (wrapping && wrapping !== el) return clean(wrapping.innerText);
        const group = el.closest('.form-group');
        const groupLabel = group && group.querySelector('label');
        if (groupLabel && ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) return clean(groupLabel.innerText);
        if (el.tagName === 'BUTTON' || el.tagName === 'A' || el.getAttribute('role') === 'button') {
            return clean(el.innerText) || clean(el.getAttribute('title')) || el.id;
        }
        return clean(el.getAttribute('placeholder')) || clean(el.getAttribute('title')) || el.name || el.id || el.tagName.toLowerCase();
    };

    const controls = [];
    const seen = new Set();
    const selector = 'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [data-game-action]';
    for (const root of scopeRoots) {
        for (const el of root.querySelectorAll(selector)) {
            if (seen.has(el) || !visible(el)) continue;
            seen.add(el);
            const ref = `e${controls.length + 1}`;
            el.setAttribute('data-vm-ref', ref);
            const tag = el.tagName.toLowerCase();
            let kind = tag === 'a' ? 'link' : tag;
            if (tag === 'input') kind = el.type === 'checkbox' || el.type === 'radio' ? el.type : `input:${el.type || 'text'}`;
            if (el.classList.contains('nav-tab')) kind = 'tab';
            const item = { ref, kind, label: labelFor(el), disabled: !!el.disabled };
            if (el.disabled && el.title) item.why = clean(el.title);
            if (kind === 'tab') item.active = el.classList.contains('active');
            if (tag === 'select') {
                const options = [...el.options];
                item.value = clean(el.selectedOptions[0]?.innerText);
                item.options = options.slice(0, 15).map(o => clean(o.innerText));
                if (options.length > 15) item.options.push(`…+${options.length - 15}`);
            } else if (tag === 'input' || tag === 'textarea') {
                if (el.type === 'checkbox' || el.type === 'radio') item.checked = el.checked;
                else item.value = el.value;
            }
            if (el.dataset.gameAction) item.action = el.dataset.gameAction;
            controls.push(item);
        }
    }

    // Board squares carry most of the board tab's text; summarise instead.
    const textRoots = modal ? [modal] : (activeSection ? [activeSection] : [document.body]);
    let text = textRoots.map(root => {
        if (root.id === 'board') {
            const status = root.querySelector('.board-center, .board-status, .board-actions');
            return '[Board tab: visual board. Use `shot` to see it.] ' + clean(status ? status.innerText : '').slice(0, 600);
        }
        return root.innerText;
    }).join('\n');
    text = text.split('\n').map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
    const truncated = text.length > maxTextChars;
    if (truncated) text = text.slice(0, maxTextChars) + `\n…[${text.length - maxTextChars} more chars; use look --full]`;

    let game = null;
    try {
        if (typeof currentGame !== 'undefined' && currentGame && currentGame.game_state && typeof currentUser !== 'undefined' && currentUser) {
            const state = currentGame.game_state;
            const current = state.players[state.currentPlayerIndex] || {};
            const me = state.players.find(p => p.userId === currentUser.id) || null;
            game = {
                version: currentGame.state_version,
                currentName: current.name,
                myTurn: !!me && current.userId === me.userId,
                me: me && { name: me.name, cash: me.cash, position: me.position, inJail: me.inJail, bankrupt: me.bankrupt, diceRolled: me.diceRolled },
                auctionOpen: state.auction?.status === 'open',
                paused: !!state.paused,
                ended: !!state.ended,
            };
        }
    } catch {}

    const toasts = [...document.querySelectorAll('body > div')]
        .filter(el => el.style && el.style.position === 'fixed' && el.style.zIndex === '9999' && visible(el))
        .map(el => clean(el.innerText));
    const statuses = [...document.querySelectorAll('[role="status"], .error-message.active, .market-status')]
        .filter(visible).map(el => clean(el.innerText)).filter(Boolean);

    return {
        url: location.pathname.replace(/^\//, '') + location.search,
        title: document.title,
        modal: modal ? clean(modal.querySelector('.modal-header, h2, h3')?.innerText || modal.id) : null,
        activeTab: clean(document.querySelector('.nav-tab.active')?.innerText) || null,
        game,
        toasts,
        statuses,
        text,
        controls,
    };
}

function money(value) {
    const n = Number(value);
    return Number.isFinite(n) ? `$${n.toFixed(2)}` : String(value);
}

function formatView(seat, snap, { dialogs = [], issues = [] } = {}) {
    const lines = [];
    const vp = seat.viewport ? `${seat.viewport.width}x${seat.viewport.height}` : '';
    lines.push(`[seat ${seat.index} ${seat.name} · ${seat.device} ${vp}] ${snap.url}${snap.activeTab ? ` · tab: ${snap.activeTab}` : ''}`);
    if (snap.game) {
        const g = snap.game;
        const me = g.me ? `You: ${money(g.me.cash)} at square ${g.me.position}${g.me.inJail ? ' (in Jail)' : ''}${g.me.bankrupt ? ' (BANKRUPT)' : ''}${g.me.diceRolled ? ', rolled' : ''}` : 'You: not a player';
        const flags = [g.myTurn ? 'YOUR TURN' : `turn: ${g.currentName}`, g.auctionOpen && 'AUCTION OPEN', g.paused && 'PAUSED', g.ended && 'GAME OVER'].filter(Boolean).join(' | ');
        lines.push(`${flags} · ${me} · v${g.version}`);
    }
    if (snap.modal) lines.push(`MODAL OPEN: ${snap.modal} (only its controls are listed)`);
    if (snap.toasts.length) lines.push(`TOAST: ${snap.toasts.join(' | ')}`);
    if (snap.statuses.length) lines.push(`STATUS: ${snap.statuses.join(' | ')}`);
    dialogs.forEach(d => lines.push(`DIALOG (${d.type}, auto-${d.handled}): ${d.message}`));
    issues.forEach(i => lines.push(`ISSUE: ${i}`));
    lines.push('--- screen ---');
    lines.push(snap.text || '(no text)');
    lines.push('--- controls: click <ref|"label">, fill <ref> <value>, select <ref> <option>, check <ref> ---');
    for (const c of snap.controls) {
        const bits = [c.kind];
        if (c.active) bits.push('active');
        if (c.disabled) bits.push(c.why ? `disabled: ${c.why}` : 'disabled');
        if (c.checked !== undefined) bits.push(c.checked ? 'checked' : 'unchecked');
        let line = `${c.ref} [${bits.join(', ')}] ${c.label || '(no label)'}`;
        if (c.options) line += ` = "${c.value}" ▾ (${c.options.join(' | ')})`;
        else if (c.value !== undefined && c.value !== '') line += ` = "${c.value}"`;
        lines.push(line);
    }
    if (!snap.controls.length) lines.push('(no visible controls)');
    return lines.join('\n');
}

// Resolves a ref ("e5") or a label ("End Turn") to a Playwright locator.
async function resolveControl(page, lastControls, target) {
    const asRef = /^e\d+$/.test(target);
    if (asRef) {
        const byRef = page.locator(`[data-vm-ref="${target}"]`);
        if (await byRef.count()) return { locator: byRef.first(), note: '' };
        const remembered = (lastControls || []).find(c => c.ref === target);
        if (!remembered) throw new Error(`Unknown ref ${target}. Run look first.`);
        target = remembered.label;
        const found = await findByLabel(page, target, remembered.kind);
        if (found) return { locator: found, note: `(${remembered.ref} went stale after a re-render; matched "${target}")` };
        throw new Error(`Ref went stale and no visible control is labelled "${target}" now. Run look again.`);
    }
    const found = await findByLabel(page, target);
    if (found) return { locator: found, note: '' };
    throw new Error(`No visible control labelled "${target}". Run look to see the controls.`);
}

async function findByLabel(page, label, kind) {
    const ref = await page.evaluate(({ label, kind }) => {
        const clean = text => String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
        const want = clean(label);
        const els = [...document.querySelectorAll('[data-vm-ref]')];
        const tagByKind = { tab: 'button', link: 'a', checkbox: 'input', radio: 'input' };
        const wantTag = kind ? (tagByKind[kind] || kind.split(':')[0]) : null;
        const kindOk = el => !wantTag || el.tagName.toLowerCase() === wantTag;
        const text = el => clean(el.getAttribute('aria-label') || el.innerText || el.value || el.getAttribute('title'));
        const exact = els.find(el => kindOk(el) && text(el) === want && !el.disabled) || els.find(el => kindOk(el) && text(el) === want);
        // A stale ref (kind given) must match its old label exactly; a typed label may match part of one.
        const partial = exact || (kind ? null : els.find(el => text(el).includes(want) && !el.disabled) || els.find(el => text(el).includes(want)));
        return partial ? partial.getAttribute('data-vm-ref') : null;
    }, { label, kind });
    if (!ref && kind) return null;
    if (ref) return page.locator(`[data-vm-ref="${ref}"]`).first();
    // Refs are only assigned by look; assign them now and retry once.
    await page.evaluate(snapshotInPage, { maxTextChars: 10 });
    const retry = await page.evaluate(({ label }) => {
        const want = label.replace(/\s+/g, ' ').trim().toLowerCase();
        const els = [...document.querySelectorAll('[data-vm-ref]')];
        const text = el => String(el.getAttribute('aria-label') || el.innerText || el.value || '').replace(/\s+/g, ' ').trim().toLowerCase();
        const hit = els.find(el => text(el) === want) || els.find(el => text(el).includes(want));
        return hit ? hit.getAttribute('data-vm-ref') : null;
    }, { label });
    return retry ? page.locator(`[data-vm-ref="${retry}"]`).first() : null;
}

module.exports = { snapshotInPage, formatView, resolveControl };
