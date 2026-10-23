// The clerk: the only process that can move money, and it is not an AI.
//
// The game may *propose* a refund. The clerk checks the proposal against its own
// policy, then waits for a person to press Approve on a page the clerk serves
// itself. Only that form submission executes the refund, once, and the result is
// read back from PayPal before it is reported.

import express from 'express';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createClient, credentialsFromEnv, PayPalError } from './paypal.js';
import { securityHeaders, errorHandler } from './http.js';

// What the clerk will ever refund in this case: the part of Mara Holt's payment
// that is above her invoice, back to the payment it came from. Nothing else.
export const POLICY = {
  'web#1035': { max: 200, invoice: 'HPS-0042' },
};

const escape = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(title)}</title><style>
body{font:16px/1.5 system-ui,sans-serif;max-width:36rem;margin:3rem auto;padding:0 1rem;color:#1d232b;background:#f6f4ef}
.card{background:#fff;border:1px solid #d9d4c7;border-radius:10px;padding:1.5rem}
h1{font-size:1.2rem;margin:0 0 1rem}dt{color:#5b6470;font-size:.85rem}dd{margin:0 0 .8rem;font-weight:600}
button{font:inherit;font-weight:600;padding:.7rem 1.2rem;border-radius:8px;border:0;background:#1f5f3f;color:#fff;cursor:pointer}
.note{color:#5b6470;font-size:.85rem;margin-top:1rem}.bad{color:#9b2c2c}
</style></head><body><div class="card">${body}</div></body></html>`;
}

// In the hosted demo every game has its own copy of web#1035, created by the
// desk; the clerk asks the desk which payment that is, never the game.
export function createClerkApp({ paypal, ledger, deskUrl = null, fetchImpl = fetch, log = console.log }) {
  const proposals = new Map();
  const app = express();
  app.use(securityHeaders);
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  async function orderFor(ref, session) {
    if (deskUrl && session) {
      const r = await fetchImpl(`${deskUrl}/sessions/${encodeURIComponent(session)}`);
      if (!r.ok) return null;
      return (await r.json()).orders?.[ref] ?? null;
    }
    return ledger.orders?.[ref] ?? null;
  }

  app.post('/proposals', async (req, res) => {
    const { ref, amount, session = null } = req.body ?? {};
    const rule = POLICY[ref];
    const order = rule ? await orderFor(ref, session) : null;
    const value = Number(amount);
    if (!rule || !order) return res.status(403).json({ error: `The clerk does not refund ${ref}.` });
    if (!(value > 0 && value <= rule.max)) return res.status(403).json({ error: `The clerk refunds at most $${rule.max.toFixed(2)} on ${ref}.` });
    if ([...proposals.values()].some((p) => p.ref === ref && p.session === session && p.status !== 'failed')) {
      return res.status(409).json({ error: `A refund on ${ref} has already been proposed.` });
    }
    const id = randomBytes(6).toString('hex');
    const invoice = ledger.invoices?.[rule.invoice]?.invoice_number ?? rule.invoice;
    const reason = `Overpayment above invoice ${invoice}, returned to the original payment`;
    const proposal = { id, ref, session, amount: value.toFixed(2), reason, invoice, order_id: order.order_id, capture_id: order.capture_id, status: 'pending', nonce: randomBytes(16).toString('hex') };
    proposals.set(id, proposal);
    log(`[clerk] proposal ${id}: refund $${proposal.amount} on ${ref} (waiting for a person)`);
    res.status(201).json({ id, status: proposal.status, approve_path: `approve/${id}` });
  });

  app.get('/proposals/:id', (req, res) => {
    const p = proposals.get(req.params.id);
    if (!p) return res.status(404).json({ error: 'No such proposal.' });
    const { nonce, session, ...visible } = p;
    res.json(visible);
  });

  app.get('/approve/:id', (req, res) => {
    const p = proposals.get(req.params.id);
    if (!p) return res.status(404).send(page('Not found', '<h1>No such proposal</h1>'));
    if (p.status !== 'pending') return res.redirect(303, `../done/${p.id}`);
    res.send(
      page(
        'Approve refund',
        `<h1>The clerk needs your approval</h1><dl>
<dt>Refund</dt><dd>$${escape(p.amount)} USD</dd>
<dt>To</dt><dd>the original payment on order ${escape(p.ref)} (capture ${escape(p.capture_id)})</dd>
<dt>Why</dt><dd>${escape(p.reason)}</dd></dl>
<form method="post" action=""><input type="hidden" name="nonce" value="${escape(p.nonce)}">
<button type="submit">Approve this refund</button></form>
<p class="note">Served by the clerk process. The AI partner cannot reach this page or this button.</p>`,
      ),
    );
  });

  app.post('/approve/:id', async (req, res) => {
    const p = proposals.get(req.params.id);
    if (!p || p.status !== 'pending' || req.body?.nonce !== p.nonce) {
      return res.status(403).send(page('Refused', '<h1 class="bad">Refused</h1><p>This approval is not valid.</p>'));
    }
    p.status = 'executing';
    try {
      // The clerk's own memory ends with the process; PayPal's record does not.
      // Refuse if this payment already carries a clerk refund.
      const order = await paypal.get(`/v2/checkout/orders/${p.order_id}`);
      const earlier = order.purchase_units?.[0]?.payments?.refunds ?? [];
      for (const r of earlier) {
        const full = await paypal.get(`/v2/payments/refunds/${r.id}`);
        if (full.custom_id === 'cs:CLERK') throw new Error(`Already refunded by the clerk: ${r.id}`);
      }
      const refund = await paypal.post(
        `/v2/payments/captures/${p.capture_id}/refund`,
        { amount: { currency_code: 'USD', value: p.amount }, note_to_payer: `Returning the amount you paid above invoice ${p.invoice}.`, custom_id: 'cs:CLERK' },
        { requestId: `clerk-${p.id}` },
      );
      const check = await paypal.get(`/v2/payments/refunds/${refund.id}`);
      Object.assign(p, { status: 'executed', refund_id: refund.id, paypal_status: check.status });
      log(`[clerk] executed ${p.id}: refund ${refund.id} ${check.status}`);
    } catch (err) {
      Object.assign(p, { status: 'failed', error: err instanceof PayPalError ? err.issue : err.message });
      log(`[clerk] failed ${p.id}: ${p.error}`);
    }
    res.redirect(303, `../done/${p.id}`);
  });

  app.get('/done/:id', (req, res) => {
    const p = proposals.get(req.params.id);
    if (!p) return res.status(404).send(page('Not found', '<h1>No such proposal</h1>'));
    const body =
      p.status === 'executed'
        ? `<h1>Refund sent</h1><dl><dt>PayPal refund</dt><dd>${escape(p.refund_id)}</dd><dt>Status read back from PayPal</dt><dd>${escape(p.paypal_status)}</dd></dl><p class="note">You can close this tab.</p>`
        : `<h1 class="bad">Refund not sent</h1><p>${escape(p.error ?? p.status)}</p>`;
    res.send(page('Clerk', body));
  });

  app.use(errorHandler(log));
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.CLERK_PORT ?? 3912);
  const ledger = JSON.parse(readFileSync(new URL('../case-data/ledger.json', import.meta.url), 'utf8'));
  const paypal = createClient(credentialsFromEnv());
  createClerkApp({ paypal, ledger, deskUrl: process.env.DESK_URL ?? null }).listen(port, '127.0.0.1', () => console.log(`[clerk] on http://127.0.0.1:${port}`));
}
