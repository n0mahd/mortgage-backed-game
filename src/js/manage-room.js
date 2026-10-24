// lobby.html: the host's Manage players sheet (GET /rooms/:id/manage). Per
// player: "Copy link" (a personal link back to their seat) and "Make host"
// (an offer they must accept, with an account); a pending offer can be
// cancelled. Per agent: "New key", which revokes the old key and shows the new
// invite once, like the waiting room's agent invite (src/js/agent-invites.js).
// Classic browser script, no build.
(function (global) {
    'use strict';

    let roomId = null;
    let data = null;
    let shown = null;
    let options = {};
    let wired = false;

    function el(id) {
        return document.getElementById(id);
    }

    function wire() {
        if (wired) return;
        wired = true;
        el('manage-room-close-btn').addEventListener('click', close);
        el('manage-agent-key-copy-btn').addEventListener('click', copyKey);
        el('manage-agent-key-close-btn').addEventListener('click', closeKey);
        el('manageRoomModal').addEventListener('click', event => {
            if (event.target === event.currentTarget) close();
        });
        el('manageAgentKeyModal').addEventListener('click', event => {
            if (event.target === event.currentTarget) closeKey();
        });
        el('manage-transfer').addEventListener('click', event => {
            const cancel = event.target.closest('[data-manage-cancel-transfer]');
            if (cancel) cancelTransfer(cancel);
        });
        el('manage-player-list').addEventListener('click', event => {
            const button = event.target.closest('button');
            if (!button) return;
            if (button.dataset.manageLink) copyLink(button.dataset.manageLink, button);
            else if (button.dataset.manageHost) makeHost(button.dataset.manageHost, button);
            else if (button.dataset.manageKey) newKey(button.dataset.manageKey, button);
        });
    }

    async function open(id, openOptions = {}) {
        wire();
        roomId = id;
        options = openOptions;
        data = null;
        shown = null;
        el('manage-room-name').textContent = '';
        el('manage-transfer').hidden = true;
        el('manage-player-list').innerHTML = '<div class="loading"><div class="spinner"></div></div>';
        hideLinkOutput();
        setStatus('');
        el('manageRoomModal').classList.add('active');
        await refresh();
    }

    function close() {
        el('manageRoomModal').classList.remove('active');
        hideLinkOutput();
        setStatus('');
        roomId = null;
        if (options.onClose) options.onClose();
    }

    // Also runs on lobby.js's resync (room events, page shown again, slow
    // poll), so it re-renders only when something changed and ignores an
    // answer for a sheet that has since closed or moved to another room.
    async function refresh() {
        const id = roomId;
        if (!id) return;
        try {
            const next = await getRoomManagement(id);
            if (id !== roomId) return;
            const json = JSON.stringify(next);
            if (json === shown) return;
            shown = json;
            data = next;
            render();
        } catch (error) {
            if (id !== roomId) return;
            shown = null;
            el('manage-player-list').innerHTML = `<p class="turn-warning danger">${escapeHtml(error.status === 403
                ? 'Only the host can manage players in this game.'
                : `Could not load the players: ${error.message}`)}</p>`;
        }
    }

    function changed() {
        if (options.onChange) options.onChange();
    }

    function memberName(memberId) {
        const member = data && data.members.find(item => String(item.id) === String(memberId));
        return member ? member.player_name : 'this player';
    }

    function render() {
        const room = data.room || {};
        const completed = room.status === 'completed';
        el('manage-room-name').textContent = room.invite_code ? `${room.name} · ${room.invite_code}` : (room.name || '');

        const offer = data.host_transfer;
        const transfer = el('manage-transfer');
        transfer.hidden = !offer;
        transfer.innerHTML = offer ? `
            <p>Host offer sent to <strong>${escapeHtml(offer.to_player_name)}</strong>. You stay host until they accept.</p>
            <button class="btn btn-secondary btn-sm" data-manage-cancel-transfer="1">Cancel offer</button>
        ` : '';

        const members = [...(data.members || [])].sort((a, b) => Number(b.is_host) - Number(a.is_host));
        const seatedAgentIds = new Set(members.map(member => member.agent_seat_id).filter(Boolean));
        const waitingAgents = (data.agent_seats || []).filter(seat => seat.status === 'pending' && !seatedAgentIds.has(seat.id));

        const rows = members.map(member => renderMember(member, offer, completed))
            .concat(waitingAgents.map((seat, index) => renderWaitingAgent(seat, index, completed)));
        el('manage-player-list').innerHTML = rows.length
            ? rows.join('')
            : '<p class="empty-state">No players yet. Share the room code to invite people.</p>';
    }

    function renderMember(member, offer, completed) {
        const id = escapeHtml(member.id);
        const badges = [];
        if (member.is_host) badges.push('<span class="badge badge-gold">Host</span>');
        if (member.is_agent) badges.push('<span class="badge badge-info">AI</span>');
        else badges.push(member.has_account ? '<span class="badge">Account</span>' : '<span class="badge">Guest</span>');

        const actions = [];
        if (member.is_agent) {
            if (member.agent_seat_id && !completed) {
                actions.push(`<button class="btn btn-secondary btn-sm" data-manage-key="${escapeHtml(member.agent_seat_id)}">New key</button>`);
            }
        } else if (!member.is_host) {
            actions.push(`<button class="btn btn-secondary btn-sm" data-manage-link="${id}">Copy link</button>`);
            if (!completed) {
                actions.push(offer && String(offer.to_member_id) === String(member.id)
                    ? '<span class="manage-player-note">Offer sent</span>'
                    : `<button class="btn btn-secondary btn-sm" data-manage-host="${id}">Make host</button>`);
            }
        }

        return `
            <div class="manage-player-row" data-manage-member="${id}">
                <div class="manage-player-info">
                    <strong>${escapeHtml(member.player_name)}</strong>
                    <span class="manage-player-badges">${badges.join('')}</span>
                </div>
                ${actions.length ? `<div class="manage-player-actions">${actions.join('')}</div>` : ''}
            </div>
        `;
    }

    function renderWaitingAgent(seat, index, completed) {
        return `
            <div class="manage-player-row" data-manage-agent-seat="${escapeHtml(seat.id)}">
                <div class="manage-player-info">
                    <strong>${escapeHtml(seat.label || `Invited agent ${index + 1}`)}</strong>
                    <span class="manage-player-badges"><span class="badge badge-info">AI</span><span class="badge">Not joined</span></span>
                </div>
                ${completed ? '' : `<div class="manage-player-actions"><button class="btn btn-secondary btn-sm" data-manage-key="${escapeHtml(seat.id)}">New key</button></div>`}
            </div>
        `;
    }

    // ── Seat links ─────────────────────────────────────────────

    async function copyLink(memberId, button) {
        const name = memberName(memberId);
        button.disabled = true;
        hideLinkOutput();
        setStatus('');
        try {
            const link = await createSeatLink(roomId, memberId);
            const note = `It lasts 7 days, and a new link for ${name} replaces it.`;
            if (await copyText(link.url)) {
                setStatus(`Link for ${name} copied. Send it only to them. ${note}`);
            } else {
                showLinkOutput(link.url);
                setStatus(`Copy this link and send it only to ${name}. ${note}`);
            }
        } catch (error) {
            setStatus(`Could not make a link: ${error.message}`, true);
        } finally {
            button.disabled = false;
        }
    }

    function showLinkOutput(url) {
        const input = el('manage-link-url');
        input.value = url;
        el('manage-link-output').hidden = false;
        input.focus();
        input.select();
    }

    // The link signs a guest in as that seat, so it does not stay on screen.
    function hideLinkOutput() {
        el('manage-link-url').value = '';
        el('manage-link-output').hidden = true;
    }

    // ── Host transfer ──────────────────────────────────────────

    async function makeHost(memberId, button) {
        const name = memberName(memberId);
        const question = `Offer host to ${name}?\n\nThey must accept, and they need an account (a username and password, or email) to do it. You stay host until they accept.`;
        if (!confirm(question)) return;
        button.disabled = true;
        setStatus('');
        try {
            await offerHostTransfer(roomId, memberId);
            await refresh();
            setStatus(`Offer sent. ${name} will see it in My games.`);
            changed();
        } catch (error) {
            button.disabled = false;
            setStatus(`Could not offer host: ${error.message}`, true);
        }
    }

    async function cancelTransfer(button) {
        button.disabled = true;
        setStatus('');
        try {
            await cancelHostTransfer(roomId);
            await refresh();
            setStatus('Host offer cancelled.');
            changed();
        } catch (error) {
            button.disabled = false;
            setStatus(`Could not cancel the offer: ${error.message}`, true);
        }
    }

    // ── Agent keys ─────────────────────────────────────────────

    async function newKey(seatId, button) {
        if (!confirm("Give this agent a new key? Its current key stops working right away.")) return;
        button.disabled = true;
        setStatus('');
        try {
            const invite = await reissueAgentKey(roomId, seatId);
            showKey(invite);
            await refresh();
        } catch (error) {
            setStatus(`Could not make a new key: ${error.message}`, true);
        } finally {
            button.disabled = false;
        }
    }

    function showKey(invite) {
        el('manage-agent-key-mcp-url').textContent = invite.mcp_url || '';
        el('manage-agent-key-prompt').value = invite.prompt || '';
        el('manage-agent-key-copy-btn').textContent = 'Copy invite';
        el('manageAgentKeyModal').classList.add('active');
    }

    // Clears the key from the page as soon as the host is done with it.
    function closeKey() {
        el('manageAgentKeyModal').classList.remove('active');
        el('manage-agent-key-prompt').value = '';
        el('manage-agent-key-mcp-url').textContent = '';
    }

    async function copyKey() {
        const textarea = el('manage-agent-key-prompt');
        const button = el('manage-agent-key-copy-btn');
        if (await copyText(textarea.value)) {
            button.textContent = 'Copied';
            return;
        }
        textarea.focus();
        textarea.select();
        button.textContent = 'Selected: copy it';
    }

    function setStatus(message, isError = false) {
        const status = el('manage-room-status');
        status.textContent = message;
        status.classList.toggle('error', isError);
    }

    // A change elsewhere (offer answered, player joined or left, agent seat
    // claimed) for the open sheet; no id means whichever room is open.
    function refreshIfOpen(id) {
        if (roomId && (!id || String(id) === String(roomId))) refresh();
    }

    global.ManageRoom = { open, close, refreshIfOpen };
})(window);
