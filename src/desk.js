// The desk: used by the hosted demo so that every visitor can play to the end.
//
// The seeded case is shared and only ever read. The one record the ending
// changes is Mara Holt's $500 payment (the clerk refunds $200 of it), so the desk
// creates a fresh copy of that order for each new game. It holds PayPal
// credentials, is not an AI, and listens on localhost only.

import express from 'express';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createClient, credentialsFromEnv } from './paypal.js';
import { CURRENCY, TEST_CARD, ORDERS } from '../case/seed-plan.js';

const MARA = ORDERS.find((o) => o.ref === 'web#1035');

export function createDeskApp({ paypal, invoiceNumber = 'HPS-0042', maxPerHour = 60, maxSessions = 500, log = console.log }) {
  const sessions = new Map();
  let hour = { start: Date.now(), count: 0 };
  const app = express();
  app.use(express.json());

  app.post('/sessions', async (_req, res) => {
    if (Date.now() - hour.start > 3_600_000) hour = { start: Date.now(), count: 0 };
    if (hour.count >= maxPerHour) return res.status(429).json({ error: 'Too many new games this hour. Try again later.' });
    hour.count += 1;
    const sid = randomBytes(16).toString('hex');
    const body = await paypal.post(
      '/v2/checkout/orders',
      {
        intent: 'CAPTURE',
        payment_source: { card: { ...TEST_CARD, name: MARA.buyer } },
        purchase_units: [
          {
            reference_id: MARA.ref,
            custom_id: MARA.ref,
            description: MARA.item.replace('HPS-0042', invoiceNumber),
            amount: { currency_code: CURRENCY, value: MARA.value },
            shipping: { name: { full_name: MARA.buyer }, address: MARA.ship },
          },
        ],
      },
      { requestId: `desk-${sid}` },
    );
    const capture = body.purchase_units?.[0]?.payments?.captures?.[0];
    if (body.status !== 'COMPLETED' || capture?.status !== 'COMPLETED') {
      return res.status(502).json({ error: `PayPal did not complete the order (${body.status}).` });
    }
    sessions.set(sid, { order_id: body.id, capture_id: capture.id, created: Date.now() });
    if (sessions.size > maxSessions) sessions.delete(sessions.keys().next().value);
    log(`[desk] new game ${sid.slice(0, 8)}: web#1035 is ${body.id}`);
    res.status(201).json({ sid, orders: { [MARA.ref]: { order_id: body.id, capture_id: capture.id } } });
  });

  app.get('/sessions/:sid', (req, res) => {
    const s = sessions.get(req.params.sid);
    if (!s) return res.status(404).json({ error: 'No such game.' });
    res.json({ orders: { [MARA.ref]: { order_id: s.order_id, capture_id: s.capture_id } } });
  });

  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.DESK_PORT ?? 3913);
  const paypal = createClient(credentialsFromEnv());
  const app = createDeskApp({ paypal, invoiceNumber: process.env.LEDGER_INVOICE_NUMBER ?? 'HPS-0042' });
  app.listen(port, '127.0.0.1', () => console.log(`[desk] on http://127.0.0.1:${port}`));
}
