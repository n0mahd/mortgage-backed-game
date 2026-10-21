'use strict';

const {
    MONOPOLY_PROPERTIES,
    applyAction,
    normalizeState,
    JAIL_CARD_ASSET_ID,
} = require('../../domain/gameRules');

const GO_TO_JAIL_CARD = { id: 'cc-6', text: 'Go to Jail. Do not pass GO.', action: { type: 'go_to_jail' } };
const BACK_3_CARD = { id: 'ch-8', text: 'Go Back 3 Spaces.', action: { type: 'back_3' } };

function player(userId, name, overrides = {}) {
    return {
        userId,
        name,
        cash: 1500,
        position: 0,
        bankrupt: false,
        inJail: false,
        jailTurns: 0,
        hasGetOutOfJailCard: false,
        doubleCount: 0,
        diceRolled: false,
        properties: [],
        corporations: [],
        debts: [],
        ...overrides,
    };
}

function makeState({ alice = {}, bob = {}, chanceCards = [], communityChestCards = [] } = {}) {
    return normalizeState({
        currentPlayerIndex: 0,
        players: [player('alice', 'Alice', alice), player('bob', 'Bob', bob)],
        properties: MONOPOLY_PROPERTIES.map((prop, index) => ({
            ...prop,
            id: `prop-${index}`,
            ownerId: null,
            ownerName: null,
            houses: 0,
        })),
        corporations: [],
        marketOffers: [],
        gameLog: [],
        settings: { passGoAmount: 200, startingCash: 1500, interestRate: 5 },
        chanceCards,
        communityChestCards,
        lastDiceRoll: null,
        lastCardDrawn: null,
        ended: false,
    });
}

function find(state, userId) {
    return state.players.find(p => p.userId === userId);
}

describe('going to Jail ends the turn', () => {
    test('a Go to Jail card drawn after rolling doubles ends the turn', () => {
        // Square 2 is Community Chest; doubles would normally allow another roll.
        const state = makeState({ communityChestCards: [GO_TO_JAIL_CARD] });

        const { state: after } = applyAction(state, 'alice', { type: 'roll_dice', payload: {} }, { dice: [1, 1] });
        const alice = find(after, 'alice');

        expect(alice.inJail).toBe(true);
        expect(alice.position).toBe(10);
        expect(alice.diceRolled).toBe(true);
        expect(() => applyAction(after, 'alice', { type: 'roll_dice', payload: {} }, { dice: [2, 2] }))
            .toThrow('Dice already rolled this turn');
        expect(() => applyAction(after, 'alice', { type: 'pay_jail_fine', payload: {} }))
            .toThrow('Jail choice must be made before rolling');

        const ended = applyAction(after, 'alice', { type: 'end_turn', payload: {} }).state;
        expect(ended.players[ended.currentPlayerIndex].userId).toBe('bob');
        expect(find(ended, 'alice').inJail).toBe(true);
    });

    test('Chance "Go Back 3" onto Community Chest "Go to Jail" after doubles ends the turn', () => {
        // 30 + 6 = Chance (36); back 3 lands on Community Chest (33).
        const state = makeState({
            alice: { position: 30 },
            chanceCards: [BACK_3_CARD],
            communityChestCards: [GO_TO_JAIL_CARD],
        });

        const { state: after } = applyAction(state, 'alice', { type: 'roll_dice', payload: {} }, { dice: [3, 3] });
        const alice = find(after, 'alice');

        expect(alice.inJail).toBe(true);
        expect(alice.diceRolled).toBe(true);
        const ended = applyAction(after, 'alice', { type: 'end_turn', payload: {} }).state;
        expect(ended.players[ended.currentPlayerIndex].userId).toBe('bob');
    });

    test('the jailed player gets the Jail choice on their next turn', () => {
        const state = makeState({ communityChestCards: [GO_TO_JAIL_CARD] });
        let next = applyAction(state, 'alice', { type: 'roll_dice', payload: {} }, { dice: [1, 1] }).state;
        next = applyAction(next, 'alice', { type: 'end_turn', payload: {} }).state;
        next = applyAction(next, 'bob', { type: 'roll_dice', payload: {} }, { dice: [1, 2] }).state;
        next = applyAction(next, 'bob', { type: 'end_turn', payload: {} }).state;

        const paid = applyAction(next, 'alice', { type: 'pay_jail_fine', payload: {} }).state;
        expect(find(paid, 'alice').inJail).toBe(false);
        expect(find(paid, 'alice').cash).toBe(1450);
    });
});

describe('trading a Get Out of Jail Free card', () => {
    function propose(state, actorId, terms) {
        return applyAction(state, actorId, { type: 'propose_trade', payload: terms }).state;
    }

    test('a player can sell their card to another player for cash', () => {
        const state = makeState({ alice: { hasGetOutOfJailCard: true } });
        const proposed = propose(state, 'alice', {
            player1Id: 'alice',
            player2Id: 'bob',
            player1AssetIds: [JAIL_CARD_ASSET_ID],
            player2Cash: 75,
        });
        const offer = proposed.marketOffers.find(o => o.status === 'pending');
        // Card stays with Alice until Bob accepts.
        expect(find(proposed, 'alice').hasGetOutOfJailCard).toBe(true);

        const { state: after, events } = applyAction(proposed, 'bob', { type: 'accept_trade', payload: { offerId: offer.id } });

        expect(find(after, 'alice').hasGetOutOfJailCard).toBe(false);
        expect(find(after, 'bob').hasGetOutOfJailCard).toBe(true);
        expect(find(after, 'alice').cash).toBe(1575);
        expect(find(after, 'bob').cash).toBe(1425);
        expect(events.some(e => e.type === 'trade_offer_accepted')).toBe(true);
    });

    test('the buyer can then use the card to leave Jail', () => {
        const state = makeState({
            alice: { hasGetOutOfJailCard: true },
            bob: { position: 10, inJail: true },
        });
        const proposed = propose(state, 'bob', {
            player1Id: 'alice',
            player2Id: 'bob',
            player1AssetIds: [JAIL_CARD_ASSET_ID],
            player2Cash: 40,
        });
        const offer = proposed.marketOffers.find(o => o.status === 'pending');
        let next = applyAction(proposed, 'alice', { type: 'accept_trade', payload: { offerId: offer.id } }).state;
        next = applyAction(next, 'alice', { type: 'roll_dice', payload: {} }, { dice: [1, 2] }).state;
        next = applyAction(next, 'alice', { type: 'end_turn', payload: {} }).state;

        const used = applyAction(next, 'bob', { type: 'use_get_out_of_jail_card', payload: {} }).state;
        expect(find(used, 'bob').inJail).toBe(false);
        expect(find(used, 'bob').hasGetOutOfJailCard).toBe(false);
    });

    test('a player cannot offer a card they do not hold', () => {
        const state = makeState();
        expect(() => propose(state, 'alice', {
            player1Id: 'alice',
            player2Id: 'bob',
            player1AssetIds: [JAIL_CARD_ASSET_ID],
            player2Cash: 50,
        })).toThrow('Alice has no Get Out of Jail Free card to trade');
    });

    test('an accepted offer fails if the seller used the card in the meantime', () => {
        const state = makeState({ alice: { hasGetOutOfJailCard: true, position: 10, inJail: true } });
        const proposed = propose(state, 'alice', {
            player1Id: 'alice',
            player2Id: 'bob',
            player1AssetIds: [JAIL_CARD_ASSET_ID],
            player2Cash: 50,
        });
        const offer = proposed.marketOffers.find(o => o.status === 'pending');
        const used = applyAction(proposed, 'alice', { type: 'use_get_out_of_jail_card', payload: {} }).state;

        expect(() => applyAction(used, 'bob', { type: 'accept_trade', payload: { offerId: offer.id } }))
            .toThrow('Alice has no Get Out of Jail Free card to trade');
    });

    test('a player already holding a card cannot receive another', () => {
        const state = makeState({ alice: { hasGetOutOfJailCard: true }, bob: { hasGetOutOfJailCard: true } });
        expect(() => propose(state, 'alice', {
            player1Id: 'alice',
            player2Id: 'bob',
            player1AssetIds: [JAIL_CARD_ASSET_ID],
            player2Cash: 50,
        })).toThrow('Bob already holds a Get Out of Jail Free card');
    });

    test('the card can be traded alongside property', () => {
        const state = makeState({ alice: { hasGetOutOfJailCard: true } });
        state.properties[1].ownerId = 'alice';
        state.properties[1].ownerName = 'Alice';
        const proposed = propose(state, 'alice', {
            player1Id: 'alice',
            player2Id: 'bob',
            player1AssetIds: ['prop-1', JAIL_CARD_ASSET_ID],
            player2Cash: 200,
        });
        const offer = proposed.marketOffers.find(o => o.status === 'pending');
        const after = applyAction(proposed, 'bob', { type: 'accept_trade', payload: { offerId: offer.id } }).state;

        expect(after.properties[1].ownerId).toBe('bob');
        expect(find(after, 'bob').hasGetOutOfJailCard).toBe(true);
    });
});
