// The board itself: properties, squares, house costs, the two card decks, and dice.

const MONOPOLY_PROPERTIES = [
    { name: 'Mediterranean Avenue', color: 'Brown', price: 60, rent: [2, 10, 30, 90, 160, 250] },
    { name: 'Baltic Avenue', color: 'Brown', price: 60, rent: [4, 20, 60, 180, 320, 450] },
    { name: 'Oriental Avenue', color: 'Light Blue', price: 100, rent: [6, 30, 90, 270, 400, 550] },
    { name: 'Vermont Avenue', color: 'Light Blue', price: 100, rent: [6, 30, 90, 270, 400, 550] },
    { name: 'Connecticut Avenue', color: 'Light Blue', price: 120, rent: [8, 40, 100, 300, 450, 600] },
    { name: 'St. Charles Place', color: 'Pink', price: 140, rent: [10, 50, 150, 450, 625, 750] },
    { name: 'Electric Company', color: 'Utility', price: 150, rent: [4, 10] },
    { name: 'States Avenue', color: 'Pink', price: 140, rent: [10, 50, 150, 450, 625, 750] },
    { name: 'Virginia Avenue', color: 'Pink', price: 160, rent: [12, 60, 180, 500, 700, 900] },
    { name: 'Reading Railroad', color: 'Railroad', price: 200, rent: [25, 50, 100, 200] },
    { name: 'St. James Place', color: 'Orange', price: 180, rent: [14, 70, 200, 550, 750, 950] },
    { name: 'Tennessee Avenue', color: 'Orange', price: 180, rent: [14, 70, 200, 550, 750, 950] },
    { name: 'New York Avenue', color: 'Orange', price: 200, rent: [16, 80, 220, 600, 800, 1000] },
    { name: 'Kentucky Avenue', color: 'Red', price: 220, rent: [18, 90, 250, 700, 875, 1050] },
    { name: 'Indiana Avenue', color: 'Red', price: 220, rent: [18, 90, 250, 700, 875, 1050] },
    { name: 'Illinois Avenue', color: 'Red', price: 240, rent: [20, 100, 300, 750, 925, 1100] },
    { name: 'Pennsylvania Railroad', color: 'Railroad', price: 200, rent: [25, 50, 100, 200] },
    { name: 'Atlantic Avenue', color: 'Yellow', price: 260, rent: [22, 110, 330, 800, 975, 1150] },
    { name: 'Ventnor Avenue', color: 'Yellow', price: 260, rent: [22, 110, 330, 800, 975, 1150] },
    { name: 'Water Works', color: 'Utility', price: 150, rent: [4, 10] },
    { name: 'Marvin Gardens', color: 'Yellow', price: 280, rent: [24, 120, 360, 850, 1025, 1200] },
    { name: 'Pacific Avenue', color: 'Green', price: 300, rent: [26, 130, 390, 900, 1100, 1275] },
    { name: 'North Carolina Avenue', color: 'Green', price: 300, rent: [26, 130, 390, 900, 1100, 1275] },
    { name: 'Pennsylvania Avenue', color: 'Green', price: 320, rent: [28, 150, 450, 1000, 1200, 1400] },
    { name: 'Short Line', color: 'Railroad', price: 200, rent: [25, 50, 100, 200] },
    { name: 'Park Place', color: 'Dark Blue', price: 350, rent: [35, 175, 500, 1100, 1300, 1500] },
    { name: 'Boardwalk', color: 'Dark Blue', price: 400, rent: [50, 200, 600, 1400, 1700, 2000] },
    { name: 'B. & O. Railroad', color: 'Railroad', price: 200, rent: [25, 50, 100, 200] },
];

const BOARD_SQUARES = [
    { position: 0, name: 'GO', type: 'go', propertyId: null, taxAmount: 0 },
    { position: 1, name: 'Mediterranean Ave', type: 'property', propertyId: 'prop-0', taxAmount: 0 },
    { position: 2, name: 'Community Chest', type: 'community_chest', propertyId: null, taxAmount: 0 },
    { position: 3, name: 'Baltic Ave', type: 'property', propertyId: 'prop-1', taxAmount: 0 },
    { position: 4, name: 'Income Tax', type: 'tax', propertyId: null, taxAmount: 200 },
    { position: 5, name: 'Reading Railroad', type: 'railroad', propertyId: 'prop-9', taxAmount: 0 },
    { position: 6, name: 'Oriental Ave', type: 'property', propertyId: 'prop-2', taxAmount: 0 },
    { position: 7, name: 'Chance', type: 'chance', propertyId: null, taxAmount: 0 },
    { position: 8, name: 'Vermont Ave', type: 'property', propertyId: 'prop-3', taxAmount: 0 },
    { position: 9, name: 'Connecticut Ave', type: 'property', propertyId: 'prop-4', taxAmount: 0 },
    { position: 10, name: 'Jail / Just Visiting', type: 'jail', propertyId: null, taxAmount: 0 },
    { position: 11, name: 'St. Charles Pl.', type: 'property', propertyId: 'prop-5', taxAmount: 0 },
    { position: 12, name: 'Electric Company', type: 'utility', propertyId: 'prop-6', taxAmount: 0 },
    { position: 13, name: 'States Ave', type: 'property', propertyId: 'prop-7', taxAmount: 0 },
    { position: 14, name: 'Virginia Ave', type: 'property', propertyId: 'prop-8', taxAmount: 0 },
    { position: 15, name: 'Pennsylvania RR', type: 'railroad', propertyId: 'prop-16', taxAmount: 0 },
    { position: 16, name: 'St. James Place', type: 'property', propertyId: 'prop-10', taxAmount: 0 },
    { position: 17, name: 'Community Chest', type: 'community_chest', propertyId: null, taxAmount: 0 },
    { position: 18, name: 'Tennessee Ave', type: 'property', propertyId: 'prop-11', taxAmount: 0 },
    { position: 19, name: 'New York Ave', type: 'property', propertyId: 'prop-12', taxAmount: 0 },
    { position: 20, name: 'Free Parking', type: 'free_parking', propertyId: null, taxAmount: 0 },
    { position: 21, name: 'Kentucky Ave', type: 'property', propertyId: 'prop-13', taxAmount: 0 },
    { position: 22, name: 'Chance', type: 'chance', propertyId: null, taxAmount: 0 },
    { position: 23, name: 'Indiana Ave', type: 'property', propertyId: 'prop-14', taxAmount: 0 },
    { position: 24, name: 'Illinois Ave', type: 'property', propertyId: 'prop-15', taxAmount: 0 },
    { position: 25, name: 'B.&O. Railroad', type: 'railroad', propertyId: 'prop-27', taxAmount: 0 },
    { position: 26, name: 'Atlantic Ave', type: 'property', propertyId: 'prop-17', taxAmount: 0 },
    { position: 27, name: 'Ventnor Ave', type: 'property', propertyId: 'prop-18', taxAmount: 0 },
    { position: 28, name: 'Water Works', type: 'utility', propertyId: 'prop-19', taxAmount: 0 },
    { position: 29, name: 'Marvin Gardens', type: 'property', propertyId: 'prop-20', taxAmount: 0 },
    { position: 30, name: 'Go to Jail', type: 'go_to_jail', propertyId: null, taxAmount: 0 },
    { position: 31, name: 'Pacific Ave', type: 'property', propertyId: 'prop-21', taxAmount: 0 },
    { position: 32, name: 'N. Carolina Ave', type: 'property', propertyId: 'prop-22', taxAmount: 0 },
    { position: 33, name: 'Community Chest', type: 'community_chest', propertyId: null, taxAmount: 0 },
    { position: 34, name: 'Pennsylvania Ave', type: 'property', propertyId: 'prop-23', taxAmount: 0 },
    { position: 35, name: 'Short Line RR', type: 'railroad', propertyId: 'prop-24', taxAmount: 0 },
    { position: 36, name: 'Chance', type: 'chance', propertyId: null, taxAmount: 0 },
    { position: 37, name: 'Park Place', type: 'property', propertyId: 'prop-25', taxAmount: 0 },
    { position: 38, name: 'Luxury Tax', type: 'tax', propertyId: null, taxAmount: 100 },
    { position: 39, name: 'Boardwalk', type: 'property', propertyId: 'prop-26', taxAmount: 0 },
];

const HOUSE_COSTS = {
    Brown: 50, 'Light Blue': 50, Pink: 100, Orange: 100,
    Red: 150, Yellow: 150, Green: 200, 'Dark Blue': 200,
};

const JAIL_FINE_AMOUNT = 50;

const JAIL_CARD_ASSET_ID = 'get-out-of-jail-free';

const CHANCE_CARDS = [
    { id: 'ch-1', text: 'Advance to GO. Collect $200.', action: { type: 'advance_to', position: 0 } },
    { id: 'ch-2', text: 'Advance to Illinois Ave.', action: { type: 'advance_to', position: 24 } },
    { id: 'ch-3', text: 'Advance to St. Charles Place.', action: { type: 'advance_to', position: 11 } },
    { id: 'ch-4', text: 'Advance to nearest Utility. If owned, pay 10x your dice roll.', action: { type: 'advance_nearest', nearestType: 'utility', utilityMultiplier: 10 } },
    { id: 'ch-5', text: 'Advance to nearest Railroad. Pay owner twice the normal rent.', action: { type: 'advance_nearest', nearestType: 'railroad', rentMultiplier: 2 } },
    { id: 'ch-6', text: 'Bank pays you a dividend of $50.', action: { type: 'collect', amount: 50 } },
    { id: 'ch-7', text: 'Get Out of Jail Free.', action: { type: 'get_out_of_jail' } },
    { id: 'ch-8', text: 'Go Back 3 Spaces.', action: { type: 'back_3' } },
    { id: 'ch-9', text: 'Go to Jail. Do not pass GO.', action: { type: 'go_to_jail' } },
    { id: 'ch-10', text: 'Make general repairs - $25 per house, $100 per hotel.', action: { type: 'repairs', perHouse: 25, perHotel: 100 } },
    { id: 'ch-11', text: 'Pay a poor tax of $15.', action: { type: 'pay', amount: 15 } },
    { id: 'ch-12', text: 'Take a trip to Reading Railroad.', action: { type: 'advance_to', position: 5 } },
    { id: 'ch-13', text: 'Take a walk on the Boardwalk.', action: { type: 'advance_to', position: 39 } },
    { id: 'ch-14', text: 'You have been elected Chairman of the Board - pay each player $50.', action: { type: 'pay_to_each', amount: 50 } },
    { id: 'ch-15', text: 'Your building and loan matures - collect $150.', action: { type: 'collect', amount: 150 } },
    { id: 'ch-16', text: 'You have won a crossword competition - collect $100.', action: { type: 'collect', amount: 100 } },
];

const COMMUNITY_CHEST_CARDS = [
    { id: 'cc-1', text: 'Advance to GO. Collect $200.', action: { type: 'advance_to', position: 0 } },
    { id: 'cc-2', text: 'Bank error in your favor - collect $200.', action: { type: 'collect', amount: 200 } },
    { id: 'cc-3', text: "Doctor's fee - pay $50.", action: { type: 'pay', amount: 50 } },
    { id: 'cc-4', text: 'From sale of stock - collect $50.', action: { type: 'collect', amount: 50 } },
    { id: 'cc-5', text: 'Get Out of Jail Free.', action: { type: 'get_out_of_jail' } },
    { id: 'cc-6', text: 'Go to Jail. Do not pass GO.', action: { type: 'go_to_jail' } },
    { id: 'cc-7', text: 'Grand Opera Night - collect $50 from every other player.', action: { type: 'collect_from_each', amount: 50 } },
    { id: 'cc-8', text: 'Holiday fund matures - collect $100.', action: { type: 'collect', amount: 100 } },
    { id: 'cc-9', text: 'Income tax refund - collect $20.', action: { type: 'collect', amount: 20 } },
    { id: 'cc-10', text: 'It is your birthday - collect $10 from every other player.', action: { type: 'collect_from_each', amount: 10 } },
    { id: 'cc-11', text: 'Life insurance matures - collect $100.', action: { type: 'collect', amount: 100 } },
    { id: 'cc-12', text: 'Pay hospital fees of $100.', action: { type: 'pay', amount: 100 } },
    { id: 'cc-13', text: 'Pay school fees of $150.', action: { type: 'pay', amount: 150 } },
    { id: 'cc-14', text: 'Receive $25 consultancy fee.', action: { type: 'collect', amount: 25 } },
    { id: 'cc-15', text: 'You are assessed for street repairs - $40 per house, $115 per hotel.', action: { type: 'repairs', perHouse: 40, perHotel: 115 } },
    { id: 'cc-16', text: 'You have won second prize in a beauty contest - collect $10.', action: { type: 'collect', amount: 10 } },
];

function shuffleDeck(arr) {
    const deck = arr.slice();
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

function findNearestType(currentPos, type) {
    for (let i = 1; i <= 40; i++) {
        const candidate = (currentPos + i) % 40;
        if (BOARD_SQUARES[candidate].type === type) return candidate;
    }
    return currentPos;
}

function randomDie() {
    return Math.floor(Math.random() * 6) + 1;
}

module.exports = {
    MONOPOLY_PROPERTIES,
    BOARD_SQUARES,
    HOUSE_COSTS,
    JAIL_FINE_AMOUNT,
    JAIL_CARD_ASSET_ID,
    CHANCE_CARDS,
    COMMUNITY_CHEST_CARDS,
    shuffleDeck,
    findNearestType,
    randomDie,
};
