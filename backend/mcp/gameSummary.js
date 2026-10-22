'use strict';

// Compact, agent-readable view of a room/game for one player. Pure
// presentation: reads state, never decides rules (legal actions come from
// domain/actionCatalog, which dry-runs the engine).

const { BOARD_SQUARES, calculateNetWorth } = require('../domain/gameRules');
const { listLegalActions } = require('../domain/actionCatalog');

// Agents read this after every action, so it stays compact: static board data
// (prices, rent tables) lives in get_rules, not here.
const RECENT_LOG_LIMIT = 8;
const EXAMPLE_LIMIT = 3;
// Names and log lines are typed by players and end up in agent context; cap them.
const NAME_MAX = 40;
const LOG_LINE_MAX = 200;

function squareSummary(position) {
    const square = BOARD_SQUARES[position] || {};
    return { position, name: square.name || null, type: square.type || null };
}

function ownerName(state, ownerId) {
    if (!ownerId) return null;
    const player = state.players.find(p => p.userId === ownerId);
    if (player) return clip(player.name);
    const corp = state.corporations.find(c => c.id === ownerId);
    return corp ? `[${corp.ticker}]` : ownerId;
}

// No invite code or join link: agents play their own seat and never invite anyone.
function summarizeRoom(room, members, userId) {
    const me = members.find(member => member.user_id === userId);
    const host = members.find(member => member.user_id === room.host_id);
    return {
        id: room.id,
        name: clip(room.name, 80),
        status: room.status,
        max_players: room.max_players,
        host: host ? clip(host.player_name) : null,
        your_name: me ? clip(me.player_name) : null,
        members: members.map(member => ({ name: clip(member.player_name), is_agent: !!member.is_agent, is_you: member.user_id === userId })),
    };
}

// Why this player should act now, or null if they are waiting on someone else.
function attentionFor(state, userId) {
    if (state.ended) return 'game_ended';
    const me = state.players.find(p => p.userId === userId);
    if (!me) return null;
    if (me.bankrupt) return 'you_are_bankrupt';
    if (state.paused) return null;
    const auction = state.auction?.status === 'open' ? state.auction : null;
    if (auction) {
        const passed = (auction.passedPlayerIds || []).includes(userId);
        return !passed && auction.highBidderId !== userId ? 'auction_needs_you' : null;
    }
    const offerForMe = (state.marketOffers || []).some(offer => offer.status === 'pending' && offer.recipientId === userId);
    if (offerForMe) return 'trade_offer_for_you';
    const current = state.players[state.currentPlayerIndex];
    if (current && current.userId === userId) return 'your_turn';
    return null;
}

function statusLine(state, userId, attention) {
    const current = state.players[state.currentPlayerIndex];
    switch (attention) {
        case 'game_ended': return 'The game has ended.';
        case 'you_are_bankrupt': return 'You are bankrupt and can no longer act.';
        case 'auction_needs_you': return `Auction open for ${state.auction.propertyName}: bid or pass.`;
        case 'trade_offer_for_you': return 'A trade offer is waiting for your answer (accept_trade or cancel_trade).';
        case 'your_turn': return 'It is your turn.';
        default:
            if (state.paused) return 'The game is paused by the host.';
            if (state.auction?.status === 'open') return `Waiting for other players to finish the auction for ${state.auction.propertyName}.`;
            return `Waiting for ${current ? clip(current.name) : 'another player'} to play.`;
    }
}

function summarizeGame({ room, members, game, userId }) {
    const roomSummary = summarizeRoom(room, members, userId);
    if (!game) {
        return {
            status: 'waiting_for_start',
            status_line: `Waiting room with ${members.length} player(s). The host starts the game from the browser; keep calling wait_for_turn.`,
            room: roomSummary,
            game: null,
        };
    }

    const state = game.game_state;
    const attention = attentionFor(state, userId);
    const me = state.players.find(p => p.userId === userId);
    const current = state.players[state.currentPlayerIndex];
    const standingOn = me ? squareSummary(me.position) : null;
    if (standingOn) {
        const squareDef = BOARD_SQUARES[me.position];
        const prop = squareDef?.propertyId ? state.properties.find(p => p.id === squareDef.propertyId) : null;
        if (prop) {
            standingOn.property = { id: prop.id, price: prop.price, owner: ownerName(state, prop.ownerId), houses: prop.houses || 0 };
        }
        if (squareDef?.taxAmount) standingOn.tax = squareDef.taxAmount;
    }

    return {
        status: attention || (state.paused ? 'paused' : 'waiting_for_others'),
        status_line: statusLine(state, userId, attention),
        state_version: game.state_version,
        room: roomSummary,
        current_turn: current ? { player: clip(current.name), player_id: current.userId, is_you: current.userId === userId } : null,
        loan_rates_percent: state.settings?.loanRates || null,
        you: me ? {
            player_id: me.userId,
            name: clip(me.name),
            cash: round(me.cash),
            net_worth: round(calculateNetWorth(state, me.userId)),
            standing_on: standingOn,
            dice_rolled_this_turn: me.diceRolled,
            doubles_this_turn: me.doubleCount,
            in_jail: me.inJail,
            jail_turns: me.jailTurns,
            has_get_out_of_jail_free_card: me.hasGetOutOfJailCard,
            bankrupt: me.bankrupt,
            properties: state.properties.filter(p => p.ownerId === me.userId).map(p => ({ id: p.id, name: p.name, color: p.color, houses: p.houses || 0 })),
            debts: (me.debts || []).map(debt => ({
                id: debt.id,
                principal: round(debt.principal),
                interest_rate_percent: debt.interestRate,
                term_turns: debt.termTurns,
                turns_remaining: debt.turnsRemaining,
                next_payment: round(debt.nextPayment),
                autopay: debt.autopay !== false,
            })),
            borrowing: me.borrowing ? { book_value: round(me.borrowing.bookValue), owed: round(me.borrowing.owed), available: round(me.borrowing.available) } : null,
            shares: state.corporations
                .map(corp => ({ corp_id: corp.id, ticker: corp.ticker, shares: sharesHeld(corp, me.userId) }))
                .filter(holding => holding.shares > 0),
        } : null,
        last_dice: state.lastDiceRoll || null,
        last_card: state.lastCardDrawn ? {
            player: clip(state.lastCardDrawn.playerName),
            deck: state.lastCardDrawn.deckType,
            card: state.lastCardDrawn.card,
            effect: state.lastCardDrawn.effect,
        } : null,
        players: state.players.map(player => ({
            player_id: player.userId,
            name: clip(player.name),
            is_you: player.userId === userId,
            is_current: current ? current.userId === player.userId : false,
            cash: round(player.cash),
            square: squareSummary(player.position),
            in_jail: player.inJail,
            bankrupt: player.bankrupt,
            property_count: state.properties.filter(p => p.ownerId === player.userId).length,
        })),
        owned_properties: state.properties.filter(prop => prop.ownerId).map(prop => ({
            id: prop.id,
            name: prop.name,
            color: prop.color,
            owner: ownerName(state, prop.ownerId),
            houses: prop.houses || 0,
        })),
        unowned_property_ids: state.properties.filter(prop => !prop.ownerId).map(prop => prop.id),
        corporations: state.corporations.map(corp => ({
            id: corp.id,
            ticker: corp.ticker,
            chairman: clip(corp.chairmanName),
            insolvent: !!corp.insolvent,
            price_per_share: corp.pricePerShare,
            total_shares: corp.totalShares,
            cash: round(corp.cash),
            assets: (corp.assets || []).map(asset => asset.id),
            shareholders: (corp.shareholders || []).map(holder => ({ name: clip(holder.name), shares: holder.shares })),
            open_chairman_votes: (corp.chairmanVotes || []).filter(vote => vote.status === 'open').map(vote => ({ id: vote.id, candidate: clip(vote.candidateName) })),
        })),
        auction: state.auction?.status === 'open' ? {
            property_id: state.auction.propertyId,
            property: state.auction.propertyName,
            current_bid: state.auction.currentBid,
            high_bidder: clip(state.auction.highBidderName),
            passed: (state.auction.passedPlayerIds || []).map(id => ownerName(state, id)),
            expires_at: state.auction.expiresAt,
        } : null,
        pending_trade_offers: (state.marketOffers || [])
            .filter(offer => offer.status === 'pending' && [offer.player1Id, offer.player2Id].includes(userId))
            .map(offer => ({
                offer_id: offer.id,
                proposed_by: clip(offer.proposedByName),
                needs_your_answer: offer.recipientId === userId,
                player1: clip(offer.player1Name),
                player1_gives_cash: offer.player1Cash,
                player1_gives_properties: offer.player1AssetIds,
                player1_gives_shares: offer.player1Shares || [],
                player1_properties_go_into_corp: offer.player1PropertiesToCorpId || null,
                player2: clip(offer.player2Name),
                player2_gives_cash: offer.player2Cash,
                player2_gives_properties: offer.player2AssetIds,
                player2_gives_shares: offer.player2Shares || [],
                player2_properties_go_into_corp: offer.player2PropertiesToCorpId || null,
                expires_at: offer.expiresAt,
            })),
        paused: state.paused ? { reason: clip(state.pause?.reason, LOG_LINE_MAX) } : null,
        ended: state.ended ? { standings: (state.standings || []).map(s => ({ name: clip(s.name), net_worth: round(s.netWorth), bankrupt: s.bankrupt })) } : null,
        recent_log: (state.gameLog || []).slice(-RECENT_LOG_LIMIT).map(entry => clip(entry.message, LOG_LINE_MAX)),
        legal_actions: listLegalActions(state, userId, { hostId: room.host_id }).map(action => ({
            type: action.type,
            examples: action.examples.slice(0, EXAMPLE_LIMIT),
        })),
    };
}

function sharesHeld(corp, userId) {
    return (corp.shareholders || [])
        .filter(holder => holder.userId === userId)
        .reduce((sum, holder) => sum + Number(holder.shares || 0), 0);
}

function clip(value, max = NAME_MAX) {
    if (value === null || value === undefined) return value ?? null;
    const text = String(value).replace(/\p{C}+/gu, ' ');
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function round(value) {
    return Math.round(Number(value || 0) * 100) / 100;
}

// Short form for wake-ups that need no decision (timeouts, someone joined).
function briefSummary(summary) {
    const { status, status_line, state_version, room, current_turn, recent_log } = summary;
    return { status, status_line, state_version, members: room.members, current_turn, recent_log: (recent_log || []).slice(-3) };
}

module.exports = { summarizeGame, briefSummary, attentionFor };
