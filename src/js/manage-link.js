// waiting.html: points the host's "Manage players" link at this room's
// Manage sheet in My games (lobby.html?manage=<roomId>).
document.querySelectorAll('[data-manage-room-link]').forEach(link => {
    const roomId = new URLSearchParams(window.location.search).get('room');
    if (roomId) link.href = `lobby.html?manage=${encodeURIComponent(roomId)}`;
    else link.hidden = true;
});
