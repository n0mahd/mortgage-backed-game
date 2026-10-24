// Game screen action dispatcher.
//
// Buttons carry data-game-action; game.js routes their clicks here. Handlers call
// top-level functions from src/js/game.js and src/js/game/*.js at click time.
// Classic browser script, no build.
(function (global) {
    'use strict';

    const handlers = {
        'place-auction-bid': () => global.placeAuctionBid(),
        'pass-auction': () => global.passAuction(),
        'host-cancel-auction': () => global.hostCancelAuction(),
        'open-buy-property': () => global.openBuyPropertyModal(),
        'roll-dice': () => global.rollDiceAndMove(),
        'pay-jail-fine': () => global.payJailFine(),
        'use-jail-card': () => global.useJailCard(),
        'open-ipo': () => global.openIPOModal(),
        'open-debt': () => global.openDebtModal(),
        'open-corporation': () => global.openCorporationModal(),
        'end-turn': () => global.endTurn(),
        'host-pause': () => global.hostPauseGame(),
        'host-end': () => global.hostEndGame(),
        'host-resume': () => global.hostResumeGame(),
        'buy-shares': button => global.buyShares(button.dataset.corpId),
        'offer-property-for-shares': button => global.offerPropertyForShares(button.dataset.corpId),
        'open-add-to-corporation': button => global.openAddToCorporationModal(button.dataset.corpId),
        'use-even-shares': () => global.useEvenShares(),
        'support-chairman-vote': button => global.supportChairmanVote(button.dataset.corpId, button.dataset.voteId),
        'change-chairman-majority': button => global.changeChairmanByMajority(button.dataset.corpId),
        'propose-chairman-vote': button => global.proposeChairmanVote(button.dataset.corpId),
        'accept-trade-offer': button => global.acceptTradeOffer(button.dataset.offerId),
        'cancel-trade-offer': button => global.cancelTradeOffer(button.dataset.offerId),
        'counter-trade-offer': button => global.counterTradeOffer(button.dataset.offerId),
        'stop-trade-counter': () => global.stopTradeCounter(),
        'show-more-past-trades': () => global.showMorePastTrades(),
        'host-cancel-trade-offer': button => global.hostCancelTradeOffer(button.dataset.offerId),
        'adjust-house': button => global.houseModalAdjust(button.dataset.propertyId, Number(button.dataset.delta)),
        'open-house': () => global.openHouseModal(),
        'set-rent-policy': button => global.CorporationDesk.setRentPolicy(button.dataset.corpId, button.dataset.policy),
        'propose-rent-policy': button => global.CorporationDesk.proposeRentPolicy(button.dataset.corpId, button.dataset.policy),
        'vote-rent-policy': button => global.CorporationDesk.voteRentPolicy(button.dataset.corpId, button.dataset.approve === 'true'),
        'pay-dividend': button => global.CorporationDesk.payDividend(button.dataset.corpId),
        'build-for-corporation': button => global.CorporationDesk.buildForCorporation(button.dataset.corpId),
        'trade-as-corporation': button => global.CorporationDesk.tradeAsCorporation(button.dataset.corpId),
        'open-property-offer': button => global.CorporationDesk.openPropertyOffer(button.dataset.corpId),
        'toggle-property-counter': button => global.CorporationDesk.togglePropertyCounter(button.dataset.offerId),
        'fill-property-counter': button => global.CorporationDesk.fillPropertyCounter(button.dataset.offerId, Number(button.dataset.price)),
        'open-trade-proposals': () => global.openTradeProposals(),
        'respond-property-offer': button => global.CorporationDesk.respondPropertyOffer(button.dataset.offerId, button.dataset.response),
    };

    function run(button) {
        const action = button?.dataset?.gameAction;
        const handler = handlers[action];
        if (!handler) {
            console.warn('Unhandled game action:', action);
            return false;
        }
        handler(button);
        return true;
    }

    global.GameActionDispatcher = { run };
})(window);
