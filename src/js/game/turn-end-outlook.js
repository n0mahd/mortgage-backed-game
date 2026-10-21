// Turn-end outlook: what End Turn will do to the current player's cash.
//
// Display only. It mirrors the order in endTurn (backend/domain/gameRulesInternal/engine.js):
// personal debt interest is charged first, then any unpaid claim is paid from cash, then the
// player goes bankrupt if cash is below zero or the claim is still unpaid. Keep the two in step.
// Classic browser script, no build.
(function (global) {
    'use strict';

    function claimCreditorIsActive(gameState, claim) {
        if (claim.creditorType === 'player') {
            return (gameState.players || []).some(p => p.userId === claim.creditorId && !p.bankrupt);
        }
        if (claim.creditorType === 'corporation') {
            return (gameState.corporations || []).some(c => c.id === claim.creditorId && !c.insolvent);
        }
        return false;
    }

    function getTurnEndOutlook(gameState, player) {
        const claims = gameState?.bankruptcyClaims || {};
        const rawClaim = player ? claims[player.userId] : null;
        const claim = rawClaim && Number(rawClaim.unpaidAmount || 0) > 0 ? rawClaim : null;
        const cash = Number(player?.cash || 0);
        const interest = (player?.debts || []).reduce(
            (sum, debt) => sum + Number(debt.principal || 0) * (Number(debt.interestRate || 0) / 100),
            0,
        );
        const unpaid = claim ? Number(claim.unpaidAmount || 0) : 0;
        const creditorActive = claim ? claimCreditorIsActive(gameState, claim) : true;
        const cashAfterInterest = cash - interest;
        const cashAfter = cashAfterInterest - (creditorActive ? unpaid : 0);
        const goesBankrupt = cashAfter < 0 || (claim !== null && !creditorActive);

        return {
            claim,
            unpaid,
            interest,
            cash,
            cashAfter,
            creditorActive,
            goesBankrupt,
            // The claim gets paid in full by End Turn and the player survives.
            settlesClaim: claim !== null && !goesBankrupt,
        };
    }

    global.getTurnEndOutlook = getTurnEndOutlook;
})(window);
