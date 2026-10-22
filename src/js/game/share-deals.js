// Plain-language summaries of trades that move LLC shares or put a property
// into an LLC ("property for shares").
//
// Classic browser script, no DOM access: everything works from the game state
// and trade terms (the propose_trade payload or a stored offer), so the Market
// form preview and the pending-offer cards read the same way. The server stays
// the authority on whether a trade is legal; these are display numbers only.
(function (global) {
    'use strict';

    function corpById(gameState, corpId) {
        return (gameState.corporations || []).find(corp => corp.id === corpId) || null;
    }

    function playerById(gameState, userId) {
        return (gameState.players || []).find(player => player.userId === userId) || null;
    }

    function sharesHeld(corp, userId) {
        const holder = (corp.shareholders || []).find(item => item.userId === userId);
        return Number(holder?.shares || 0);
    }

    function isInsolvent(corp) {
        return !!corp.insolvent || corp.status === 'insolvent';
    }

    // Mirrors the engine's rule: the chairman or a majority holder runs an LLC.
    function runsCorporation(corp, userId) {
        if (!corp || !userId || isInsolvent(corp)) return false;
        return corp.chairmanId === userId || sharesHeld(corp, userId) > Number(corp.totalShares || 0) / 2;
    }

    function corporationsRunBy(gameState, userId) {
        return (gameState.corporations || []).filter(corp => runsCorporation(corp, userId));
    }

    function percent(shares, total) {
        const t = Number(total || 0);
        if (!t) return '0%';
        const value = (Number(shares || 0) / t) * 100;
        return `${Number.isInteger(value) ? value : value.toFixed(1).replace(/\.0$/, '')}%`;
    }

    // 12,000-share companies: "3,600" and "$0.1125".
    function count(value) {
        return Number(value || 0).toLocaleString('en-US');
    }

    function perShare(value) {
        const v = Number(value || 0);
        return `$${v >= 1 ? v.toFixed(2) : v.toFixed(4)}`;
    }

    function money(value) {
        const rounded = Math.round(Number(value || 0));
        return `$${Math.abs(rounded).toLocaleString('en-US')}`;
    }

    function signedMoney(value) {
        const rounded = Math.round(Number(value || 0));
        if (rounded === 0) return '$0';
        return `${rounded > 0 ? '+' : '−'}${money(rounded)}`;
    }

    function list(items) {
        if (items.length <= 1) return items.join('');
        return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
    }

    function propertyValue(gameState, propertyId) {
        for (const player of gameState.players || []) {
            const owned = (player.properties || []).find(prop => prop.id === propertyId);
            if (owned) return Number(owned.value || 0);
        }
        const prop = (gameState.properties || []).find(item => item.id === propertyId);
        return Number(prop?.price || 0);
    }

    function propertyName(gameState, propertyId) {
        const prop = (gameState.properties || []).find(item => item.id === propertyId);
        return prop ? prop.name : propertyId;
    }

    function normalizeSide(terms, side, jailCardId) {
        const assetIds = terms[`${side}AssetIds`] || [];
        return {
            userId: terms[`${side}Id`],
            cash: Number(terms[`${side}Cash`] || 0),
            propertyIds: assetIds.filter(id => id !== jailCardId),
            jailCard: assetIds.includes(jailCardId),
            shares: (terms[`${side}Shares`] || []).filter(lot => Number(lot.shares || 0) > 0),
            intoCorpId: terms[`${side}PropertiesToCorpId`] || null,
        };
    }

    // terms: propose_trade payload or stored offer. viewerId: who is reading.
    // options.netAssetValue(corp) -> number; options.jailCardId.
    function summarize(gameState, terms, viewerId, options) {
        const navOf = options.netAssetValue;
        const sides = {
            player1: normalizeSide(terms, 'player1', options.jailCardId),
            player2: normalizeSide(terms, 'player2', options.jailCardId),
        };
        const other = { player1: 'player2', player2: 'player1' };
        const name = userId => (userId === viewerId ? 'You' : (playerById(gameState, userId)?.name || 'Someone'));
        const touchedCorpIds = new Set();
        Object.values(sides).forEach(side => {
            side.shares.forEach(lot => touchedCorpIds.add(lot.corpId));
            if (side.intoCorpId && side.propertyIds.length) touchedCorpIds.add(side.intoCorpId);
        });

        // Company value and shareholdings before and after the trade.
        const corps = new Map();
        touchedCorpIds.forEach(corpId => {
            const corp = corpById(gameState, corpId);
            if (!corp) return;
            const holdings = new Map((corp.shareholders || []).map(item => [item.userId, Number(item.shares || 0)]));
            corps.set(corpId, {
                corp,
                navBefore: navOf(corp),
                navAfter: navOf(corp),
                before: new Map(holdings),
                after: holdings,
            });
        });
        Object.entries(sides).forEach(([key, side]) => {
            const receiverId = sides[other[key]].userId;
            if (side.intoCorpId && corps.has(side.intoCorpId)) {
                const entry = corps.get(side.intoCorpId);
                side.propertyIds.forEach(id => { entry.navAfter += propertyValue(gameState, id); });
            }
            side.shares.forEach(lot => {
                const entry = corps.get(lot.corpId);
                if (!entry) return;
                const n = Number(lot.shares);
                entry.after.set(side.userId, (entry.after.get(side.userId) || 0) - n);
                entry.after.set(receiverId, (entry.after.get(receiverId) || 0) + n);
            });
        });

        // One sentence per side, e.g. "You put Boardwalk into MBS." or
        // "Sam gives you 3 of 12 MBS shares (25%)."
        const sentences = ['player1', 'player2'].map(key => {
            const side = sides[key];
            const receiver = sides[other[key]];
            const giver = name(side.userId);
            const you = giver === 'You';
            const to = name(receiver.userId);
            const parts = [];
            if (side.cash > 0) parts.push(money(side.cash));
            const corp = side.intoCorpId ? corpById(gameState, side.intoCorpId) : null;
            if (side.propertyIds.length && !corp) parts.push(list(side.propertyIds.map(id => propertyName(gameState, id))));
            side.shares.forEach(lot => {
                const shareCorp = corpById(gameState, lot.corpId);
                const total = Number(shareCorp?.totalShares || 0);
                const n = Number(lot.shares);
                parts.push(`${count(n)} of ${count(total)} ${shareCorp ? shareCorp.ticker : 'LLC'} share${n === 1 ? '' : 's'} (${percent(n, total)})`);
            });
            if (side.jailCard) parts.push('a Get Out of Jail Free card');
            const clauses = [];
            if (corp && side.propertyIds.length) {
                clauses.push(`${you ? 'put' : 'puts'} ${list(side.propertyIds.map(id => propertyName(gameState, id)))} into ${corp.ticker}`);
            }
            if (parts.length) clauses.push(`${you ? 'give' : 'gives'} ${to === 'You' ? 'you' : to} ${list(parts)}`);
            if (!clauses.length) return null;
            return `${giver} ${clauses.join(' and ')}.`;
        }).filter(Boolean);

        // What changes for the viewer, if they are part of the trade.
        const viewerKey = Object.keys(sides).find(key => sides[key].userId === viewerId) || null;
        const rows = [];
        const warnings = [];
        let netChange = null;
        if (viewerKey) {
            const mine = sides[viewerKey];
            const theirs = sides[other[viewerKey]];
            netChange = theirs.cash - mine.cash;
            mine.propertyIds.forEach(id => { netChange -= propertyValue(gameState, id); });
            if (!theirs.intoCorpId) theirs.propertyIds.forEach(id => { netChange += propertyValue(gameState, id); });
            corps.forEach(entry => {
                const total = Number(entry.corp.totalShares || 0);
                if (!total) return;
                const before = entry.before.get(viewerId) || 0;
                const after = entry.after.get(viewerId) || 0;
                const valueBefore = before * Math.max(0, entry.navBefore) / total;
                const valueAfter = after * Math.max(0, entry.navAfter) / total;
                netChange += valueAfter - valueBefore;
                if (entry.navAfter !== entry.navBefore) {
                    rows.push({ label: `${entry.corp.ticker} value`, value: `${money(entry.navBefore)} → ${money(entry.navAfter)}` });
                }
                if (before !== after) {
                    rows.push({
                        label: `Your ${entry.corp.ticker} shares`,
                        value: `${count(before)} → ${count(after)} (${percent(before, total)} → ${percent(after, total)}), worth ${money(valueAfter)}`,
                    });
                }
            });
            if (corps.size) rows.push({ label: 'Your net worth', value: signedMoney(netChange), tone: Math.round(netChange) > 0 ? 'up' : (Math.round(netChange) < 0 ? 'down' : '') });
        }

        // Control: anyone who ends up with over half can replace the chairman.
        corps.forEach(entry => {
            const total = Number(entry.corp.totalShares || 0);
            entry.after.forEach((after, userId) => {
                const before = entry.before.get(userId) || 0;
                if (after > total / 2 && before <= total / 2 && userId !== entry.corp.chairmanId) {
                    const who = name(userId);
                    warnings.push(`${who} will own over half of ${entry.corp.ticker} and ${who === 'You' ? 'can' : 'could'} replace the chairman.`);
                }
            });
            const chairBefore = entry.before.get(entry.corp.chairmanId) || 0;
            const chairAfter = entry.after.get(entry.corp.chairmanId) || 0;
            if (entry.corp.chairmanId === viewerId && chairBefore > total / 2 && chairAfter <= total / 2) {
                warnings.push(`You'll no longer hold over half of ${entry.corp.ticker}. You stay chairman, but other holders can vote you out.`);
            }
        });

        // Even split for the classic deal: property into an LLC for its shares.
        let evenShares = null;
        ['player1', 'player2'].forEach(key => {
            const side = sides[key];
            const back = sides[other[key]];
            const lot = back.shares.find(item => item.corpId === side.intoCorpId);
            if (!side.intoCorpId || !lot || !side.propertyIds.length || side.cash || back.cash || back.propertyIds.length) return;
            const entry = corps.get(side.intoCorpId);
            const total = Number(entry.corp.totalShares || 0);
            if (!total || entry.navAfter <= 0) return;
            const given = side.propertyIds.reduce((sum, id) => sum + propertyValue(gameState, id), 0);
            evenShares = { ticker: entry.corp.ticker, shares: Math.round((given * total) / entry.navAfter), total };
        });

        return { sentences, rows, warnings, netChange, evenShares };
    }

    // Mirrors the engine's contribution quote: whole new shares at the current
    // value per share, rounded to the nearest share, total capped at maxShares. options.price
    // overrides the book value (a property offer at a named price).
    function contributionQuote(gameState, corp, userId, propertyIds, options) {
        const value = propertyIds.reduce((sum, id) => sum + propertyValue(gameState, id), 0);
        const price = options.price == null ? value : Number(options.price);
        const totalShares = Number(corp.totalShares || 0);
        const otherShares = totalShares - sharesHeld(corp, userId);
        const netAssetValue = options.netAssetValue(corp);
        const room = Math.max(0, options.maxShares - totalShares);
        const quote = { value, price, newShares: 0, fairShares: 0, otherShares, noSharesReason: null };
        if (otherShares <= 0) {
            quote.noSharesReason = `You hold every ${corp.ticker} share, so there's no one to share the value with.`;
        } else if (netAssetValue <= 0) {
            quote.noSharesReason = `${corp.ticker} is worth $0 or less, so new shares can't be priced.`;
        } else {
            quote.fairShares = Math.round((price * totalShares) / netAssetValue);
            quote.newShares = Math.min(quote.fairShares, room);
            if (room === 0) quote.noSharesReason = `${corp.ticker} already has ${count(options.maxShares)} shares, the most allowed.`;
            else if (propertyIds.length && quote.fairShares === 0) quote.noSharesReason = `That's worth less than half a ${corp.ticker} share (${perShare(netAssetValue / totalShares)}).`;
        }
        return quote;
    }

    // Preview for add_to_corporation, shaped like summarize() so the same
    // renderer shows it: { sentences, rows, warnings }.
    function summarizeContribution(gameState, corp, userId, propertyIds, issueShares, options) {
        const quote = contributionQuote(gameState, corp, userId, propertyIds, options);
        const newShares = issueShares ? quote.newShares : 0;
        const total = Number(corp.totalShares || 0);
        const mine = sharesHeld(corp, userId);
        const navBefore = Math.max(0, options.netAssetValue(corp));
        const navAfter = Math.max(0, options.netAssetValue(corp) + quote.value);
        const stakeBefore = total ? (mine * navBefore) / total : 0;
        const stakeAfter = total + newShares ? ((mine + newShares) * navAfter) / (total + newShares) : 0;
        const netChange = stakeAfter - stakeBefore - quote.value;
        const names = list(propertyIds.map(id => propertyName(gameState, id)));
        const sentences = [newShares > 0
            ? `You put ${names} into ${corp.ticker} and get ${count(newShares)} new share${newShares === 1 ? '' : 's'}.`
            : `You put ${names} into ${corp.ticker}.`];
        const rows = [
            { label: `${corp.ticker} value`, value: `${money(navBefore)} → ${money(navAfter)}` },
            {
                label: `Your ${corp.ticker} shares`,
                value: `${count(mine)} of ${count(total)} → ${count(mine + newShares)} of ${count(total + newShares)} (${percent(mine + newShares, total + newShares)})`,
            },
            { label: 'Your net worth', value: signedMoney(netChange), tone: Math.round(netChange) > 0 ? 'up' : (Math.round(netChange) < 0 ? 'down' : '') },
        ];
        const warnings = [];
        if (Math.round(netChange) < 0) {
            warnings.push(newShares > 0
                ? `The other ${corp.ticker} holders gain ${money(-netChange)}: shares are rounded to a whole number.`
                : `The other ${corp.ticker} holders gain ${money(-netChange)}, since their shares rise in value too.`);
        } else if (Math.round(netChange) > 0) {
            warnings.push(`Rounding to a whole share gives you ${money(netChange)} more than the property's value, and the other ${corp.ticker} holders' stakes drop by as much.`);
        }
        return { sentences, rows, warnings, netChange, quote };
    }

    // Preview of a property offer to an LLC: offererId gives propertyIds for
    // `price`, paid in new shares (at the current value per share) or treasury
    // cash. Read by the offerer, the chairman, or anyone: viewerId decides
    // whose stake gets the "your stake" row.
    function summarizePropertyOffer(gameState, corp, offererId, propertyIds, price, payWith, viewerId, options) {
        const quote = contributionQuote(gameState, corp, offererId, propertyIds, { ...options, price });
        const total = Number(corp.totalShares || 0);
        const newShares = payWith === 'cash' ? 0 : quote.newShares;
        const navBefore = Math.max(0, options.netAssetValue(corp));
        const navAfter = Math.max(0, options.netAssetValue(corp) + quote.value - (payWith === 'cash' ? quote.price : 0));
        const totalAfter = total + newShares;
        const perShareBefore = total ? navBefore / total : 0;
        const perShareAfter = totalAfter ? navAfter / totalAfter : 0;
        const offerer = playerById(gameState, offererId);
        const who = userId => (userId === viewerId ? 'You' : (playerById(gameState, userId)?.name || 'Someone'));
        const names = list(propertyIds.map(id => propertyName(gameState, id)));
        const paid = payWith === 'cash'
            ? `${money(quote.price)} from the ${corp.ticker} treasury`
            : `${count(newShares)} new ${corp.ticker} share${newShares === 1 ? '' : 's'}`;
        const sentences = [`${who(offererId)} ${offererId === viewerId ? 'give' : 'gives'} ${corp.ticker} ${names} for ${paid}.`];
        const rows = [];
        if (Math.round(quote.price) !== Math.round(quote.value)) {
            rows.push({ label: 'Book value', value: `${money(quote.value)} (price ${quote.price > quote.value ? '+' : '−'}${money(Math.abs(quote.price - quote.value))})` });
        }
        if (newShares > 0) rows.push({ label: 'Value per share', value: `${perShare(perShareBefore)} → ${perShare(perShareAfter)}` });
        const holders = new Map((corp.shareholders || []).map(item => [item.userId, Number(item.shares || 0)]));
        if (!holders.has(offererId)) holders.set(offererId, 0);
        const warnings = [];
        holders.forEach((before, userId) => {
            const after = before + (userId === offererId ? newShares : 0);
            const valueBefore = before * perShareBefore;
            const valueAfter = after * perShareAfter;
            if (newShares > 0) {
                rows.push({ label: who(userId), value: `${percent(before, total)} → ${percent(after, totalAfter)}` });
            }
            if (userId === viewerId) {
                const change = userId === offererId
                    ? valueAfter - valueBefore + (payWith === 'cash' ? quote.price : 0) - quote.value
                    : valueAfter - valueBefore;
                rows.push({ label: 'Your net worth', value: signedMoney(change), tone: Math.round(change) > 0 ? 'up' : (Math.round(change) < 0 ? 'down' : '') });
            }
            if (after > totalAfter / 2 && before <= total / 2 && userId !== corp.chairmanId) {
                warnings.push(`${who(userId)} will own over half of ${corp.ticker} and ${userId === viewerId ? 'can' : 'could'} replace the chairman.`);
            }
        });
        if (Math.round(quote.price - quote.value) > 0) {
            warnings.push(`Paying ${money(quote.price - quote.value)} over book value moves value from the other ${corp.ticker} holders to ${offerer?.name || 'the offerer'}.`);
        }
        if (payWith !== 'cash' && propertyIds.length && newShares === 0) warnings.push(quote.noSharesReason || 'This price buys no shares.');
        return { sentences, rows, warnings, quote, newShares };
    }

    global.ShareDeals = { summarize, summarizeContribution, summarizePropertyOffer, contributionQuote, corporationsRunBy, runsCorporation, percent, count, perShare };
})(window);
