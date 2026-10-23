'use strict';

// The engine and the player-facing catalog list the same actions. An engine
// action with no catalog entry is invisible to the UI, agents and reviewers,
// which is how a one-sided `trade` action survived unnoticed.

const { ACTION_TYPES } = require('../../domain/gameRules');
const { ACTIONS: CATALOG } = require('../../domain/actionCatalog');

describe('action catalog', () => {
    test('every engine action is in the catalog, and nothing else is', () => {
        const catalogTypes = [...new Set(CATALOG.map(action => action.type))].sort();
        expect([...ACTION_TYPES].sort()).toEqual(catalogTypes);
    });

    test('the one-sided trade action is gone', () => {
        expect(ACTION_TYPES).not.toContain('trade');
    });
});
