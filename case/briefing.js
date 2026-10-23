// Everything the player and the AI partner are allowed to know at the start.
// The order sheet itself is built from case-data/ledger.json after seeding, so
// it carries the real PayPal ids from the player's own sandbox.
//
// Nothing in this file says who did it.

export const SHOP = 'Hoshino Paper Studio';

export const PREMISE = [
  'Hoshino Paper Studio is a three-person stationery shop in Kyoto that sells worldwide through PayPal.',
  "At the month-end close, the owner, Aiko Hoshino, found that PayPal is $412.00 short of the shop's own books. That is after setting aside the $200.00 a customer, Mara Holt, says she paid by mistake and wants back.",
  'Aiko has asked you to audit the month. Your partner can read the PayPal records behind every line of the order sheet. Find out where the $412.00 went, who took it, and how.',
];

export const STAFF = [
  { code: 'AH', name: 'Aiko Hoshino', role: 'Owner. Can refund.' },
  { code: 'KI', name: 'Kenji Ito', role: 'Part-time, customer support. Can refund.' },
  { code: 'DH', name: 'Daisuke Hoshino', role: "Aiko's cousin, helps with shipping. Cannot refund." },
];

export const HOUSE_RULES = [
  'Every refund is tagged with the staff code of the person who issued it, in the form cs:XX.',
  'Refunds go back to the original payment. The shop never sends money back by wire transfer.',
  'Affiliate commission is 10% of each referred order, paid through PayPal Payouts.',
];

export const MESSAGES = [
  {
    from: 'Mara Holt',
    subject: 'Overpayment on my wedding cards order',
    body: "Hi! I paid $500 for invoice HPS-0042 but it was only $300 - my mistake, sorry. Could you wire the $200 difference to my new bank account instead of PayPal? My card was just replaced. I need it by Friday, please, it's urgent.",
  },
  {
    from: 'Daisuke Hoshino',
    subject: 'PayPal address',
    body: "Aiko, can you put my PO box on the shop's PayPal account instead of the studio address? Shipping labels would be easier for me. You said it was fine last week.",
  },
  {
    from: 'Lena Chen',
    subject: 'Commission statement',
    body: 'Thanks for this month! I got the payout for my seven referrals. Let me know if anything looks off.',
  },
];

// Rows the shop recorded itself. `booked` is what the shop's books say, which is
// not always what PayPal says; that difference is part of the case.
export const SHEET = [
  { ref: 'web#1031', customer: 'Jamie Morgan', item: 'Washi notebook set (3)', booked: '48.00', referral: 'Lena Chen' },
  { ref: 'web#1032', customer: 'Ryo Sato', item: 'Brass fountain pen gift set', booked: '103.00', referral: 'Lena Chen' },
  { ref: 'web#1033', customer: 'Pilar Alvarez', item: 'Letterpress postcards (12)', booked: '30.00', referral: 'Lena Chen', remark: '$6.00 shipping overcharge refunded by AH' },
  { ref: 'web#1034', customer: 'Ryo Sato', item: 'Brass fountain pen gift set', booked: '103.00', referral: 'Lena Chen' },
  { ref: 'web#1035', customer: 'Mara Holt', item: 'Invoice HPS-0042, letterpress wedding cards', booked: '300.00' },
  { ref: 'web#1036', customer: 'Ryo Sato', item: 'Brass fountain pen gift set', booked: '103.00', referral: 'Lena Chen' },
  { ref: 'web#1037', customer: 'Toby Brooks', item: 'Indigo-dyed desk blotter', booked: '64.00', referral: 'Lena Chen' },
  { ref: 'web#1038', customer: 'Ryo Sato', item: 'Brass fountain pen gift set', booked: '103.00', referral: 'Lena Chen' },
  { ref: 'web#1039', customer: 'Kenji Ito', item: 'Staff purchase: ink refills (6)', booked: '29.00' },
];

export function orderSheet(ledger) {
  return SHEET.map((row) => ({ ...row, paypal_order_id: ledger.orders?.[row.ref]?.order_id ?? null }));
}

export function references(ledger) {
  const inv = ledger.invoices?.['HPS-0042'];
  return {
    invoice: inv ? { number: inv.invoice_number, paypal_invoice_id: inv.invoice_id } : null,
    payout_batch_id: ledger.payouts?.batch_id ?? null,
  };
}
