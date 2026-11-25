const MAX_HOTSEAT_PLAYERS = 6;

function addPlayerField() {
    const playerNumber = document.querySelectorAll('.player-name-input').length + 1;
    if (playerNumber > MAX_HOTSEAT_PLAYERS) return;

    const container = document.getElementById('player-name-fields');
    const div = document.createElement('div');
    div.className = 'form-group';
    div.innerHTML = `
        <label>Player ${playerNumber}</label>
        <input type="text" class="player-name-input" maxlength="20" autocomplete="off"
               aria-label="Player ${playerNumber}">
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
    btn.textContent = 'Starting…';

    // The players' tokens stay in this tab's hotseat session (api.js), so the
    // browser's own sign-in is never replaced.
    try {
        const tokenRecords = [];
        for (const name of names) {
            const data = await createGuestUser();
            tokenRecords.push({ userId: data.user.id, token: data.token, name });
        }

        setHotseatSession(tokenRecords, null);

        const room = await createNewRoom(`${names[0]}'s Local Game`, names.length, names[0]);
        const roomId = room.id;

        // Server-authoritative actions need every local player joined with their own token.
        for (let i = 1; i < tokenRecords.length; i++) {
            setHotseatActiveToken(tokenRecords[i].token);
            await joinRoom(roomId, tokenRecords[i].name);
        }
        setHotseatActiveToken(tokenRecords[0].token);

        await startGame(roomId);

        setHotseatSession(tokenRecords, roomId);
        saveHotseatResume(room, tokenRecords);

        navigateToGameRoom(roomId);

    } catch (err) {
        console.error('Hotseat setup error:', err);
        clearHotseatSession();
        errorEl.textContent = "Couldn't start the game. Try again.";
        btn.disabled = false;
        btn.textContent = 'Start game';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('add-player-btn').addEventListener('click', addPlayerField);
    document.getElementById('start-hotseat-btn').addEventListener('click', startHotseatGame);
    // Enter in a name field starts the game; elsewhere it does what it normally does.
    document.getElementById('player-name-fields').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target.classList.contains('player-name-input')) startHotseatGame();
    });
});
