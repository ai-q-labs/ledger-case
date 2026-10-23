// The fence, checked mechanically: what the partner can call, what the game
// process holds, and what the clerk will and will not do. No network, no keys.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer, READER_TOOLS } from '../src/reader.js';
import { gameEnv, assertNoPayPalCredentials, ledgerFromEnv } from '../src/env.js';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClerkApp } from '../src/clerk.js';

const MOVES_MONEY = ['create_refund', 'pay_order', 'create_order', 'send_invoice', 'record_payment_for_invoice', 'record_refund_for_invoice', 'create_invoice', 'cancel_sent_invoice', 'accept_dispute_claim', 'create_subscription', 'update_invoicing', 'delete_invoice'];

test('the reader lists exactly the read-only tools, and nothing that moves money', async () => {
  const server = buildServer({ accessToken: 'offline-test', paypal: { get: async () => ({}) } });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(b);
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, [...READER_TOOLS].sort());
  for (const name of MOVES_MONEY) assert.ok(!names.includes(name), `${name} must not be exposed`);
  await client.close();
});

test('the game environment carries no PayPal variable, and the game refuses one', () => {
  const env = gameEnv({ PATH: '/bin', ANTHROPIC_API_KEY: 'k', PAYPAL_CLIENT_ID: 'id', PAYPAL_CLIENT_SECRET: 's', PAYPAL_ANYTHING: 'x' });
  assert.deepEqual(Object.keys(env).sort(), ['ANTHROPIC_API_KEY', 'PATH']);
  assert.doesNotThrow(() => assertNoPayPalCredentials(env));
  assert.throws(() => assertNoPayPalCredentials({ PAYPAL_CLIENT_SECRET: 's' }), /must not hold PayPal credentials/);
});

const ledger = {
  orders: { 'web#1035': { order_id: 'ORDER1035', capture_id: 'CAP1035' }, 'web#1032': { order_id: 'ORDER1032', capture_id: 'CAP1032' } },
  invoices: { 'HPS-0042': { invoice_id: 'INV2-X', invoice_number: 'HPS-0042' } },
};

function fakePayPal({ earlier = [] } = {}) {
  const posts = [];
  return {
    posts,
    async post(path, body, opts) {
      posts.push({ path, body, opts });
      return { id: 'REFUND1', status: 'COMPLETED' };
    },
    async get(path) {
      if (path.startsWith('/v2/checkout/orders/')) return { purchase_units: [{ payments: { refunds: earlier.map((e) => ({ id: e.id })) } }] };
      const id = path.split('/').pop();
      const e = earlier.find((x) => x.id === id);
      return e ? { id, custom_id: e.custom_id, status: 'COMPLETED' } : { id, status: 'COMPLETED' };
    },
  };
}

async function serve(app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

const json = (base, path, body) =>
  fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('the clerk refuses anything outside its policy', async () => {
  const paypal = fakePayPal();
  const { base, close } = await serve(createClerkApp({ paypal, ledger, log: () => {} }));
  assert.equal((await json(base, '/proposals', { ref: 'web#1032', amount: '10.00' })).status, 403);
  assert.equal((await json(base, '/proposals', { ref: 'web#1035', amount: '200.01' })).status, 403);
  assert.equal((await json(base, '/proposals', { ref: 'web#1035', amount: '200.00' })).status, 201);
  assert.equal((await json(base, '/proposals', { ref: 'web#1035', amount: '50.00' })).status, 409);
  assert.equal(paypal.posts.length, 0, 'a proposal alone moves no money');
  close();
});

test('only the approval form with the right nonce executes the refund, once, and it is read back', async () => {
  const paypal = fakePayPal();
  const { base, close } = await serve(createClerkApp({ paypal, ledger, log: () => {} }));
  const { id } = await (await json(base, '/proposals', { ref: 'web#1035', amount: '200.00' })).json();
  const page = await (await fetch(`${base}/approve/${id}`)).text();
  const nonce = page.match(/name="nonce" value="([0-9a-f]+)"/)[1];
  const form = (n) => fetch(`${base}/approve/${id}`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `nonce=${n}` });
  assert.equal((await form('0'.repeat(32))).status, 403);
  assert.equal(paypal.posts.length, 0);
  assert.equal((await form(nonce)).status, 303);
  assert.equal(paypal.posts.length, 1);
  assert.equal(paypal.posts[0].path, '/v2/payments/captures/CAP1035/refund');
  assert.deepEqual(paypal.posts[0].body.amount, { currency_code: 'USD', value: '200.00' });
  assert.equal((await form(nonce)).status, 403, 'the same approval cannot run twice');
  const status = await (await fetch(`${base}/proposals/${id}`)).json();
  assert.equal(status.status, 'executed');
  assert.equal(status.paypal_status, 'COMPLETED');
  assert.equal(status.nonce, undefined, 'the nonce is never returned to the game');
  close();
});

test('a restarted clerk will not refund the same payment twice', async () => {
  const paypal = fakePayPal({ earlier: [{ id: 'OLD1', custom_id: 'cs:CLERK' }] });
  const { base, close } = await serve(createClerkApp({ paypal, ledger, log: () => {} }));
  const { id } = await (await json(base, '/proposals', { ref: 'web#1035', amount: '200.00' })).json();
  const nonce = (await (await fetch(`${base}/approve/${id}`)).text()).match(/name="nonce" value="([0-9a-f]+)"/)[1];
  await fetch(`${base}/approve/${id}`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `nonce=${nonce}` });
  assert.equal(paypal.posts.length, 0);
  const status = await (await fetch(`${base}/proposals/${id}`)).json();
  assert.equal(status.status, 'failed');
  assert.match(status.error, /Already refunded by the clerk/);
  close();
});

test('a hosted restart can reuse a seeded case from LEDGER_JSON, and rejects anything else', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-case-test-'));
  const path = join(dir, 'case-data', 'ledger.json');
  const ledger = { case_id: 'abcd1234', orders: { 'web#1031': { order_id: 'O', capture_id: 'C' } }, refunds: {}, invoices: {} };
  assert.equal(ledgerFromEnv(path, {}), null);
  assert.equal(existsSync(path), false);
  assert.throws(() => ledgerFromEnv(path, { LEDGER_JSON: '{"PAYPAL_CLIENT_SECRET":"x"}' }), /not a seeded ledger/);
  assert.equal(ledgerFromEnv(path, { LEDGER_JSON: JSON.stringify(ledger) }), 'abcd1234');
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), ledger);
  assert.equal(ledgerFromEnv(path, { LEDGER_JSON: JSON.stringify({ ...ledger, case_id: 'other' }) }), null, 'an existing case is never overwritten');
});
