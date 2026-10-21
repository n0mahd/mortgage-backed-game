function buildGameActionAuditRecord({ game, updatedGame, actorUserId, actionId, actionType, events }) {
    return {
        event: 'game_action',
        gameId: updatedGame.id,
        roomId: updatedGame.room_id,
        actorUserId,
        actionId,
        actionType,
        oldVersion: Number(game.state_version || 0),
        newVersion: Number(updatedGame.state_version || 0),
        eventCount: Array.isArray(events) ? events.length : 0,
        ended: !!JSON.parse(updatedGame.game_state).ended,
        createdAt: new Date().toISOString(),
    };
}

function logGameActionAudit(record, config) {
    if (!config?.actionAuditLogEnabled) return;
    console.info(`[game_action] ${JSON.stringify(record)}`);
}

module.exports = {
    buildGameActionAuditRecord,
    logGameActionAudit,
};
