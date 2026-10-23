// npm run seed  [--fresh] [--no-payouts]
//
// Creates the case in your PayPal sandbox: paid orders, refunds, an invoice and an
// affiliate payout batch, then writes case-data/ledger.json (the shop's own books).
// Re-running continues where it stopped; --fresh starts a new case.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { createClient, credentialsFromEnv, PayPalError } from './paypal.js';
import { CURRENCY, TEST_CARD, ORDERS, REFUNDS, INVOICES, COMMISSIONS } from '../case/seed-plan.js';

const OUT_DIR = new URL('../case-data/', import.meta.url);
const OUT = new URL('ledger.json', OUT_DIR);

const args = new Set(process.argv.slice(2));
const paypal = createClient(credentialsFromEnv());

async function load() {
  if (args.has('--fresh')) return null;
  try {
    return JSON.parse(await readFile(OUT, 'utf8'));
  } catch {
    return null;
  }
}

const state = (await load()) ?? {
  case_id: randomBytes(4).toString('hex'),
  created_at: new Date().toISOString(),
  currency: CURRENCY,
  invoices: {},
  orders: {},
  refunds: {},
  payouts: null,
};

async function save() {
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(OUT, JSON.stringify(state, null, 2) + '\n');
}

const rid = (key) => `${state.case_id}-${key}`;
const money = (value) => ({ currency_code: CURRENCY, value });

async function seedInvoice(inv) {
  if (state.invoices[inv.ref]) return;
  const [given_name, ...rest] = inv.recipient.name.split(' ');
  const draft = (number) => ({
    detail: { invoice_number: number, currency_code: CURRENCY, note: inv.note },
    invoicer: { business_name: 'Hoshino Paper Studio' },
    primary_recipients: [
      { billing_info: { name: { given_name, surname: rest.join(' ') }, email_address: inv.recipient.email } },
    ],
    items: inv.items.map((i) => ({ name: i.name, quantity: i.quantity, unit_amount: money(i.value) })),
  });
  let number = inv.ref;
  let body;
  try {
    body = await paypal.post('/v2/invoicing/invoices', draft(number));
  } catch (err) {
    if (!(err instanceof PayPalError) || err.issue !== 'DUPLICATE_INVOICE_NUMBER') throw err;
    // An earlier case in this sandbox already used the number.
    number = `${inv.ref}-${state.case_id.slice(0, 4).toUpperCase()}`;
    body = await paypal.post('/v2/invoicing/invoices', draft(number));
  }
  await paypal.post(`/v2/invoicing/invoices/${body.id}/send`, { send_to_recipient: false });
  state.invoices[inv.ref] = { invoice_id: body.id, invoice_number: number };
  await save();
  console.log(`invoice ${number}: ${body.id}`);
}

async function seedOrder(o) {
  if (state.orders[o.ref]) return;
  let description = o.item;
  for (const [ref, inv] of Object.entries(state.invoices)) description = description.replace(ref, inv.invoice_number);
  const body = await paypal.post(
    '/v2/checkout/orders',
    {
      intent: 'CAPTURE',
      payment_source: { card: { ...TEST_CARD, name: o.buyer } },
      purchase_units: [
        {
          reference_id: o.ref,
          custom_id: o.ref,
          description,
          amount: money(o.value),
          shipping: { name: { full_name: o.buyer }, address: o.ship },
        },
      ],
    },
    { requestId: rid(`order-${o.ref}`) },
  );
  const capture = body.purchase_units?.[0]?.payments?.captures?.[0];
  if (body.status !== 'COMPLETED' || capture?.status !== 'COMPLETED') {
    throw new Error(`${o.ref}: order ${body.id} is ${body.status}, capture ${capture?.status}`);
  }
  state.orders[o.ref] = { order_id: body.id, capture_id: capture.id };
  await save();
  console.log(`order ${o.ref}: ${body.id} (capture ${capture.id})`);
}

async function seedRefund(r) {
  const key = `${r.ref}:${r.staff}`;
  if (state.refunds[key]) return;
  const { capture_id } = state.orders[r.ref];
  const body = await paypal.post(
    `/v2/payments/captures/${capture_id}/refund`,
    { amount: money(r.value), note_to_payer: r.note, custom_id: `cs:${r.staff}` },
    { requestId: rid(`refund-${r.ref}-${r.staff}`) },
  );
  if (body.status !== 'COMPLETED') throw new Error(`${key}: refund ${body.id} is ${body.status}`);
  state.refunds[key] = { refund_id: body.id };
  await save();
  console.log(`refund ${key}: ${body.id}`);
}

async function seedPayouts() {
  if (state.payouts?.batch_id) return;
  const value = (ref) => (Number(ORDERS.find((o) => o.ref === ref).value) * COMMISSIONS.rate).toFixed(2);
  try {
    const body = await paypal.post('/v1/payments/payouts', {
      sender_batch_header: {
        sender_batch_id: rid('commissions'),
        email_subject: 'Your Hoshino Paper Studio referral commission',
      },
      items: COMMISSIONS.refs.map((ref) => ({
        recipient_type: 'EMAIL',
        receiver: COMMISSIONS.receiver,
        sender_item_id: ref,
        note: `Commission ${ref}`,
        amount: { currency: CURRENCY, value: value(ref) },
      })),
    });
    state.payouts = { batch_id: body.batch_header.payout_batch_id };
    console.log(`payouts: ${state.payouts.batch_id}`);
  } catch (err) {
    if (!(err instanceof PayPalError)) throw err;
    // The game still works without this side thread; say why it is missing.
    state.payouts = { error: err.message };
    console.warn(`payouts skipped: ${err.message}`);
  }
  await save();
}

for (const inv of INVOICES) await seedInvoice(inv);
for (const o of ORDERS) await seedOrder(o);
for (const r of REFUNDS) await seedRefund(r);
if (!args.has('--no-payouts')) await seedPayouts();

console.log(`case ${state.case_id}: ${Object.keys(state.orders).length} orders, ${Object.keys(state.refunds).length} refunds -> case-data/ledger.json`);
