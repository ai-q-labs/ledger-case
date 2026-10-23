import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// Which process gets which secrets. The game (and so the AI) never gets PayPal's.

export const PAYPAL_ENV = ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_ACCESS_TOKEN'];

export function gameEnv(env) {
  return Object.fromEntries(Object.entries(env).filter(([k]) => !k.startsWith('PAYPAL_')));
}

export function assertNoPayPalCredentials(env = process.env) {
  const present = Object.keys(env).filter((k) => k.startsWith('PAYPAL_') && env[k]);
  if (present.length) throw new Error(`The game process must not hold PayPal credentials, found: ${present.join(', ')}`);
}

// Free hosts often have no persistent disk. LEDGER_JSON (the case-data/ledger.json
// of an earlier seed: sandbox ids only, no credentials) lets a restart reuse the
// same case instead of seeding a new one each time. Returns the case id it wrote.
export function ledgerFromEnv(path, env) {
  if (existsSync(path) || !env.LEDGER_JSON) return null;
  const parsed = JSON.parse(env.LEDGER_JSON);
  if (!parsed.orders || !parsed.refunds || !parsed.invoices) throw new Error('LEDGER_JSON is not a seeded ledger.');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(parsed, null, 2));
  return parsed.case_id ?? 'unknown id';
}
