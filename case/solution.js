// Read only by the grader in the game process. Never put into any model's context.

export const CULPRIT = 'kenji';

// Each line of reasoning is satisfied by showing at least one of the records
// listed, by its ref on the shop's order sheet.
export const LINES = {
  amount: {
    label: 'The four full refunds on Ryo Sato\'s orders add up to the $412.00 gap',
    refs: ['web#1032', 'web#1034', 'web#1036', 'web#1038'],
    min: 2,
  },
  tag: {
    label: 'Those refunds carry Kenji\'s staff code, cs:KI, while Aiko tags hers cs:AH',
    refs: ['web#1032', 'web#1034', 'web#1036', 'web#1038', 'web#1033'],
    min: 1,
  },
  address: {
    label: "Kenji's own order ships to the same flat as Ryo Sato's orders",
    refs: ['web#1039'],
    min: 1,
  },
};

export function grade({ culprit, evidence = [] }) {
  const shown = new Set(evidence);
  const lines = Object.fromEntries(
    Object.entries(LINES).map(([key, line]) => [key, line.refs.filter((r) => shown.has(r)).length >= line.min]),
  );
  const right = culprit === CULPRIT;
  const solved = right && lines.amount && lines.address;
  return { right_person: right, solved, lines };
}

export const TRUTH = [
  "Kenji Ito had his flatmate, Ryo Sato, buy the $103 brass pen set four times. After each one shipped, Kenji refunded it in full as 'arrived damaged' and tagged the refund with his own code, KI. 4 x $103.00 = $412.00, and the pens never left the flat at 77 Kamo River Lane.",
  'The other three were not the thief, but each was a real warning sign that PayPal tells sellers about: Mara Holt overpaid a $300 invoice by $200 and asked for the difference by wire, the classic overpayment scam. Daisuke wanted a stranger\'s parcel scheme on the shop\'s PayPal address. Lena was honestly paid commission on four orders that were later refunded, $41.20 too much.',
];
