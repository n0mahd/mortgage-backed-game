// Getting back into a room from the home page or a room link: the saved
// hotseat players on this device, or "continue as an existing player" for a
// full or started room, which asks a player in the game to approve.
// Loaded by index.html and waiting.html. Uses the session and resume storage
// helpers in api.js. Classic browser script, no build.
(function (global) {
    'use strict';

    function restoreHotseatResume(resume) {
        setHotseatSession(resume.tokens);
        return true;
    }

    function restoreHotseatPlayer(resume, userId) {
        const player = resume.tokens.find(record => record.userId === userId);
        if (!player || !player.token) return false;

        clearHotseatSession();
        setToken(player.token);
        return true;
    }

    function continueSavedHotseat(inviteCode, restore) {
        const resume = getHotseatResumeByCode(inviteCode);
        if (!resume || !restore(resume)) return false;

        navigateToGameRoom(resume.roomId);
        return true;
    }

    function showSavedHotseat(container, inviteCode) {
        if (!container) return false;

        const resume = getHotseatResumeByCode(inviteCode);
        if (!resume) {
            container.innerHTML = '';
            container.style.display = 'none';
            return false;
        }

        renderResumeOptions(container, {
            title: 'Continue this saved hotseat game',
            hint: 'Use local hotseat on this device, or continue online as one player.',
            onHotseat: () => continueSavedHotseat(inviteCode, restoreHotseatResume),
            players: resume.tokens.map(record => ({
                label: record.name || 'Player',
                onClick: () => continueSavedHotseat(inviteCode, saved => restoreHotseatPlayer(saved, record.userId)),
            })),
        });
        return true;
    }

    function showExistingMembers(container, inviteCode, room) {
        if (!container || !room || !Array.isArray(room.room_members)) return false;

        const roomIsClosedToNewMembers = room.status !== 'waiting' || room.room_members.length >= room.max_players;
        if (!roomIsClosedToNewMembers) return false;

        const showOptions = () => renderResumeOptions(container, {
            title: 'Continue as an existing player',
            hint: 'This room is already full. Pick who you are; a player in the game approves it on their screen.',
            onHotseat: () => requestRoomRejoin(container, inviteCode, room, null, showOptions),
            players: room.room_members.map(member => ({
                label: member.player_name || 'Player',
                onClick: () => requestRoomRejoin(container, inviteCode, room, member, showOptions),
            })),
        });
        showOptions();
        return true;
    }

    function renderResumeOptions(container, { title, hint, onHotseat, players }) {
        container.innerHTML = '';
        container.style.display = 'block';

        const titleEl = document.createElement('h4');
        titleEl.textContent = title;
        container.appendChild(titleEl);

        const hintEl = document.createElement('p');
        hintEl.className = 'hotseat-resume-hint';
        hintEl.textContent = hint;
        container.appendChild(hintEl);

        const hotseatButton = document.createElement('button');
        hotseatButton.type = 'button';
        hotseatButton.className = 'btn btn-primary hotseat-resume-main';
        hotseatButton.textContent = 'Continue Hotseat';
        hotseatButton.addEventListener('click', onHotseat);
        container.appendChild(hotseatButton);

        const playerList = document.createElement('div');
        playerList.className = 'hotseat-player-options';

        const playerLabel = document.createElement('p');
        playerLabel.className = 'hotseat-resume-hint';
        playerLabel.textContent = 'Continue online as:';
        playerList.appendChild(playerLabel);

        players.forEach(player => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'btn btn-secondary btn-sm hotseat-player-option';
            button.textContent = player.label;
            button.addEventListener('click', player.onClick);
            playerList.appendChild(button);
        });

        container.appendChild(playerList);
    }

    // Getting back into a started room without a saved token: ask, then wait for
    // a signed-in player to approve. The token only reaches this browser, which
    // holds the request's secret.
    const REJOIN_POLL_MS = 3000;

    async function requestRoomRejoin(container, inviteCode, room, member, onBack) {
        const code = normalizeInviteCode(inviteCode);
        renderRejoinStatus(container, { title: 'Sending request…' });

        let request;
        try {
            request = await apiFetch(`/rooms/by-code/${code}/rejoin-requests`, {
                method: 'POST',
                body: JSON.stringify(member ? { member_id: member.id } : {})
            });
        } catch (error) {
            renderRejoinStatus(container, { title: 'Could not send the request', hint: error.message, actionLabel: 'Back', onAction: onBack });
            return;
        }

        let stopped = false;
        const stop = () => { stopped = true; };
        window.addEventListener('pagehide', stop, { once: true });

        renderRejoinStatus(container, {
            title: 'Waiting for approval',
            hint: rejoinApproverHint(room, member),
            waiting: true,
            actionLabel: 'Cancel',
            onAction: async () => {
                stop();
                try {
                    await apiFetch(`/rooms/rejoin-requests/${request.request_id}/cancel`, {
                        method: 'POST',
                        body: JSON.stringify({ secret: request.secret })
                    });
                } catch {}
                onBack();
            }
        });

        while (!stopped) {
            await new Promise(resolve => setTimeout(resolve, REJOIN_POLL_MS));
            if (stopped) return;
            let result;
            try {
                result = await apiFetch(`/rooms/rejoin-requests/${request.request_id}/collect`, {
                    method: 'POST',
                    body: JSON.stringify({ secret: request.secret })
                });
            } catch (error) {
                if (error.status === 404) result = { status: 'expired' };
                else continue; // network trouble: keep waiting
            }
            if (result.status === 'pending') continue;
            stop();
            if (result.status === 'approved') {
                finishRoomRejoin(result);
                return;
            }
            renderRejoinStatus(container, {
                title: result.status === 'denied' ? 'Request declined' : 'Request expired',
                hint: result.status === 'denied'
                    ? 'A player in this game said no. Ask them, then try again.'
                    : 'Nobody answered in time, or a newer request replaced this one.',
                actionLabel: 'Back',
                onAction: onBack
            });
            return;
        }
    }

    function rejoinApproverHint(room, member) {
        const members = room.room_members || [];
        const host = members.find(item => item.user_id === room.host_id);
        const hostName = host?.player_name || 'the host';
        if (!member) return `Ask ${hostName} (the host) to approve this on their screen.`;
        if (member.user_id === room.host_id) {
            return `Ask another player in this game to approve this on their screen. You will continue as ${member.player_name}.`;
        }
        return `Ask ${hostName} (the host) to approve this on their screen. You will continue as ${member.player_name}.`;
    }

    function finishRoomRejoin(result) {
        if (Array.isArray(result.tokens)) {
            if (result.tokens.length === 0) throw new Error('No players found for hotseat resume');
            setHotseatSession(result.tokens);
            saveHotseatResume(result.room, result.tokens);
        } else {
            setToken(result.token);
            clearHotseatSession();
        }
        navigateToRoom(result.room);
    }

    function renderRejoinStatus(container, { title, hint, waiting, actionLabel, onAction }) {
        container.innerHTML = '';
        container.style.display = 'block';

        const titleEl = document.createElement('h4');
        titleEl.textContent = title;
        container.appendChild(titleEl);

        if (hint) {
            const hintEl = document.createElement('p');
            hintEl.className = 'hotseat-resume-hint';
            hintEl.textContent = hint;
            container.appendChild(hintEl);
        }
        if (waiting) {
            const status = document.createElement('p');
            status.className = 'hotseat-resume-hint rejoin-waiting';
            status.setAttribute('role', 'status');
            status.textContent = 'Keep this page open. It continues as soon as they approve.';
            container.appendChild(status);
        }
        if (actionLabel) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'btn btn-secondary btn-sm';
            button.textContent = actionLabel;
            button.addEventListener('click', onAction);
            container.appendChild(button);
        }
    }

    global.RoomResume = { showSavedHotseat, showExistingMembers };
})(window);
