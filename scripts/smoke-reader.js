// npm run smoke:reader
// Starts the reader in-process, connects as an MCP client the way the partner does,
// and reads back a few records from case-data/ledger.json. Prints statuses only.

import { readFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createClient, credentialsFromEnv } from '../src/paypal.js';
import { createReaderApp } from '../src/reader.js';

const ledger = JSON.parse(await readFile(new URL('../case-data/ledger.json', import.meta.url), 'utf8'));
const paypal = createClient(credentialsFromEnv());
const server = createReaderApp({ paypal }).listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const url = new URL(`http://127.0.0.1:${server.address().port}/mcp`);

const client = new Client({ name: 'smoke', version: '0' });
await client.connect(new StreamableHTTPClientTransport(url));
const { tools } = await client.listTools();
console.log('tools:', tools.map((t) => t.name).join(', '));

async function call(name, args) {
  const out = await client.callTool({ name, arguments: args });
  const text = out.content?.[0]?.text ?? '';
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 200) };
  }
  return { isError: Boolean(out.isError), body };
}

const first = Object.entries(ledger.orders)[1];
const order = await call('get_order', { id: first[1].order_id });
const unit = order.body.purchase_units?.[0];
console.log('get_order', first[0], order.isError ? order.body : {
  status: order.body.status,
  custom_id: unit?.custom_id,
  ship_to: unit?.shipping?.address?.address_line_1,
  card_name: order.body.payment_source?.card?.name,
  captures: unit?.payments?.captures?.length,
  refunds: unit?.payments?.refunds?.length ?? 0,
});

for (const [key, r] of Object.entries(ledger.refunds).slice(0, 1)) {
  const refund = await call('get_refund', { refund_id: r.refund_id });
  console.log('get_refund', key, refund.isError ? refund.body : { status: refund.body.status, custom_id: refund.body.custom_id });
}
for (const [ref, inv] of Object.entries(ledger.invoices)) {
  const invoice = await call('get_invoice', { invoice_id: inv.invoice_id });
  console.log('get_invoice', ref, invoice.isError ? invoice.body : { status: invoice.body.status, total: invoice.body.amount?.value });
}
if (ledger.payouts?.batch_id) {
  const batch = await call('get_payout_batch', { payout_batch_id: ledger.payouts.batch_id });
  console.log('get_payout_batch', batch.isError ? batch.body : { status: batch.body.batch_header?.batch_status, items: batch.body.items?.length });
}

await client.close();
server.close();
