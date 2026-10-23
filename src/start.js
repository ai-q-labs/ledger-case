// npm start
//
// Starts the processes with separate environments:
//   reader  PayPal credentials, read-only MCP tools        127.0.0.1:3911
//   clerk   PayPal credentials, refunds only on approval   127.0.0.1:3912
//   game    AI key (if any), no PayPal credentials         127.0.0.1:3910
// and, for the hosted demo (LEDGER_HOSTED=1), one more:
//   desk    PayPal credentials, a fresh copy of Mara's payment per game   127.0.0.1:3913
// In hosted mode the game listens on $PORT on all interfaces and serves the
// clerk's pages under /clerk; everything else stays on localhost. If there is
// no case yet, it is seeded first.
//
// The game is started with every PayPal variable removed from its environment,
// and it refuses to run if one is present.

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { credentialsFromEnv } from './paypal.js';
import { gameEnv } from './env.js';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const hosted = process.env.LEDGER_HOSTED === '1';
const ledgerPath = here('../case-data/ledger.json');

credentialsFromEnv();

function runOnce(script, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [here(script), ...args], { env: process.env, stdio: 'inherit' });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${script} exited with code ${code}`))));
  });
}

if (!existsSync(ledgerPath)) {
  if (!hosted) {
    console.error('No case yet. Run `npm run seed` first (it creates the case in your PayPal sandbox).');
    process.exit(1);
  }
  console.log('[start] no case yet; seeding the sandbox');
  await runOnce('./seed.js');
}
const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));

const ports = { game: Number(process.env.PORT ?? 3910), reader: 3911, clerk: 3912, desk: 3913 };
const internal = (p) => `http://127.0.0.1:${p}`;
const withPayPal = { ...process.env };
const withoutPayPal = gameEnv(process.env);
const deskUrl = hosted ? internal(ports.desk) : null;

const children = [];
function run(name, script, env) {
  const child = spawn(process.execPath, [here(script)], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const prefix = (d) => d.toString().split(/\r?\n/).filter(Boolean).map((l) => (l.startsWith('[') ? l : `[${name}] ${l}`)).join('\n');
  child.stdout.on('data', (d) => console.log(prefix(d)));
  child.stderr.on('data', (d) => console.error(prefix(d)));
  child.on('exit', (code) => {
    console.error(`[${name}] exited with code ${code}`);
    for (const c of children) c.kill();
    process.exit(code ?? 1);
  });
  children.push(child);
}

run('reader', './reader.js', { ...withPayPal, READER_PORT: String(ports.reader) });
if (deskUrl) {
  run('desk', './desk.js', { ...withPayPal, DESK_PORT: String(ports.desk), LEDGER_INVOICE_NUMBER: ledger.invoices?.['HPS-0042']?.invoice_number ?? 'HPS-0042' });
}
run('clerk', './clerk.js', { ...withPayPal, CLERK_PORT: String(ports.clerk), ...(deskUrl ? { DESK_URL: deskUrl } : {}) });
run('game', './game.js', {
  ...withoutPayPal,
  GAME_PORT: String(ports.game),
  READER_URL: `${internal(ports.reader)}/mcp`,
  CLERK_URL: internal(ports.clerk),
  ...(deskUrl ? { DESK_URL: deskUrl } : {}),
});

process.on('SIGINT', () => {
  for (const c of children) c.kill();
  process.exit(0);
});
process.on('SIGTERM', () => {
  for (const c of children) c.kill();
  process.exit(0);
});

if (!hosted) setTimeout(() => console.log(`\nOpen http://127.0.0.1:${ports.game} to play.`), 1500);
