// The hosted demo's extra guards: one game per browser, a fresh copy of the
// refundable payment per game, per-game question limits, and a clerk that takes
// the payment from the desk rather than from the game. No network, no keys.

import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createGame } from '../src/game.js';
import { createClerkApp } from '../src/clerk.js';

async function serve(app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

const ledger = {
  orders: { 'web#1035': { order_id: 'SHARED1035', capture_id: 'SHAREDCAP' }, 'web#1032': { order_id: 'O1032', capture_id: 'C1032' } },
  refunds: {},
  invoices: { 'HPS-0042': { invoice_id: 'INV2-X', invoice_number: 'HPS-0042' } },
  payouts: null,
};

function fakeDesk() {
  const made = [];
  const app = express();
  app.post('/sessions', (_req, res) => {
    const n = made.length + 1;
    const sid = String(n).padStart(32, 'a');
    made.push(sid);
    res.status(201).json({ sid, orders: { 'web#1035': { order_id: `DESK${n}`, capture_id: `DESKCAP${n}` } } });
  });
  app.get('/sessions/:sid', (req, res) => {
    const n = made.indexOf(req.params.sid) + 1;
    if (!n) return res.status(404).json({ error: 'No such game.' });
    res.json({ orders: { 'web#1035': { order_id: `DESK${n}`, capture_id: `DESKCAP${n}` } } });
  });
  return { app, made };
}

const backend = { name: 'test', partnerTurn: async () => ({ reply: 'ok', calls: [] }), suspectTurn: async () => ({ reply: '...' }) };

test('each browser gets its own game and its own copy of Mara Holt\'s payment', async () => {
  const desk = fakeDesk();
  const d = await serve(desk.app);
  const { app } = createGame({ backend, ledger, readerUrl: 'http://127.0.0.1:9/mcp', clerkUrl: 'http://127.0.0.1:9', deskUrl: d.base });
  const g = await serve(app);
  const a = await fetch(`${g.base}/api/case`);
  const b = await fetch(`${g.base}/api/case`);
  const rowA = (await a.json()).sheet.find((r) => r.ref === 'web#1035');
  const rowB = (await b.json()).sheet.find((r) => r.ref === 'web#1035');
  assert.equal(rowA.paypal_order_id, 'DESK1');
  assert.equal(rowB.paypal_order_id, 'DESK2');
  assert.notEqual(a.headers.get('set-cookie').split(';')[0], b.headers.get('set-cookie').split(';')[0]);
  assert.match(a.headers.get('set-cookie'), /HttpOnly/);
  assert.equal(a.headers.get('x-content-type-options'), 'nosniff');
  assert.match(a.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  const noCookie = await fetch(`${g.base}/api/state`);
  assert.equal(noCookie.status, 409, 'API calls without a game are refused, not given a shared one');
  g.close();
  d.close();
});

test('a game stops answering after its question limit', async () => {
  const { app } = createGame({ backend, ledger, readerUrl: 'http://127.0.0.1:9/mcp', clerkUrl: 'http://127.0.0.1:9', limits: { partnerTurns: 2 } });
  const g = await serve(app);
  const cookie = (await fetch(`${g.base}/api/case`)).headers.get('set-cookie').split(';')[0];
  const ask = () => fetch(`${g.base}/api/partner`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ text: 'hello' }) });
  // The reader is unreachable in this test, so a turn may fail, but it still counts.
  await ask();
  await ask();
  const third = await ask();
  assert.equal(third.status, 429);
  assert.match((await third.json()).error, /question limit/);
  g.close();
});

test('new games from one address are rate-limited', async () => {
  const { app } = createGame({ backend, ledger, readerUrl: 'http://127.0.0.1:9/mcp', clerkUrl: 'http://127.0.0.1:9', limits: { newGamesPerIpPerHour: 2 } });
  const g = await serve(app);
  assert.equal((await fetch(`${g.base}/api/case`)).status, 200);
  assert.equal((await fetch(`${g.base}/api/case`)).status, 200);
  assert.equal((await fetch(`${g.base}/api/case`)).status, 429);
  g.close();
});

test('with a desk, the clerk refunds the payment the desk made for that game, and nothing for an unknown game', async () => {
  const desk = fakeDesk();
  const d = await serve(desk.app);
  await fetch(`${d.base}/sessions`, { method: 'POST' });
  const posts = [];
  const paypal = {
    async post(path, body) {
      posts.push(path);
      return { id: 'R1', status: 'COMPLETED' };
    },
    async get(path) {
      return path.includes('/checkout/orders/') ? { purchase_units: [{ payments: { refunds: [] } }] } : { status: 'COMPLETED' };
    },
  };
  const c = await serve(createClerkApp({ paypal, ledger, deskUrl: d.base, log: () => {} }));
  const json = (body) => fetch(`${c.base}/proposals`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await json({ ref: 'web#1035', amount: '200.00', session: 'f'.repeat(32) })).status, 403);
  const ok = await json({ ref: 'web#1035', amount: '200.00', session: desk.made[0], capture_id: 'SOMETHING_ELSE' });
  assert.equal(ok.status, 201);
  const { id } = await ok.json();
  const nonce = (await (await fetch(`${c.base}/approve/${id}`)).text()).match(/name="nonce" value="([0-9a-f]+)"/)[1];
  await fetch(`${c.base}/approve/${id}`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `nonce=${nonce}` });
  assert.deepEqual(posts, ['/v2/payments/captures/DESKCAP1/refund'], 'the capture comes from the desk, not from the request');
  c.close();
  d.close();
});

test('the game passes only the approval token through to the clerk', async () => {
  const seen = [];
  const fetchSpy = async (url, init = {}) => {
    seen.push({ url, method: init.method, body: init.body });
    return new Response('<p>ok</p>', { status: 200, headers: { 'content-type': 'text/html' } });
  };
  const { app } = createGame({ backend, ledger, readerUrl: 'http://127.0.0.1:9/mcp', clerkUrl: 'http://clerk.test', fetchImpl: fetchSpy });
  const g = await serve(app);
  await fetch(`${g.base}/clerk/approve/0123456789ab`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'nonce=abc&amount=999&ref=web%231032' });
  assert.equal((await fetch(`${g.base}/clerk/approve/not-an-id`)).status, 404);
  assert.deepEqual(seen, [{ url: 'http://clerk.test/approve/0123456789ab', method: 'POST', body: 'nonce=abc' }]);
  g.close();
});
