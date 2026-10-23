// The keyless mode. No model runs: the partner turns a question into real PayPal
// reads by fixed rules and reports the fields, and each suspect answers from fixed
// lines. The PayPal side is identical to the AI mode; only the talking is canned.

const REF = /web#\s?(10\d\d)/gi;

function parse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const usd = (n) => `$${Number(n).toFixed(2)}`;

function addressLine(a = {}) {
  return [a.address_line_2, a.address_line_1, a.admin_area_2, a.country_code].filter(Boolean).join(', ');
}

export async function scriptedPartner({ text, sheet, refs, callTool }) {
  const calls = [];
  const call = async (name, args) => {
    const out = await callTool(name, args);
    calls.push({ name, args, ok: !out.isError });
    return out.isError ? null : parse(out.text);
  };

  const wanted = new Set([...text.matchAll(REF)].map((m) => `web#${m[1]}`));
  const lower = text.toLowerCase();
  if (!wanted.size && /\b(all|every|each|month)\b/.test(lower) && /order|refund|sale/.test(lower)) {
    for (const row of sheet) wanted.add(row.ref);
  }
  const lines = [];
  const totals = { captured: 0, refunded: 0, byTag: {} };

  for (const row of sheet.filter((r) => wanted.has(r.ref))) {
    const order = await call('get_order', { id: row.paypal_order_id });
    if (!order) {
      lines.push(`${row.ref}: PayPal did not return the order.`);
      continue;
    }
    const unit = order.purchase_units?.[0] ?? {};
    const capture = unit.payments?.captures?.[0];
    totals.captured += Number(capture?.amount?.value ?? 0);
    const parts = [
      `${row.ref} (${order.id}): ${order.status}, card name "${order.payment_source?.card?.name ?? '-'}", captured ${usd(capture?.amount?.value ?? 0)}`,
      `ships to ${unit.shipping?.name?.full_name ?? '-'}, ${addressLine(unit.shipping?.address)}`,
    ];
    for (const r of unit.payments?.refunds ?? []) {
      const refund = await call('get_refund', { refund_id: r.id });
      const tag = refund?.custom_id ?? '(no tag)';
      totals.refunded += Number(r.amount?.value ?? 0);
      totals.byTag[tag] = (totals.byTag[tag] ?? 0) + Number(r.amount?.value ?? 0);
      parts.push(`refund ${r.id}: ${usd(r.amount?.value ?? 0)} ${r.status}, tagged ${tag}, note "${refund?.note_to_payer ?? ''}"`);
    }
    if (Number(capture?.amount?.value ?? 0).toFixed(2) !== Number(row.booked).toFixed(2) && !(unit.payments?.refunds ?? []).length) {
      parts.push(`note: the books say ${usd(row.booked)} for this order`);
    }
    lines.push(parts.join('; '));
  }
  if (wanted.size > 1) {
    const tags = Object.entries(totals.byTag).map(([t, v]) => `${t} ${usd(v)}`).join(', ');
    lines.push(`Totals for these ${wanted.size} orders: captured ${usd(totals.captured)}, refunded ${usd(totals.refunded)}${tags ? ` (${tags})` : ''}.`);
  }

  if (/invoice|hps-?0042/i.test(text) && refs.invoice) {
    const inv = await call('get_invoice', { invoice_id: refs.invoice.paypal_invoice_id });
    if (inv) {
      const items = (inv.items ?? []).map((i) => `${i.name} x${i.quantity} at ${usd(i.unit_amount?.value ?? 0)}`).join('; ');
      lines.push(`Invoice ${inv.detail?.invoice_number}: ${inv.status}, total ${usd(inv.amount?.value ?? 0)}, to ${inv.primary_recipients?.[0]?.billing_info?.email_address ?? '-'}, items: ${items}`);
    }
  }
  if (/payout|commission|lena|affiliate/i.test(text) && refs.payout_batch_id) {
    const batch = await call('get_payout_batch', { payout_batch_id: refs.payout_batch_id });
    if (batch) {
      const items = (batch.items ?? []).map((i) => `${i.payout_item?.note ?? i.payout_item?.sender_item_id}: ${usd(i.payout_item?.amount?.value ?? 0)}`);
      const sum = (batch.items ?? []).reduce((s, i) => s + Number(i.payout_item?.amount?.value ?? 0), 0);
      lines.push(`Payout batch ${batch.batch_header?.payout_batch_id}: ${batch.batch_header?.batch_status}, ${items.length} items totalling ${usd(sum)}: ${items.join('; ')}`);
    }
  }

  if (!lines.length) {
    return {
      reply:
        'Tell me which records to pull: an order number from the sheet (for example web#1032), "all orders", the invoice HPS-0042, or Lena\'s payout batch. In this mode I only read PayPal; I do not interpret.',
      calls,
    };
  }
  return { reply: lines.join('\n'), calls };
}

const SCRIPT = {
  aiko: {
    shown: {},
    topics: [
      [/login|share|password/, "I never share my login. Kenji has his own; that's the whole point of the staff codes."],
      [/tag|code|\bah\b|\bki\b|cs:/, "Every refund gets a code. Mine is AH, Kenji's is KI. Daisuke can't refund at all."],
      [/daisuke|po box|address/, "I never agreed to change the PayPal address. He asked, and I said I'd think about it."],
      [/mara|wire|overpa/, 'She wants a wire transfer. We never wire money back; refunds go to the original payment.'],
      [/ryo|sato/, "I don't know him. Four pen sets in one month is a lot, now that you mention it."],
      [/kenji/, "Kenji's been with us eight months. He answers customer emails and sorts out damage claims."],
      [/lena|commission|affiliate/, 'Lena gets 10% of every order her blog sends us, through PayPal Payouts.'],
    ],
    fallback: 'Ask me anything about how the shop runs.',
  },
  kenji: {
    // He gives way only when his own order and one of Ryo Sato's are shown together.
    combos: [
      {
        all: ['web#1039'],
        any: ['web#1032', 'web#1034', 'web#1036', 'web#1038'],
        line: "...Same flat. Okay. Ryo is my flatmate. I refunded his four pen sets as 'damaged' and he kept them. I was going to pay it back, I swear.",
      },
    ],
    shown: {
      'web#1039': "That's a staff order, ink refills. It shipped to my flat. So?",
      'web#1033': "Fine, Aiko tags her own refunds AH. So the login isn't shared. That still doesn't make me a thief.",
      'web#1032': 'A damage claim. The customer said it arrived broken, I refunded it. That is literally my job.',
      'web#1034': 'Another damage claim. Couriers are rough with brass pens.',
      'web#1036': 'Damage claim. I process what customers send me.',
      'web#1038': 'Damage claim. Same as the others.',
    },
    topics: [
      [/ryo|sato/, 'Ryo Sato? Never met him. Just a customer with bad luck with couriers.'],
      [/login|share|tag|code|\bki\b|cs:/, 'Aiko and I share the refund login, so the code on a refund doesn\'t really say who pressed the button.'],
      [/damage|broken|refund|pen/, "Damage claims are routine. Customers email a photo, I refund. I don't make the rules."],
      [/address|live|flat|home|kamo/, 'I live near the river. Why do you ask?'],
    ],
    fallback: 'Happy to help. What do you need?',
  },
  mara: {
    shown: { 'web#1035': "Yes, that's my payment. So you can see I overpaid. Wire the difference, please." },
    topics: [
      [/original|card|back to|to the payment|refund it/, "No, no, my card was replaced, a refund won't reach me. A wire is much easier. Can you do it today?"],
      [/why|how|mistake|500|typo/, 'I typed 500 instead of 300. Silly me. Please just wire the 200, I am in a hurry.'],
      [/bank|account|wire/, "I'll send the new account number right away. Today, if possible."],
    ],
    fallback: 'I just want my 200 back, quickly.',
  },
  daisuke: {
    shown: {},
    topics: [
      [/aiko|agree|said|deny|denies|stranger|why/, "...Okay, she didn't actually agree. A guy online said he'd pay me to receive parcels if my box was on a business account. It sounded easy. Nothing's been changed."],
      [/pen|pack|broken|damage/, 'Every pen set left in its box, padded. I am sure of it. Funny thing: Kenji always handles those damage claims himself.'],
      [/po box|address|label/, "It's just easier for shipping labels. Aiko said it was fine."],
    ],
    fallback: "I pack and ship. If something's broken, it wasn't broken when it left.",
  },
  lena: {
    shown: {},
    topics: [
      [/refund|four|pen|overpa|too much/, "Oh! I didn't know those were refunded. Take the extra commission off next month, of course."],
      [/ryo|sato/, 'No idea who that is. My blog just has the referral link.'],
      [/payout|commission|seven/, 'Seven referrals this month, paid through PayPal Payouts. Thanks!'],
    ],
    fallback: 'Happy to help!',
  },
};

export function scriptedSuspect({ suspect, text, shown = [] }) {
  const s = SCRIPT[suspect];
  for (const c of s.combos ?? []) {
    if (c.all.every((r) => shown.includes(r)) && c.any.some((r) => shown.includes(r))) return c.line;
  }
  for (const ref of shown) if (s.shown[ref]) return s.shown[ref];
  const lower = text.toLowerCase();
  for (const [re, line] of s.topics) if (re.test(lower)) return line;
  return s.fallback;
}
