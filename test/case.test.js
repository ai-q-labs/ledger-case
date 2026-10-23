// The case itself: the books add up, the partner is told nothing it should not
// know, the grader needs records the partner actually pulled, and the keyless
// mode reads the same PayPal fields the AI does.

import test from 'node:test';
import assert from 'node:assert/strict';
import { ORDERS, REFUNDS } from '../case/seed-plan.js';
import { SHEET, orderSheet, references } from '../case/briefing.js';
import { SUSPECTS } from '../case/suspects.js';
import { grade, TRUTH } from '../case/solution.js';
import { scriptedPartner, scriptedSuspect } from '../case/scripted.js';
import { partnerSystem, createGame } from '../src/game.js';

const sum = (xs) => xs.reduce((s, x) => s + Number(x), 0);

test('the books are $412.00 above PayPal once the $200 overpayment is set aside', () => {
  const captured = sum(ORDERS.map((o) => o.value));
  const refunded = sum(REFUNDS.map((r) => r.value));
  const booked = sum(SHEET.map((r) => r.booked));
  assert.equal((booked - (captured - refunded - 200)).toFixed(2), '412.00');
  assert.equal(sum(REFUNDS.filter((r) => r.staff === 'KI').map((r) => r.value)).toFixed(2), '412.00');
});

const ledger = {
  orders: Object.fromEntries(ORDERS.map((o, i) => [o.ref, { order_id: `ORDER${i}`, capture_id: `CAP${i}` }])),
  refunds: Object.fromEntries(REFUNDS.map((r, i) => [`${r.ref}:${r.staff}`, { refund_id: `REF${i}` }])),
  invoices: { 'HPS-0042': { invoice_id: 'INV2-X', invoice_number: 'HPS-0042' } },
  payouts: { batch_id: 'BATCHID1' },
};

test("the partner's instructions hold the books, not the answer", () => {
  const system = partnerSystem({ sheet: orderSheet(ledger), refs: references(ledger) });
  for (const row of SHEET) assert.ok(system.includes(row.ref));
  for (const secret of ['flatmate', 'You are guilty', 'Kamo River', 'pens are in your flat', ...TRUTH.map((t) => t.slice(0, 40))]) {
    assert.ok(!system.includes(secret), `partner prompt leaks: ${secret}`);
  }
  for (const s of Object.values(SUSPECTS)) assert.ok(!system.includes(s.card.slice(0, 60)));
});

test('the grader wants the money trail and the shared address', () => {
  assert.equal(grade({ culprit: 'kenji', evidence: ['web#1032', 'web#1034', 'web#1039'] }).solved, true);
  assert.equal(grade({ culprit: 'kenji', evidence: ['web#1032', 'web#1034'] }).solved, false);
  assert.equal(grade({ culprit: 'kenji', evidence: ['web#1039'] }).solved, false);
  assert.equal(grade({ culprit: 'mara', evidence: ['web#1032', 'web#1034', 'web#1039'] }).solved, false);
});

// A PayPal stand-in that answers the reader's tools from the seed plan.
function fakeTools() {
  const byOrder = Object.fromEntries(ORDERS.map((o, i) => [`ORDER${i}`, o]));
  const refundsOf = (ref) => REFUNDS.map((r, i) => ({ ...r, id: `REF${i}` })).filter((r) => r.ref === ref);
  return async (name, args) => {
    if (name === 'get_order') {
      const o = byOrder[args.id];
      return {
        isError: false,
        text: JSON.stringify({
          id: args.id,
          status: 'COMPLETED',
          payment_source: { card: { name: o.buyer } },
          purchase_units: [{ shipping: { name: { full_name: o.buyer }, address: o.ship }, payments: { captures: [{ amount: { value: o.value } }], refunds: refundsOf(o.ref).map((r) => ({ id: r.id, amount: { value: r.value }, status: 'COMPLETED' })) } }],
        }),
      };
    }
    if (name === 'get_refund') {
      const r = REFUNDS[Number(args.refund_id.slice(3))];
      return { isError: false, text: JSON.stringify({ id: args.refund_id, amount: { value: r.value }, status: 'COMPLETED', custom_id: `cs:${r.staff}`, note_to_payer: r.note }) };
    }
    return { isError: true, text: 'not in this test' };
  };
}

test('keyless partner: "all orders" totals the refunds by staff code from PayPal fields', async () => {
  const out = await scriptedPartner({ text: 'Pull all orders and refunds', sheet: orderSheet(ledger), refs: references(ledger), callTool: fakeTools() });
  assert.match(out.reply, /cs:KI \$412\.00/);
  assert.match(out.reply, /cs:AH \$6\.00/);
  assert.equal(out.calls.filter((c) => c.name === 'get_order').length, ORDERS.length);
});

test('keyless Kenji gives way only to his order shown beside one of Ryo Sato\'s', () => {
  const confess = /flatmate/;
  assert.doesNotMatch(scriptedSuspect({ suspect: 'kenji', text: 'look', shown: ['web#1039'] }), confess);
  assert.doesNotMatch(scriptedSuspect({ suspect: 'kenji', text: 'do you know Ryo Sato?', shown: [] }), confess);
  assert.match(scriptedSuspect({ suspect: 'kenji', text: 'look', shown: ['web#1039', 'web#1036'] }), confess);
});

test('an accusation can only cite records the partner has pulled', async () => {
  const backend = { name: 'test', partnerTurn: async () => ({ reply: 'ok', calls: [] }), suspectTurn: async () => ({ reply: '...' }) };
  const { app } = createGame({ backend, ledger, readerUrl: 'http://127.0.0.1:9/mcp', clerkUrl: 'http://127.0.0.1:9' });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const cookie = (await fetch(`${base}/api/case`)).headers.get('set-cookie').split(';')[0];
  const headers = { 'Content-Type': 'application/json', cookie };
  const r = await fetch(`${base}/api/accuse`, { method: 'POST', headers, body: JSON.stringify({ culprit: 'kenji', evidence: ['web#1032', 'web#1034', 'web#1039'] }) });
  const body = await r.json();
  assert.equal(body.solved, false);
  assert.equal(body.truth, null);
  const settle = await fetch(`${base}/api/settle`, { method: 'POST', headers, body: '{}' });
  assert.equal(settle.status, 409, 'no refund can be proposed before the case is solved');
  server.close();
});
