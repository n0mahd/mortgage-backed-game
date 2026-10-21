// Rejoin prompts: when someone asks to take back a seat in this room (they
// lost their token), players who may approve see an Approve / Decline prompt.
// The server decides who may approve; this only lists what it returns.
// Classic browser script, no build.
(function (global) {
    'use strict';

    const RECHECK_MS = 30 * 1000;
    let roomId = null;
    let modal = null;
    let shownId = null;
    let busy = false;

    function ensureModal() {
        if (modal) return modal;
        modal = document.createElement('div');
        modal.className = 'modal rejoin-prompt';
        modal.id = 'rejoinPromptModal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'rejoinPromptTitle');
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header" id="rejoinPromptTitle">Rejoin request</div>
                <p class="rejoin-prompt-text"></p>
                <p class="rejoin-prompt-hint"></p>
                <p class="rejoin-prompt-warning" role="alert" hidden></p>
                <p class="error-message rejoin-prompt-error"></p>
                <div class="modal-actions">
                    <button type="button" class="btn btn-secondary" data-decision="deny">Decline</button>
                    <button type="button" class="btn btn-primary" data-decision="approve">Approve</button>
                </div>
            </div>`;
        modal.querySelectorAll('[data-decision]').forEach(button => {
            button.addEventListener('click', () => decide(button.dataset.decision));
        });
        document.body.appendChild(modal);
        return modal;
    }

    function show(request) {
        const el = ensureModal();
        shownId = request.id;
        const name = request.playerName;
        el.querySelector('.rejoin-prompt-text').textContent = name
            ? `Someone on another device wants to continue as ${name}.`
            : 'Someone on another device wants to continue this whole game.';
        el.querySelector('.rejoin-prompt-hint').textContent = name
            ? `Approve only if ${name} just asked you. Approving signs that device in as ${name}.`
            : 'Approve only if you just asked for this. Approving signs that device in as every player.';
        const warning = el.querySelector('.rejoin-prompt-warning');
        warning.textContent = request.otherRecentRequests > 0
            ? 'More than one device asked for this in the last 10 minutes. Decline unless you are sure this one is theirs.'
            : '';
        warning.hidden = !request.otherRecentRequests;
        el.querySelector('.rejoin-prompt-error').textContent = '';
        el.classList.add('active');
    }

    function hide() {
        shownId = null;
        if (modal) modal.classList.remove('active');
    }

    async function refresh() {
        if (!roomId || busy) return;
        try {
            const requests = await global.apiFetch(`/rooms/${roomId}/rejoin-requests`);
            if (requests.length > 0) show(requests[0]);
            else hide();
        } catch (error) {
            console.warn('Could not check rejoin requests:', error.message || error);
        }
    }

    async function decide(decision) {
        if (!shownId || busy) return;
        busy = true;
        modal.querySelectorAll('[data-decision]').forEach(button => { button.disabled = true; });
        try {
            await global.apiFetch(`/rooms/${roomId}/rejoin-requests/${shownId}/${decision}`, { method: 'POST' });
            hide();
        } catch (error) {
            const errorEl = modal.querySelector('.rejoin-prompt-error');
            errorEl.textContent = error.message || 'Could not answer the request.';
        } finally {
            busy = false;
            modal.querySelectorAll('[data-decision]').forEach(button => { button.disabled = false; });
        }
        refresh();
    }

    // Call once the page has joined the room's socket channel.
    function watch(id) {
        if (roomId) return;
        roomId = id;
        const socket = global.getSocket();
        socket.on('room:rejoin_request', (payload) => {
            if (!payload || payload.roomId === roomId) refresh();
        });
        socket.on('connect', refresh);
        global.setInterval(refresh, RECHECK_MS);
        refresh();
    }

    global.RejoinPrompts = { watch };
})(window);
