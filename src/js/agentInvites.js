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
            const button = event.target.closest('[data-agent-seat-revoke]');
            if (button) revokeInvite(button.dataset.agentSeatRevoke, button);
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
                <div>
                    <strong>${escapeHtml(seat.label || `Agent ${index + 1}`)}</strong>
                    <div class="agent-invite-status">
                        ${seat.status === 'joined'
                            ? `${STATUS_TEXT.joined} as ${escapeHtml(seat.player_name || 'an agent')}`
                            : STATUS_TEXT.pending}
                    </div>
                </div>
                <button class="btn btn-secondary btn-sm" data-agent-seat-revoke="${escapeHtml(seat.id)}">Revoke</button>
            </div>
        `).join('');
    }

    async function createInvite() {
        const button = document.getElementById('agent-invite-create-btn');
        button.disabled = true;
        setStatus('');
        try {
            const invite = await createAgentInvite(roomId);
            showModal(invite.prompt);
            await refresh();
        } catch (error) {
            setStatus(error.message === 'Room is full'
                ? 'The room is full. Raise the player limit or revoke an invite first.'
                : `Could not create an invite: ${error.message}`);
        } finally {
            button.disabled = false;
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

    function showModal(prompt) {
        document.getElementById('agent-invite-prompt').value = prompt;
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
