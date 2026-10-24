// Ending a turn, ending the game, and host pause/resume.

const { makeEvent, log, cleanText, normalizeDateString, GameRuleError } = require('./util');
const { calculateNetWorth, resetCashFlow } = require('./ledger');
const { resolveCorporationInsolvency } = require('./corporations');
const {
    liquidateBankruptPlayer,
    clearBankruptcyClaim,
    claimBlocksRolling,
    settleBankruptcyClaim,
} = require('./bankruptcy');
const { loanServicerId, serviceLoans } = require('./debt');
const { cancelPendingTradeOffersForPlayer } = require('./trades');

function endTurn(state, player, events) {
    // After doubles a player who can't pay this turn's rent can't roll again (rollDice), so
    // End Turn is open to them, and declares bankruptcy.
    if (!player.diceRolled && !claimBlocksRolling(state, player)) throw new GameRuleError(400, 'Roll before ending turn');

    // Rent owed is paid before loans, so autopay (which never takes more than the
    // cash left) can't turn a payable claim into a bankruptcy. A loan coming due can.
    const bankruptcyClaim = settleBankruptcyClaim(state, player, events);
    serviceLoans(state, player, player, player.userId, player.name, events);
    state.corporations.forEach(corp => {
        if (corp.insolvent || loanServicerId(corp) !== player.userId) return;
        const corpInterest = serviceLoans(state, player, corp, corp.id, corp.ticker, events, `[${corp.ticker}]`);
        if (Number(corp.cash || 0) < 0) {
            resolveCorporationInsolvency(state, corp, player, events, {
                reason: 'interest',
                interestCharged: corpInterest,
            });
        }
    });
    // The rent-policy cooldown counts the chairman's own turns.
    state.corporations.forEach(corp => {
        if (corp.chairmanId !== player.userId) return;
        if (corp.rentPolicyLockSkipsTurnOf === player.userId) corp.rentPolicyLockSkipsTurnOf = null;
        else if (corp.rentPolicyLockedTurns > 0) corp.rentPolicyLockedTurns -= 1;
    });
    if ((player.cash < 0 || bankruptcyClaim) && !player.bankrupt) {
        player.bankrupt = true;
        cancelPendingTradeOffersForPlayer(state, player, events);
        liquidateBankruptPlayer(state, player, events, bankruptcyClaim);
        clearBankruptcyClaim(state, player.userId);
        events.push(makeEvent(player, 'bankruptcy', {
            player: player.name,
            creditor: bankruptcyClaim ? bankruptcyClaim.creditorName : null,
            reason: bankruptcyClaim ? bankruptcyClaim.reason : null,
        }));
        log(state, `${player.name} has gone BANKRUPT!`);
    } else if (!bankruptcyClaim && player.cash >= 0) {
        clearBankruptcyClaim(state, player.userId);
    }
    player.diceRolled = false;
    player.doubleCount = 0;
    const activePlayers = state.players.filter(p => !p.bankrupt);
    if (activePlayers.length <= 1) {
        finishGame(state, activePlayers[0] ? `${activePlayers[0].name} wins - last player standing!` : "Everyone went bankrupt - it's a draw!", events);
        return;
    }
    const totalPlayers = state.players.length;
    let nextIndex = (state.currentPlayerIndex + 1) % totalPlayers;
    let safety = 0;
    while (state.players[nextIndex].bankrupt && safety < totalPlayers) {
        nextIndex = (nextIndex + 1) % totalPlayers;
        safety += 1;
    }
    state.currentPlayerIndex = nextIndex;
    resetCashFlow(state, state.players[nextIndex].userId);
    state.lastDiceRoll = null;
    state.lastCardDrawn = null;
    state.players[nextIndex].diceRolled = false;
    events.push(makeEvent(player, 'turn_end', { player: player.name, nextPlayer: state.players[nextIndex].name }));
    log(state, `${player.name} ended their turn. It's now ${state.players[nextIndex].name}'s turn.`);
}

function finishGame(state, reason, events) {
    if (state.paused && state.pause) {
        state.pauseHistory.push({
            ...state.pause,
            closedAt: new Date().toISOString(),
            closeReason: 'game_ended',
        });
        state.pauseHistory = state.pauseHistory.slice(-20);
    }
    state.paused = false;
    state.pause = null;
    state.ended = true;
    state.standings = state.players.map(player => ({
        userId: player.userId,
        name: player.name,
        cash: player.cash,
        netWorth: calculateNetWorth(state, player.userId),
        bankrupt: player.bankrupt,
    })).sort((a, b) => b.netWorth - a.netWorth);
    events.push(makeEvent(state.players[state.currentPlayerIndex] || state.players[0], 'game_ended', { reason, standings: state.standings }));
    log(state, `Game over - ${reason}`);
}

function pauseGame(state, actor, payload, events) {
    if (state.paused) throw new GameRuleError(400, 'Game is already paused');
    const reason = cleanText(payload.reason, 'Host paused the game');
    const pausedAt = new Date().toISOString();
    state.paused = true;
    state.pause = {
        reason,
        pausedAt,
        pausedById: actor.userId,
        pausedByName: actor.name,
    };
    events.push(makeEvent(actor, 'game_paused', {
        actor: actor.name,
        reason,
        pausedAt,
    }));
    log(state, `${actor.name} paused the game: ${reason}`);
}

function resumeGame(state, actor, events) {
    if (!state.paused) throw new GameRuleError(400, 'Game is not paused');
    const resumedAt = new Date().toISOString();
    state.pauseHistory.push({
        ...(state.pause || {}),
        resumedAt,
        resumedById: actor.userId,
        resumedByName: actor.name,
    });
    state.pauseHistory = state.pauseHistory.slice(-20);
    state.paused = false;
    state.pause = null;
    events.push(makeEvent(actor, 'game_resumed', {
        actor: actor.name,
        resumedAt,
    }));
    log(state, `${actor.name} resumed the game`);
}

function normalizePauseState(pause) {
    if (!pause || typeof pause !== 'object') {
        return {
            reason: 'Host paused the game',
            pausedAt: new Date().toISOString(),
            pausedById: null,
            pausedByName: 'Host',
        };
    }
    return {
        reason: cleanText(pause.reason, 'Host paused the game'),
        pausedAt: normalizeDateString(pause.pausedAt),
        pausedById: pause.pausedById || null,
        pausedByName: pause.pausedByName || 'Host',
    };
}

module.exports = {
    endTurn,
    finishGame,
    pauseGame,
    resumeGame,
    normalizePauseState,
};
