'use strict';

const {
    buildGameActionAuditRecord,
    logGameActionAudit,
} = require('../../services/audit');

describe('game action audit logging', () => {
    test('builds a structured audit record with version transition metadata', () => {
        const record = buildGameActionAuditRecord({
            game: { id: 'game-1', room_id: 'room-1', state_version: 2 },
            updatedGame: { id: 'game-1', room_id: 'room-1', state_version: 3, game_state: JSON.stringify({ ended: false }) },
            actorUserId: 'user-1',
            actionId: 'action-1',
            actionType: 'end_turn',
            events: [{ type: 'turn_end' }],
        });

        expect(record).toEqual(expect.objectContaining({
            event: 'game_action',
            gameId: 'game-1',
            roomId: 'room-1',
            actorUserId: 'user-1',
            actionId: 'action-1',
            actionType: 'end_turn',
            oldVersion: 2,
            newVersion: 3,
            eventCount: 1,
            ended: false,
        }));
        expect(record.createdAt).toEqual(expect.any(String));
    });

    test('logs only when action audit logging is enabled', () => {
        const spy = jest.spyOn(console, 'info').mockImplementation(() => {});
        const record = {
            event: 'game_action',
            gameId: 'game-1',
            roomId: 'room-1',
            actionType: 'end_turn',
        };

        logGameActionAudit(record, { actionAuditLogEnabled: false });
        expect(spy).not.toHaveBeenCalled();

        logGameActionAudit(record, { actionAuditLogEnabled: true });
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy.mock.calls[0][0]).toContain('[game_action]');
        expect(spy.mock.calls[0][0]).toContain('"gameId":"game-1"');

        spy.mockRestore();
    });
});
