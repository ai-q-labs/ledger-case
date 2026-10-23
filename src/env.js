// Which process gets which secrets. The game (and so the AI) never gets PayPal's.

export const PAYPAL_ENV = ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_ACCESS_TOKEN'];

export function gameEnv(env) {
  return Object.fromEntries(Object.entries(env).filter(([k]) => !k.startsWith('PAYPAL_')));
}

export function assertNoPayPalCredentials(env = process.env) {
  const present = Object.keys(env).filter((k) => k.startsWith('PAYPAL_') && env[k]);
  if (present.length) throw new Error(`The game process must not hold PayPal credentials, found: ${present.join(', ')}`);
}
