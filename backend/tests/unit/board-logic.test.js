'use strict';

// board.js still owns frontend board ownership helpers; core rules come from backend/domain/gameRules.
global.document = undefined;

const {
    calculateRent: calculateRentRule,
    shuffleDeck,
    findNearestType,
    applyCardEffect: applyCardEffectRule,
    normalizeState,
    BOARD_SQUARES,
    HOUSE_COSTS,
    CHANCE_CARDS,
    COMMUNITY_CHEST_CARDS,
} = require('../../domain/gameRules');
const {
    hasCompleteColorGroup,
    getCompleteGroupProperties,
    boardGridCell,
} = require('../../../src/js/board.js');

function calculateRent(property, gameState, diceTotal) {
    return calculateRentRule(gameState, property.id, diceTotal);
}

function applyCardEffect(card, gameState, activePlayerIndex) {
    const state = normalizeState(gameState);
    const events = [];
    applyCardEffectRule(state, state.players[activePlayerIndex], card, events);
    return {
        gameState: state,
        message: events[events.length - 1]?.data?.effect || 'Card applied',
    };
}

// ---------------------------------------------------------------------------
// Helpers for building minimal gameState objects
// ---------------------------------------------------------------------------
function makeGameState(propertiesOverride = [], playersOverride = []) {
    const players = playersOverride.length > 0 ? playersOverride : [
        { userId: 'p1', name: 'Alice', cash: 1500, position: 0, bankrupt: false, inJail: false, jailTurns: 0, doubleCount: 0, diceRolled: false, hasGetOutOfJailCard: false },
        { userId: 'p2', name: 'Bob',   cash: 1500, position: 0, bankrupt: false, inJail: false, jailTurns: 0, doubleCount: 0, diceRolled: false, hasGetOutOfJailCard: false },
    ];
    return {
        currentPlayerIndex: 0,
        players,
        properties: propertiesOverride,
        corporations: [],
        lastDiceRoll: null,
        lastCardDrawn: null,
        settings: { passGoAmount: 200, startingCash: 1500 },
    };
}

// Minimal property factory
function makeProp(overrides) {
    return {
        id: 'prop-0', name: 'Mediterranean Ave', color: 'Brown', price: 60,
        rent: [2, 10, 30, 90, 160, 250], ownerId: null, ownerName: null, houses: 0,
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// calculateRent
// ---------------------------------------------------------------------------
describe('calculateRent', () => {
    describe('regular properties', () => {
        test('base rent on unimproved single property (no monopoly)', () => {
            const prop = makeProp({ id: 'prop-0', color: 'Brown', ownerId: 'p1', rent: [2, 10, 30, 90, 160, 250], houses: 0 });
            const gs = makeGameState([
                prop,
                makeProp({ id: 'prop-1', color: 'Brown', ownerId: 'p2', rent: [4, 20, 60, 180, 320, 450] }),
            ]);
            expect(calculateRent(prop, gs, 7)).toBe(2);
        });

        test('monopoly (all same color owned) doubles base rent', () => {
            const props = [
                makeProp({ id: 'prop-0', color: 'Brown', ownerId: 'p1', rent: [2, 10, 30, 90, 160, 250], houses: 0 }),
                makeProp({ id: 'prop-1', color: 'Brown', ownerId: 'p1', rent: [4, 20, 60, 180, 320, 450], houses: 0 }),
            ];
            const gs = makeGameState(props);
            expect(calculateRent(props[0], gs, 7)).toBe(4);
        });

        test('house level 1 rent (rent[1])', () => {
            const prop = makeProp({ id: 'prop-0', color: 'Brown', ownerId: 'p1', rent: [2, 10, 30, 90, 160, 250], houses: 1 });
            const gs = makeGameState([prop]);
            expect(calculateRent(prop, gs, 7)).toBe(10);
        });

        test('house level 2 rent (rent[2])', () => {
            const prop = makeProp({ id: 'prop-0', color: 'Brown', ownerId: 'p1', rent: [2, 10, 30, 90, 160, 250], houses: 2 });
            const gs = makeGameState([prop]);
            expect(calculateRent(prop, gs, 7)).toBe(30);
        });

        test('house level 3 rent (rent[3])', () => {
            const prop = makeProp({ id: 'prop-0', color: 'Brown', ownerId: 'p1', rent: [2, 10, 30, 90, 160, 250], houses: 3 });
            const gs = makeGameState([prop]);
            expect(calculateRent(prop, gs, 7)).toBe(90);
        });

        test('house level 4 rent (rent[4])', () => {
            const prop = makeProp({ id: 'prop-0', color: 'Brown', ownerId: 'p1', rent: [2, 10, 30, 90, 160, 250], houses: 4 });
            const gs = makeGameState([prop]);
            expect(calculateRent(prop, gs, 7)).toBe(160);
        });

        test('hotel (level 5) rent (rent[5])', () => {
            const prop = makeProp({ id: 'prop-0', color: 'Brown', ownerId: 'p1', rent: [2, 10, 30, 90, 160, 250], houses: 5 });
            const gs = makeGameState([prop]);
            expect(calculateRent(prop, gs, 7)).toBe(250);
        });
    });

    describe('railroads', () => {
        function makeRR(id, ownerId) {
            return { id, name: `Railroad ${id}`, color: 'Railroad', price: 200, rent: [25, 50, 100, 200], ownerId, ownerName: null, houses: 0 };
        }

        test('1 railroad owned → $25', () => {
            const rr = makeRR('rr-1', 'p1');
            const gs = makeGameState([rr, makeRR('rr-2', null), makeRR('rr-3', null), makeRR('rr-4', null)]);
            expect(calculateRent(rr, gs, 7)).toBe(25);
        });

        test('2 railroads owned → $50', () => {
            const rr1 = makeRR('rr-1', 'p1');
            const rr2 = makeRR('rr-2', 'p1');
            const gs = makeGameState([rr1, rr2, makeRR('rr-3', null)]);
            expect(calculateRent(rr1, gs, 7)).toBe(50);
        });

        test('3 railroads owned → $100', () => {
            const rrs = ['rr-1', 'rr-2', 'rr-3'].map(id => makeRR(id, 'p1'));
            const gs = makeGameState([...rrs, makeRR('rr-4', null)]);
            expect(calculateRent(rrs[0], gs, 7)).toBe(100);
        });

        test('4 railroads owned → $200', () => {
            const rrs = ['rr-1', 'rr-2', 'rr-3', 'rr-4'].map(id => makeRR(id, 'p1'));
            const gs = makeGameState(rrs);
            expect(calculateRent(rrs[0], gs, 7)).toBe(200);
        });
    });

    describe('utilities', () => {
        function makeUtil(id, ownerId) {
            return { id, name: `Utility ${id}`, color: 'Utility', price: 150, rent: [], ownerId, ownerName: null, houses: 0 };
        }

        test('1 utility owned → dice × 4', () => {
            const u = makeUtil('u-1', 'p1');
            const gs = makeGameState([u, makeUtil('u-2', null)]);
            expect(calculateRent(u, gs, 7)).toBe(28); // 7 * 4
        });

        test('2 utilities owned → dice × 10', () => {
            const u1 = makeUtil('u-1', 'p1');
            const u2 = makeUtil('u-2', 'p1');
            const gs = makeGameState([u1, u2]);
            expect(calculateRent(u1, gs, 7)).toBe(70); // 7 * 10
        });
    });
});

// ---------------------------------------------------------------------------
// hasCompleteColorGroup
// ---------------------------------------------------------------------------
describe('hasCompleteColorGroup', () => {
    test('returns true when player owns all browns (2 props)', () => {
        const gs = makeGameState([
            makeProp({ id: 'p0', color: 'Brown', ownerId: 'p1' }),
            makeProp({ id: 'p1', color: 'Brown', ownerId: 'p1' }),
        ]);
        expect(hasCompleteColorGroup('p1', gs)).toBe(true);
    });

    test('returns false when missing one property from group', () => {
        const gs = makeGameState([
            makeProp({ id: 'p0', color: 'Brown', ownerId: 'p1' }),
            makeProp({ id: 'p1', color: 'Brown', ownerId: 'p2' }),
        ]);
        expect(hasCompleteColorGroup('p1', gs)).toBe(false);
    });

    test('returns false for empty properties list', () => {
        const gs = makeGameState([]);
        expect(hasCompleteColorGroup('p1', gs)).toBe(false);
    });

    test('returns false when all properties owned by different player', () => {
        const gs = makeGameState([
            makeProp({ id: 'p0', color: 'Brown', ownerId: 'p2' }),
            makeProp({ id: 'p1', color: 'Brown', ownerId: 'p2' }),
        ]);
        expect(hasCompleteColorGroup('p1', gs)).toBe(false);
    });

    test('returns true for dark blue group (2 props)', () => {
        const gs = makeGameState([
            makeProp({ id: 'p0', color: 'Dark Blue', ownerId: 'p1' }),
            makeProp({ id: 'p1', color: 'Dark Blue', ownerId: 'p1' }),
        ]);
        expect(hasCompleteColorGroup('p1', gs)).toBe(true);
    });

    test('returns true for 3-property orange group', () => {
        const gs = makeGameState([
            makeProp({ id: 'p0', color: 'Orange', ownerId: 'p1' }),
            makeProp({ id: 'p1', color: 'Orange', ownerId: 'p1' }),
            makeProp({ id: 'p2', color: 'Orange', ownerId: 'p1' }),
        ]);
        expect(hasCompleteColorGroup('p1', gs)).toBe(true);
    });

    test('railroads excluded from color group check', () => {
        const gs = makeGameState([
            { id: 'rr1', color: 'Railroad', ownerId: 'p1', rent: [25, 50, 100, 200], houses: 0 },
            { id: 'rr2', color: 'Railroad', ownerId: 'p1', rent: [25, 50, 100, 200], houses: 0 },
        ]);
        // railroads are excluded (color !== 'Railroad' check)
        expect(hasCompleteColorGroup('p1', gs)).toBe(false);
    });

    test('player with multiple groups returns true', () => {
        const gs = makeGameState([
            makeProp({ id: 'p0', color: 'Brown', ownerId: 'p1' }),
            makeProp({ id: 'p1', color: 'Brown', ownerId: 'p1' }),
            makeProp({ id: 'p2', color: 'Orange', ownerId: 'p2' }), // different owner
        ]);
        expect(hasCompleteColorGroup('p1', gs)).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// getCompleteGroupProperties
// ---------------------------------------------------------------------------
describe('getCompleteGroupProperties', () => {
    test('returns correct properties for complete group', () => {
        const props = [
            makeProp({ id: 'p0', color: 'Brown', ownerId: 'p1' }),
            makeProp({ id: 'p1', color: 'Brown', ownerId: 'p1' }),
        ];
        const gs = makeGameState(props);
        const result = getCompleteGroupProperties('p1', gs);
        expect(result).toHaveLength(2);
        expect(result.map(p => p.id).sort()).toEqual(['p0', 'p1'].sort());
    });

    test('returns empty array for incomplete group', () => {
        const gs = makeGameState([
            makeProp({ id: 'p0', color: 'Brown', ownerId: 'p1' }),
            makeProp({ id: 'p1', color: 'Brown', ownerId: 'p2' }),
        ]);
        expect(getCompleteGroupProperties('p1', gs)).toHaveLength(0);
    });

    test('returns properties from multiple complete groups', () => {
        const gs = makeGameState([
            makeProp({ id: 'b0', color: 'Brown', ownerId: 'p1' }),
            makeProp({ id: 'b1', color: 'Brown', ownerId: 'p1' }),
            makeProp({ id: 'o0', color: 'Orange', ownerId: 'p1' }),
            makeProp({ id: 'o1', color: 'Orange', ownerId: 'p1' }),
            makeProp({ id: 'o2', color: 'Orange', ownerId: 'p1' }),
        ]);
        const result = getCompleteGroupProperties('p1', gs);
        expect(result).toHaveLength(5);
    });

    test('excludes properties owned by other players', () => {
        const gs = makeGameState([
            makeProp({ id: 'b0', color: 'Brown', ownerId: 'p1' }),
            makeProp({ id: 'b1', color: 'Brown', ownerId: 'p2' }),
            makeProp({ id: 'o0', color: 'Orange', ownerId: 'p1' }),
            makeProp({ id: 'o1', color: 'Orange', ownerId: 'p1' }),
            makeProp({ id: 'o2', color: 'Orange', ownerId: 'p1' }),
        ]);
        const result = getCompleteGroupProperties('p1', gs);
        expect(result.map(p => p.id).sort()).toEqual(['o0', 'o1', 'o2'].sort());
    });

    test('returns empty array when player has no properties', () => {
        const gs = makeGameState([
            makeProp({ id: 'b0', color: 'Brown', ownerId: 'p2' }),
        ]);
        expect(getCompleteGroupProperties('p1', gs)).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// shuffleDeck
// ---------------------------------------------------------------------------
describe('shuffleDeck', () => {
    test('returns array of same length', () => {
        const deck = [1, 2, 3, 4, 5];
        expect(shuffleDeck(deck)).toHaveLength(5);
    });

    test('contains same elements (sorted comparison)', () => {
        const deck = [1, 2, 3, 4, 5, 6, 7, 8];
        const shuffled = shuffleDeck(deck);
        expect(shuffled.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    });

    test('does not mutate original array', () => {
        const deck = [1, 2, 3, 4, 5];
        const copy = [...deck];
        shuffleDeck(deck);
        expect(deck).toEqual(copy);
    });

    test('statistical: shuffled array is different from original at least once in 10 tries', () => {
        const deck = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
        const original = JSON.stringify(deck);
        // With 16 elements, probability of same order is 1/16! ≈ 0
        let anyDifferent = false;
        for (let i = 0; i < 10; i++) {
            if (JSON.stringify(shuffleDeck(deck)) !== original) {
                anyDifferent = true;
                break;
            }
        }
        expect(anyDifferent).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// findNearestType
// ---------------------------------------------------------------------------
describe('findNearestType', () => {
    test('from position 0, nearest railroad = 5', () => {
        expect(findNearestType(0, 'railroad')).toBe(5);
    });

    test('from position 6, nearest railroad = 15', () => {
        expect(findNearestType(6, 'railroad')).toBe(15);
    });

    test('from position 16, nearest railroad = 25', () => {
        expect(findNearestType(16, 'railroad')).toBe(25);
    });

    test('from position 26, nearest railroad = 35', () => {
        expect(findNearestType(26, 'railroad')).toBe(35);
    });

    test('from position 36, nearest railroad wraps to 5', () => {
        expect(findNearestType(36, 'railroad')).toBe(5);
    });

    test('from position 0, nearest utility = 12', () => {
        expect(findNearestType(0, 'utility')).toBe(12);
    });

    test('from position 13, nearest utility = 28', () => {
        expect(findNearestType(13, 'utility')).toBe(28);
    });

    test('from position 29, nearest utility wraps to 12', () => {
        expect(findNearestType(29, 'utility')).toBe(12);
    });
});

// ---------------------------------------------------------------------------
// applyCardEffect
// ---------------------------------------------------------------------------
describe('applyCardEffect', () => {
    function baseGs(overrides = {}) {
        return makeGameState(
            overrides.properties || [],
            overrides.players || [
                { userId: 'p1', name: 'Alice', cash: 1500, position: 10, bankrupt: false, inJail: false, jailTurns: 0, doubleCount: 0, diceRolled: false, hasGetOutOfJailCard: false },
                { userId: 'p2', name: 'Bob',   cash: 1500, position: 5,  bankrupt: false, inJail: false, jailTurns: 0, doubleCount: 0, diceRolled: false, hasGetOutOfJailCard: false },
                { userId: 'p3', name: 'Carol', cash: 1500, position: 15, bankrupt: false, inJail: false, jailTurns: 0, doubleCount: 0, diceRolled: false, hasGetOutOfJailCard: false },
            ]
        );
    }

    test('advance_to: player moves to specified position', () => {
        const gs = baseGs();
        const card = { action: { type: 'advance_to', position: 24 } };
        const { gameState } = applyCardEffect(card, gs, 0);
        expect(gameState.players[0].position).toBe(24);
    });

    test('advance_to passing GO: player collects $200', () => {
        // Player at position 30, advancing to position 5 (passes GO)
        const gs = baseGs({ players: [
            { userId: 'p1', name: 'Alice', cash: 1000, position: 30, bankrupt: false, inJail: false, jailTurns: 0, doubleCount: 0, diceRolled: false },
            { userId: 'p2', name: 'Bob', cash: 1500, position: 0, bankrupt: false, inJail: false, jailTurns: 0, doubleCount: 0, diceRolled: false },
        ]});
        const card = { action: { type: 'advance_to', position: 5 } };
        const { gameState } = applyCardEffect(card, gs, 0);
        expect(gameState.players[0].cash).toBe(1200);
    });

    test('advance_to not passing GO: no $200 collected', () => {
        // Player at position 3, advancing to position 24 (no GO crossing)
        const gs = baseGs({ players: [
            { userId: 'p1', name: 'Alice', cash: 1000, position: 3, bankrupt: false, inJail: false, jailTurns: 0, doubleCount: 0, diceRolled: false },
        ]});
        const card = { action: { type: 'advance_to', position: 24 } };
        const { gameState } = applyCardEffect(card, gs, 0);
        expect(gameState.players[0].cash).toBe(1000);
    });

    test('advance_nearest railroad: moves to correct railroad', () => {
        // Player at position 0, nearest railroad is 5
        const gs = baseGs({ players: [
            { userId: 'p1', name: 'Alice', cash: 1500, position: 0, bankrupt: false, inJail: false, jailTurns: 0, doubleCount: 0, diceRolled: false },
        ]});
        const card = { action: { type: 'advance_nearest', nearestType: 'railroad' } };
        const { gameState } = applyCardEffect(card, gs, 0);
        expect(gameState.players[0].position).toBe(5);
    });

    test('go_to_jail: player position set to 10, inJail = true', () => {
        const gs = baseGs();
        const card = { action: { type: 'go_to_jail' } };
        const { gameState } = applyCardEffect(card, gs, 0);
        expect(gameState.players[0].position).toBe(10);
        expect(gameState.players[0].inJail).toBe(true);
    });

    test('back_3: player moves back 3 squares', () => {
        const gs = baseGs({ players: [
            { userId: 'p1', name: 'Alice', cash: 1500, position: 14, bankrupt: false, inJail: false, jailTurns: 0, doubleCount: 0, diceRolled: false },
        ]});
        const card = { action: { type: 'back_3' } };
        const { gameState } = applyCardEffect(card, gs, 0);
        expect(gameState.players[0].position).toBe(11);
    });

    test('back_3 wraps from position 2 → position 39', () => {
        const gs = baseGs({ players: [
            { userId: 'p1', name: 'Alice', cash: 1500, position: 2, bankrupt: false, inJail: false, jailTurns: 0, doubleCount: 0, diceRolled: false },
        ]});
        const card = { action: { type: 'back_3' } };
        const { gameState } = applyCardEffect(card, gs, 0);
        expect(gameState.players[0].position).toBe(39);
    });

    test('collect: adds amount to player cash', () => {
        const gs = baseGs();
        const card = { action: { type: 'collect', amount: 150 } };
        const { gameState } = applyCardEffect(card, gs, 0);
        expect(gameState.players[0].cash).toBe(1650);
    });

    test('pay: subtracts amount from player cash', () => {
        const gs = baseGs();
        const card = { action: { type: 'pay', amount: 50 } };
        const { gameState } = applyCardEffect(card, gs, 0);
        expect(gameState.players[0].cash).toBe(1450);
    });

    test('collect_from_each: collects from all non-bankrupt players', () => {
        const gs = baseGs();
        const card = { action: { type: 'collect_from_each', amount: 50 } };
        const { gameState } = applyCardEffect(card, gs, 0);
        // Alice collects 50 from Bob and Carol (2 players) = 100
        expect(gameState.players[0].cash).toBe(1600);
        expect(gameState.players[1].cash).toBe(1450);
        expect(gameState.players[2].cash).toBe(1450);
    });

    test('pay_to_each: pays all non-bankrupt players', () => {
        const gs = baseGs();
        const card = { action: { type: 'pay_to_each', amount: 50 } };
        const { gameState } = applyCardEffect(card, gs, 0);
        // Alice pays 50 to Bob and Carol = -100
        expect(gameState.players[0].cash).toBe(1400);
        expect(gameState.players[1].cash).toBe(1550);
        expect(gameState.players[2].cash).toBe(1550);
    });

    test('collect_from_each: skips bankrupt players', () => {
        const gs = baseGs({ players: [
            { userId: 'p1', name: 'Alice', cash: 1500, position: 0, bankrupt: false, inJail: false, jailTurns: 0, doubleCount: 0, diceRolled: false },
            { userId: 'p2', name: 'Bob',   cash: 1500, position: 0, bankrupt: true,  inJail: false, jailTurns: 0, doubleCount: 0, diceRolled: false },
            { userId: 'p3', name: 'Carol', cash: 1500, position: 0, bankrupt: false, inJail: false, jailTurns: 0, doubleCount: 0, diceRolled: false },
        ]});
        const card = { action: { type: 'collect_from_each', amount: 50 } };
        const { gameState } = applyCardEffect(card, gs, 0);
        // Bob is bankrupt, so only Carol pays
        expect(gameState.players[0].cash).toBe(1550);
        expect(gameState.players[1].cash).toBe(1500); // unchanged (bankrupt)
    });

    test('repairs: charges perHouse × houses + perHotel × hotels', () => {
        const props = [
            makeProp({ id: 'p0', color: 'Brown', ownerId: 'p1', houses: 2 }),
            makeProp({ id: 'p1', color: 'Brown', ownerId: 'p1', houses: 5 }), // hotel
        ];
        const gs = baseGs({ players: [
            { userId: 'p1', name: 'Alice', cash: 1500, position: 0, bankrupt: false, inJail: false, jailTurns: 0, doubleCount: 0, diceRolled: false },
        ], properties: props });
        const card = { action: { type: 'repairs', perHouse: 25, perHotel: 100 } };
        const { gameState } = applyCardEffect(card, gs, 0);
        // 2 houses @ 25 + 1 hotel @ 100 = 150
        expect(gameState.players[0].cash).toBe(1350);
    });

    test('repairs with no houses: no charge', () => {
        const props = [
            makeProp({ id: 'p0', color: 'Brown', ownerId: 'p1', houses: 0 }),
        ];
        const gs = baseGs({ players: [
            { userId: 'p1', name: 'Alice', cash: 1500, position: 0, bankrupt: false, inJail: false, jailTurns: 0, doubleCount: 0, diceRolled: false },
        ], properties: props });
        const card = { action: { type: 'repairs', perHouse: 25, perHotel: 100 } };
        const { gameState } = applyCardEffect(card, gs, 0);
        expect(gameState.players[0].cash).toBe(1500);
    });

    test('get_out_of_jail: sets hasGetOutOfJailCard on player', () => {
        const gs = baseGs();
        const card = { action: { type: 'get_out_of_jail' } };
        const { gameState } = applyCardEffect(card, gs, 0);
        expect(gameState.players[0].hasGetOutOfJailCard).toBe(true);
    });

    test('returns descriptive message string', () => {
        const gs = baseGs();
        const card = { action: { type: 'collect', amount: 50 } };
        const { message } = applyCardEffect(card, gs, 0);
        expect(typeof message).toBe('string');
        expect(message.length).toBeGreaterThan(0);
    });

    test('does not modify other players state for single-player effects', () => {
        const gs = baseGs();
        const card = { action: { type: 'collect', amount: 50 } };
        const { gameState } = applyCardEffect(card, gs, 0);
        expect(gameState.players[1].cash).toBe(1500);
        expect(gameState.players[2].cash).toBe(1500);
    });

    test('advance_nearest passing GO: collects $200', () => {
        // Player at position 38, nearest railroad is 5 (wraps around, passes GO)
        const gs = baseGs({ players: [
            { userId: 'p1', name: 'Alice', cash: 1000, position: 38, bankrupt: false, inJail: false, jailTurns: 0, doubleCount: 0, diceRolled: false },
        ]});
        const card = { action: { type: 'advance_nearest', nearestType: 'railroad' } };
        const { gameState } = applyCardEffect(card, gs, 0);
        // nearest railroad from 38 wraps to 5
        expect(gameState.players[0].position).toBe(5);
        expect(gameState.players[0].cash).toBe(1200); // collected 200 passing GO
    });
});

// ---------------------------------------------------------------------------
// BOARD_SQUARES & constants
// ---------------------------------------------------------------------------
describe('BOARD_SQUARES', () => {
    test('board has exactly 40 squares', () => {
        expect(BOARD_SQUARES).toHaveLength(40);
    });

    test('each square has required fields', () => {
        for (const sq of BOARD_SQUARES) {
            expect(sq).toHaveProperty('position');
            expect(sq).toHaveProperty('name');
            expect(sq).toHaveProperty('type');
        }
    });

    test('positions are 0..39 in order', () => {
        for (let i = 0; i < 40; i++) {
            expect(BOARD_SQUARES[i].position).toBe(i);
        }
    });

    test('position 0 is GO', () => {
        expect(BOARD_SQUARES[0].type).toBe('go');
    });

    test('position 10 is jail', () => {
        expect(BOARD_SQUARES[10].type).toBe('jail');
    });

    test('position 30 is go_to_jail', () => {
        expect(BOARD_SQUARES[30].type).toBe('go_to_jail');
    });
});

describe('HOUSE_COSTS', () => {
    test('has entry for each color group', () => {
        const expected = ['Brown', 'Light Blue', 'Pink', 'Orange', 'Red', 'Yellow', 'Green', 'Dark Blue'];
        for (const color of expected) {
            expect(HOUSE_COSTS).toHaveProperty(color);
            expect(typeof HOUSE_COSTS[color]).toBe('number');
        }
    });
});

describe('CHANCE_CARDS and COMMUNITY_CHEST_CARDS', () => {
    test('CHANCE_CARDS has 16 cards', () => {
        expect(CHANCE_CARDS).toHaveLength(16);
    });

    test('COMMUNITY_CHEST_CARDS has 16 cards', () => {
        expect(COMMUNITY_CHEST_CARDS).toHaveLength(16);
    });

    test('each card has id, text, and action fields', () => {
        for (const card of [...CHANCE_CARDS, ...COMMUNITY_CHEST_CARDS]) {
            expect(card).toHaveProperty('id');
            expect(card).toHaveProperty('text');
            expect(card).toHaveProperty('action');
            expect(card.action).toHaveProperty('type');
        }
    });
});

describe('Board tab layout', () => {
    test('the 40 squares form one clockwise loop around the edge, GO bottom-right', () => {
        expect(boardGridCell(0)).toEqual({ row: 11, col: 11 });
        expect(boardGridCell(10)).toEqual({ row: 11, col: 1 });
        expect(boardGridCell(20)).toEqual({ row: 1, col: 1 });
        expect(boardGridCell(30)).toEqual({ row: 1, col: 11 });
        const seen = new Set();
        for (let pos = 0; pos < 40; pos++) {
            const a = boardGridCell(pos);
            const b = boardGridCell((pos + 1) % 40);
            seen.add(`${a.row},${a.col}`);
            expect(a.row === 1 || a.row === 11 || a.col === 1 || a.col === 11).toBe(true);
            expect(Math.abs(a.row - b.row) + Math.abs(a.col - b.col)).toBe(1);
        }
        expect(seen.size).toBe(40);
    });
});
