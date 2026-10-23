// What `npm run seed` creates in the player's PayPal sandbox.
// Every name, address and shop here is fictional.
//
// The partner never reads this file. It only sees what PayPal returns for the
// ids on the shop's order sheet, the same as a person would.

export const CURRENCY = 'USD';

// Sandbox test card numbers are public test data from PayPal's docs; the name on
// the card is the buyer's name, which becomes a clue.
export const TEST_CARD = { number: '4111111111111111', expiry: '2030-12', security_code: '123' };

const RIVER_LANE = {
  address_line_1: '77 Kamo River Lane',
  address_line_2: 'Apt 4B',
  admin_area_2: 'Kyoto',
  admin_area_1: 'Kyoto',
  postal_code: '604-0000',
  country_code: 'JP',
};

export const ORDERS = [
  {
    ref: 'web#1031', buyer: 'Jamie Morgan', item: 'Washi notebook set (3)', value: '48.00',
    ship: { address_line_1: '1200 Alder Street', admin_area_2: 'Portland', admin_area_1: 'OR', postal_code: '97205', country_code: 'US' },
  },
  { ref: 'web#1032', buyer: 'Ryo Sato', item: 'Brass fountain pen gift set', value: '103.00', ship: RIVER_LANE },
  {
    ref: 'web#1033', buyer: 'Pilar Alvarez', item: 'Letterpress postcards (12)', value: '36.00',
    ship: { address_line_1: '58 Harbour Road', admin_area_2: 'Wellington', admin_area_1: 'Wellington', postal_code: '6011', country_code: 'NZ' },
  },
  { ref: 'web#1034', buyer: 'Ryo Sato', item: 'Brass fountain pen gift set', value: '103.00', ship: RIVER_LANE },
  {
    ref: 'web#1035', buyer: 'Mara Holt', item: 'Payment for invoice HPS-0042', value: '500.00',
    ship: { address_line_1: '9 Quarry Mews', admin_area_2: 'Leeds', admin_area_1: 'West Yorkshire', postal_code: 'LS6 2AA', country_code: 'GB' },
  },
  { ref: 'web#1036', buyer: 'Ryo Sato', item: 'Brass fountain pen gift set', value: '103.00', ship: RIVER_LANE },
  {
    ref: 'web#1037', buyer: 'Toby Brooks', item: 'Indigo-dyed desk blotter', value: '64.00',
    ship: { address_line_1: '410 Linden Avenue', admin_area_2: 'Madison', admin_area_1: 'WI', postal_code: '53703', country_code: 'US' },
  },
  { ref: 'web#1038', buyer: 'Ryo Sato', item: 'Brass fountain pen gift set', value: '103.00', ship: RIVER_LANE },
  { ref: 'web#1039', buyer: 'Kenji Ito', item: 'Staff purchase: ink refills (6)', value: '29.00', ship: RIVER_LANE },
];

// custom_id on a refund carries the staff code of whoever pressed the button.
export const REFUNDS = [
  { ref: 'web#1032', value: '103.00', staff: 'KI', note: 'Sorry it arrived damaged' },
  { ref: 'web#1034', value: '103.00', staff: 'KI', note: 'Sorry it arrived damaged' },
  { ref: 'web#1036', value: '103.00', staff: 'KI', note: 'Sorry it arrived damaged' },
  { ref: 'web#1038', value: '103.00', staff: 'KI', note: 'Sorry it arrived damaged' },
  { ref: 'web#1033', value: '6.00', staff: 'AH', note: 'Shipping overcharge, refunded the difference' },
];

export const INVOICES = [
  {
    ref: 'HPS-0042',
    recipient: { name: 'Mara Holt', email: 'mara.holt@example.com' },
    items: [{ name: 'Letterpress wedding cards x120', quantity: '1', value: '300.00' }],
    note: 'Thank you for your order. Cards ship within 10 days of payment.',
  },
];

// Affiliate commission at 10% of each order Lena referred, paid with Payouts.
// Four of them are for orders that were later refunded in full.
export const COMMISSIONS = {
  receiver: 'lena.chen@example.com',
  rate: 0.1,
  refs: ['web#1031', 'web#1032', 'web#1033', 'web#1034', 'web#1036', 'web#1037', 'web#1038'],
};
