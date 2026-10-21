// install.html: the Home Screen handoff for turn alerts.
//
// The game page sends iPhone players here with a one-time transfer code
// (install.html?code=CODE). In Safari this page only shows the "Add to Home
// Screen" steps; iOS uses this address, code included, as the new app's start
// page. In the installed app (separate storage, so signed out) the code signs
// the player in, then the game opens. Later launches are already signed in.
(function () {
    'use strict';

    const code = new URLSearchParams(window.location.search).get('code') || '';
    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

    async function openActiveGame() {
        const rooms = await getUserRooms();
        const activeRoom = rooms.find(room => room.status === 'in_progress') || rooms.find(room => room.status === 'waiting');
        if (activeRoom) navigateToRoom(activeRoom);
        else window.location.href = 'lobby.html';
    }

    function showError(message) {
        const error = document.getElementById('install-error');
        error.textContent = message;
        error.hidden = false;
        document.getElementById('install-fallback').hidden = false;
    }

    async function launch() {
        document.getElementById('install-launch').hidden = false;
        let user = null;
        try {
            user = await getCurrentUser();
        } catch (error) {
            showError(error.message);
            return;
        }
        if (!user) {
            try {
                await redeemDeviceTransferCode(code);
            } catch {
                showError('This install link has expired. In Safari, open your game, tap Alerts, and add it to the Home Screen again. Or sign in from the home page.');
                return;
            }
        }
        await openActiveGame();
    }

    document.addEventListener('DOMContentLoaded', () => {
        if (standalone) launch();
        else document.getElementById('install-steps').hidden = false;
    });
})();
