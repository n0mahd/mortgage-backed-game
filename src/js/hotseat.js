const MAX_HOTSEAT_PLAYERS = 6;

function addPlayerField() {
    const playerNumber = document.querySelectorAll('.player-name-input').length + 1;
    if (playerNumber > MAX_HOTSEAT_PLAYERS) return;

    const container = document.getElementById('player-name-fields');
    const div = document.createElement('div');
    div.className = 'form-group';
    div.innerHTML = `
        <label>Player ${playerNumber}</label>
        <input type="text" class="player-name-input"
               placeholder="Player ${playerNumber} name" maxlength="20">
    `;
    container.appendChild(div);

    if (playerNumber >= MAX_HOTSEAT_PLAYERS) {
        document.getElementById('add-player-btn').disabled = true;
    }
}

async function startHotseatGame() {
    const errorEl = document.getElementById('hotseat-error');
    const btn = document.getElementById('start-hotseat-btn');
    errorEl.textContent = '';

    const inputs = document.querySelectorAll('.player-name-input');
    const names = Array.from(inputs)
        .map(i => i.value.trim())
        .filter(n => n.length > 0);

    if (names.length < 2) {
        errorEl.textContent = 'Enter at least 2 player names.';
        return;
    }

    const uniqueNames = new Set(names.map(n => n.toLowerCase()));
    if (uniqueNames.size !== names.length) {
        errorEl.textContent = 'Each player must have a unique name.';
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Setting up game…';

    try {
        const tokenRecords = [];
        for (const name of names) {
            const data = await apiFetch('/auth/anonymous', { method: 'POST' });
            tokenRecords.push({ userId: data.user.id, token: data.token, name });
        }

        localStorage.setItem('auth_token', tokenRecords[0].token);

        const room = await apiFetch('/rooms', {
            method: 'POST',
            body: JSON.stringify({
                name: `${names[0]}'s Local Game`,
                player_name: names[0],
                max_players: names.length
            })
        });
        const roomId = room.id;

        // Server-authoritative actions need every local player joined with their own token.
        for (let i = 1; i < tokenRecords.length; i++) {
            localStorage.setItem('auth_token', tokenRecords[i].token);
            await apiFetch(`/rooms/${roomId}/join`, {
                method: 'POST',
                body: JSON.stringify({ player_name: tokenRecords[i].name })
            });
        }
        localStorage.setItem('auth_token', tokenRecords[0].token);

        await startGame(roomId);

        sessionStorage.setItem('hotseat_tokens', JSON.stringify(tokenRecords));
        saveHotseatResume(room, tokenRecords);

        window.location.href = `game.html?room=${roomId}`;

    } catch (err) {
        console.error('Hotseat setup error:', err);
        errorEl.textContent = 'Setup failed: ' + err.message;
        btn.disabled = false;
        btn.textContent = 'Start Local Game';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('add-player-btn').addEventListener('click', addPlayerField);
    document.getElementById('start-hotseat-btn').addEventListener('click', startHotseatGame);
    document.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') startHotseatGame();
    });
});
