// The reader: the only process the AI partner can reach.
//
// It holds the PayPal credentials and serves PayPal's own Agent Toolkit as an MCP
// server (Streamable HTTP, localhost only) with the read actions switched on and
// nothing else. Refunds, payouts and invoice changes are not registered here, so
// no prompt can make the partner call them.

import express from 'express';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { PayPalAgentToolkit } from '@paypal/agent-toolkit/mcp';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createClient, credentialsFromEnv } from './paypal.js';

export const READ_ONLY_ACTIONS = {
  orders: { get: true },
  payments: { getRefunds: true },
  invoices: { get: true, list: true, search: true },
};

export const READER_TOOLS = ['get_order', 'get_refund', 'get_invoice', 'list_invoices', 'search_invoicing', 'get_payout_batch'];

export function buildServer({ accessToken, paypal }) {
  const server = new PayPalAgentToolkit({
    accessToken,
    configuration: { actions: READ_ONLY_ACTIONS, context: { sandbox: true } },
  });
  // The toolkit has no Payouts tools, so the one read the case needs is added here.
  server.registerTool(
    'get_payout_batch',
    {
      title: 'Get Payout Batch',
      description:
        'Retrieve a PayPal Payouts batch by its payout batch id: the batch status and every item (receiver, amount, note, sender_item_id, status). Read-only.',
      inputSchema: { payout_batch_id: z.string().regex(/^[A-Z0-9]{8,32}$/) },
    },
    async ({ payout_batch_id }) => {
      const body = await paypal.get(`/v1/payments/payouts/${payout_batch_id}?page_size=100`);
      return { content: [{ type: 'text', text: JSON.stringify(body) }] };
    },
  );
  return server;
}

export function createReaderApp({ paypal, log = console.log }) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.post('/mcp', async (req, res) => {
    if (req.body?.method === 'tools/call') log(`[reader] ${req.body.params?.name} ${JSON.stringify(req.body.params?.arguments ?? {})}`);
    // Stateless: a fresh server per request, so an expired token never sticks around.
    const server = buildServer({ accessToken: await paypal.accessToken(), paypal });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  const notAllowed = (_req, res) =>
    res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
  app.get('/mcp', notAllowed);
  app.delete('/mcp', notAllowed);
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.READER_PORT ?? 3911);
  const paypal = createClient(credentialsFromEnv());
  createReaderApp({ paypal }).listen(port, '127.0.0.1', () => console.log(`[reader] MCP on http://127.0.0.1:${port}/mcp`));
}
