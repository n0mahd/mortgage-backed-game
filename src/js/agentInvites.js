// Waiting room: the host's AI agent invites. Each invite seats one agent; its
// key appears once, in the modal shown right after creating it, and is never
// stored in the page or fetched again.

const AgentInvites = (() => {
    let roomId = null;
    let seats = [];

    const STATUS_TEXT = {
        pending: 'Waiting for the agent to join',
        joined: 'Joined',
    };

    function mount(id) {
        roomId = id;
        document.getElementById('agent-invites').style.display = '';
        document.getElementById('agent-invite-create-btn').addEventListener('click', createInvite);
        document.getElementById('agent-invite-copy-btn').addEventListener('click', copyPrompt);
        document.getElementById('agent-invite-close-btn').addEventListener('click', closeModal);
        document.getElementById('agent-invite-list').addEventListener('click', event => {
            const rename = event.target.closest('[data-agent-seat-rename]');
            if (rename) return renameInvite(rename.dataset.agentSeatRename, rename);
            const revoke = event.target.closest('[data-agent-seat-revoke]');
            if (revoke) revokeInvite(revoke.dataset.agentSeatRevoke, revoke);
        });
        return refresh();
    }

    async function refresh() {
        if (!roomId) return;
        try {
            seats = await listAgentInvites(roomId);
            render();
        } catch (error) {
            setStatus(`Could not load agent invites: ${error.message}`);
        }
    }

    function render() {
        const list = document.getElementById('agent-invite-list');
        const pending = seats.filter(seat => seat.status === 'pending').length;
        setStatus(pending === 0 ? '' : `${pending} invited agent${pending === 1 ? " hasn't" : "s haven't"} joined yet. Invites stop working once the game starts.`);
        if (seats.length === 0) {
            list.innerHTML = '';
            return;
        }
        list.innerHTML = seats.map((seat, index) => `
            <div class="agent-invite-row" data-agent-seat="${escapeHtml(seat.id)}">
                <div class="agent-invite-row-info">
                    <strong>${escapeHtml(seat.player_name || seat.label || `Agent ${index + 1}`)}</strong>
                    <div class="agent-invite-status">
                        ${seat.status === 'joined' ? STATUS_TEXT.joined : STATUS_TEXT.pending}
                    </div>
                </div>
                <div class="agent-invite-row-actions">
                    <button class="btn btn-secondary btn-sm" data-agent-seat-rename="${escapeHtml(seat.id)}">Rename</button>
                    <button class="btn btn-secondary btn-sm" data-agent-seat-revoke="${escapeHtml(seat.id)}">Revoke</button>
                </div>
            </div>
        `).join('');
    }

    async function createInvite() {
        const button = document.getElementById('agent-invite-create-btn');
        const nameInput = document.getElementById('agent-invite-name');
        button.disabled = true;
        setStatus('');
        try {
            const invite = await createAgentInvite(roomId, nameInput.value.trim());
            nameInput.value = '';
            showModal(invite);
            await refresh();
        } catch (error) {
            setStatus(error.message === 'Room is full'
                ? 'The room is full. Raise the player limit or revoke an invite first.'
                : `Could not create an invite: ${error.message}`);
        } finally {
            button.disabled = false;
        }
    }

    // Names are fixed once the game starts, so this only works in the waiting room.
    async function renameInvite(seatId, button) {
        const seat = seats.find(item => item.id === seatId);
        const current = seat ? seat.player_name || seat.label || '' : '';
        const name = prompt('Name for this agent', current);
        if (name === null || name.trim() === '' || name.trim() === current) return;
        button.disabled = true;
        try {
            await renameAgentInvite(roomId, seatId, name.trim());
            await refresh();
        } catch (error) {
            button.disabled = false;
            setStatus(`Could not rename: ${error.message}`);
        }
    }

    async function revokeInvite(seatId, button) {
        const seat = seats.find(item => item.id === seatId);
        const what = seat && seat.status === 'joined' ? `remove ${seat.player_name || 'this agent'} from the room` : 'cancel this invite';
        if (!confirm(`Revoke this agent's key and ${what}?`)) return;
        button.disabled = true;
        try {
            await revokeAgentInvite(roomId, seatId);
            await refresh();
        } catch (error) {
            button.disabled = false;
            setStatus(`Could not revoke: ${error.message}`);
        }
    }

    function showModal(invite) {
        document.getElementById('agent-invite-mcp-url').textContent = invite.mcp_url;
        document.getElementById('agent-invite-prompt').value = invite.prompt;
        document.getElementById('agent-invite-copy-btn').textContent = 'Copy invite';
        document.getElementById('agent-invite-modal').classList.add('active');
    }

    // Clears the key from the page as soon as the host is done with it.
    function closeModal() {
        document.getElementById('agent-invite-modal').classList.remove('active');
        document.getElementById('agent-invite-prompt').value = '';
    }

    async function copyPrompt() {
        const textarea = document.getElementById('agent-invite-prompt');
        const button = document.getElementById('agent-invite-copy-btn');
        if (await copyText(textarea.value)) {
            button.textContent = 'Copied';
            return;
        }
        textarea.focus();
        textarea.select();
        button.textContent = 'Selected: copy it';
    }

    function setStatus(message) {
        document.getElementById('agent-invite-status').textContent = message;
    }

    return { mount, refresh };
})();
