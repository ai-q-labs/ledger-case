// A small PayPal REST client shared by the seed script, the reader and the clerk.
// It never logs the client secret or the access token.

import { randomUUID } from 'node:crypto';

export const SANDBOX_API = 'https://api-m.sandbox.paypal.com';

export function credentialsFromEnv(env = process.env) {
  const clientId = env.PAYPAL_CLIENT_ID?.trim();
  const clientSecret = env.PAYPAL_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error('PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be set (sandbox app credentials).');
  }
  return { clientId, clientSecret };
}

export class PayPalError extends Error {
  constructor(status, body, method, path) {
    const issue = body?.details?.[0]?.issue ?? body?.name ?? 'UNKNOWN';
    super(`${method} ${path} -> HTTP ${status} ${issue}`);
    this.status = status;
    this.body = body;
    this.issue = issue;
  }
}

export function createClient({ clientId, clientSecret, base = SANDBOX_API, fetchImpl = fetch }) {
  let token = null;
  let expiresAt = 0;

  async function accessToken() {
    if (token && Date.now() < expiresAt - 60_000) return token;
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const res = await fetchImpl(`${base}/v1/oauth2/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new PayPalError(res.status, body, 'POST', '/v1/oauth2/token');
    token = body.access_token;
    expiresAt = Date.now() + body.expires_in * 1000;
    return token;
  }

  // requestId makes a POST idempotent: PayPal returns the first result again on a retry.
  async function call(method, path, body, { requestId } = {}) {
    const headers = {
      Authorization: `Bearer ${await accessToken()}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    };
    if (requestId) headers['PayPal-Request-Id'] = requestId;
    const res = await fetchImpl(`${base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const parsed = text ? JSON.parse(text) : {};
    if (!res.ok) throw new PayPalError(res.status, parsed, method, path);
    return parsed;
  }

  return {
    accessToken,
    get: (path) => call('GET', path),
    post: (path, body, opts) => call('POST', path, body, opts),
  };
}

export const newRequestId = () => randomUUID();
