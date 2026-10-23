# Ledger Case

**A detective game played on your own PayPal sandbox.** A small shop is $412 short at month-end. You audit it with an AI partner that reads the real PayPal records (orders, captures, refunds, an invoice, a payout batch), interview the people involved, and name who took the money. At the end, a real refund moves through PayPal, but only after you approve it on a page the AI cannot reach.

Built for the PayPal AI Hackathon (2026). Node 20+ · PayPal sandbox · MIT.

---

## Why it exists

The scams in the case are the ones PayPal warns sellers about in its own help pages: staff refunding orders to friends, a customer who "overpays" and asks for the difference by wire, someone asking to put their address on the business account, and affiliate payouts on orders that were later refunded. Reading about them is one thing. Here you find them in records you can open yourself: the case is created in your sandbox, so every clue is a field PayPal returns (`custom_id` on a refund, the card name, the shipping address, an invoice total against what was actually captured).

We claim only that: it is practice at reading real PayPal records. We have not measured whether it changes how anyone runs a shop.

## What happens in your sandbox

`npm run seed` creates the case with 17 calls to PayPal's REST APIs:

| PayPal API | What it creates | Why it matters in the case |
|---|---|---|
| Orders v2 (card payment source) | 9 paid orders with buyer name, item and shipping address | Who bought what, and where it went |
| Payments v2 refunds | 5 refunds, each tagged in `custom_id` with a staff code | Who pressed the refund button |
| Invoicing v2 | Invoice HPS-0042 for $300, sent | Against which a $500 payment arrived |
| Payouts v1 | 7 commission items for the affiliate | Paid on orders that were later refunded |

Then the game runs as three local processes:

```
            ┌──────────────── your browser ────────────────┐
            │  game page  (127.0.0.1:3910)                  │
            │  clerk's approval page (127.0.0.1:3912)       │
            └───────────────────────────────────────────────┘
   game (3910)                reader (3911)                  clerk (3912)
   AI partner + suspects  ──► PayPal Agent Toolkit MCP  ──►  PayPal sandbox
   no PayPal credentials      read-only tools only            refunds on approval only
            └──── proposes a refund ───────────────────────►  (not AI)
```

- **The partner** is an AI with one set of tools: PayPal's own [Agent Toolkit](https://github.com/paypal/agent-toolkit) served as an MCP server, with only the read actions switched on (`get_order`, `get_refund`, `get_invoice`, `list_invoices`, `search_invoicing`), plus one read-only `get_payout_batch` we add because the toolkit has no Payouts tools.
- **The game process holds no PayPal credentials.** `npm start` removes every `PAYPAL_*` variable from its environment, and it refuses to start if one is present.
- **The clerk** is a plain program, not an AI. The game can only *propose* a refund. The clerk checks it against its policy (one payment, at most $200, once), shows an approval page it serves itself, and refunds only when that form is submitted. It then reads the refund back from PayPal before reporting it.

This is process separation, enforced by the code and checked by the tests below. It is not a PayPal permission boundary: the reader and the clerk use the same sandbox app credentials.

### The hosted demo

The same code runs as a public demo with `LEDGER_HOSTED=1` (for example on Render's free web service: build `npm ci`, start `npm start`, and set `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `ANTHROPIC_API_KEY` and `LEDGER_HOSTED=1` as environment variables). Then:

- The case is seeded on first start (or taken from `LEDGER_JSON`, the `case-data/ledger.json` of an earlier seed, so that a host without a persistent disk does not seed a new case on every restart; it holds sandbox ids only), and only the game's port is public; it also serves the clerk's pages under `/clerk/`, passing through nothing but the approval token.
- A fourth process, **the desk**, creates a fresh copy of the one payment the ending refunds for every new game, so every visitor can play to the end. The clerk asks the desk which payment belongs to a game; it never takes a payment id from the game.
- Each browser gets its own game (an HttpOnly cookie). A game allows 40 questions to the partner and 80 to suspects, one at a time; one address can start 10 games an hour, and the desk 60 an hour in total.
- The AI key we use for the demo sits in its own Anthropic workspace with a monthly spend limit, so the demo cannot spend beyond it.

## Run it (about 5 minutes)

1. **A sandbox app.** In the [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/), use a **US** sandbox business account (Testing Tools → Sandbox Accounts → Create account → Business, United States), then Apps & Credentials → Create App, linked to that account. On the app page, tick **Invoicing** (and keep **Payouts** on), then Save. With a Japanese sandbox business account we measured that USD refunds failed (`REFUND_FAILED_INSUFFICIENT_FUNDS`); with a US one they did not, so we recommend a US account.
2. **Install and seed.**
   ```sh
   npm install
   export PAYPAL_CLIENT_ID=...       # sandbox app Client ID
   export PAYPAL_CLIENT_SECRET=...   # sandbox app Secret
   npm run seed                      # creates the case; writes case-data/ledger.json
   ```
   (PowerShell: `$env:PAYPAL_CLIENT_ID="..."`.) Run `npm run seed -- --fresh` for a new case later.
3. **Pick who plays the AI.**
   - `export ANTHROPIC_API_KEY=...` uses Claude through the Anthropic API (default model `claude-opus-5-5`, override with `ANTHROPIC_MODEL`).
   - `export LEDGER_AI=claude-code` uses a local [Claude Code](https://claude.com/claude-code) CLI instead, with all of its built-in tools removed and only the reader's MCP server configured.
   - `export LEDGER_AI=scripted` needs no AI at all: the partner turns your question into the same PayPal reads by fixed rules and reports the fields; suspects answer from fixed lines. Everything on the PayPal side is identical.
4. **Play.** `npm start`, then open http://127.0.0.1:3910.

## How to play

Ask your partner to pull records ("pull every order and its refunds", "look at web#1039", "the invoice", "Lena's payout batch"). Every PayPal call it makes appears in the right-hand column, and every record it reads becomes evidence. Switch to a person's tab to question them; you can show them records. When you think you know, make an accusation and cite the records that prove it. Once the case is solved, close the books: ask the clerk to return the overpayment to the original payment, and approve it on the clerk's page.

<details><summary>Solution (spoilers)</summary>

Kenji Ito had his flatmate buy the $103 pen set four times and refunded each one as "damaged", tagged with his own code `cs:KI`: 4 × $103 = $412. His own staff order, web#1039, ships to the same flat as Ryo Sato's four orders. Mara Holt is running an overpayment scam ($500 paid on a $300 invoice, difference wanted by wire). Daisuke wanted a stranger's parcel scheme on the shop's PayPal address. Lena was honestly paid $41.20 of commission on the refunded orders.

</details>

## Tests

```sh
npm test    # 17 tests, no keys, no network
```

They check the fence rather than describe it: the reader lists exactly the read-only tools and none of the toolkit tools that move money; the game's environment has no PayPal variable and the game refuses one; the clerk refuses other payments, larger amounts, repeats, a wrong approval token, and a second refund of the same payment after a restart; a proposal alone moves no money. They also check the case: the books are $412 above PayPal, the partner's instructions contain the books but none of the suspects' secrets or the solution, an accusation can only cite records the partner has actually pulled, and the keyless partner totals refunds by staff code from PayPal fields. And the hosted guards: each browser gets its own game and its own copy of the refundable payment, a game stops at its question limit, new games are rate-limited per address, the clerk refunds the payment the desk made for that game (ignoring any id in the request), and the game forwards only the approval token to the clerk.

## What we measured in the sandbox

On 2026-10-23, with a US sandbox business account (one run each): the seed created all 9 orders, 5 refunds, the invoice and the 7-item payout batch; the reader read them back through the toolkit (`custom_id`, card name and shipping address are returned as set); the clerk's $200 refund completed and read back as `COMPLETED`, both locally and in hosted mode through the game's `/clerk/` pass-through on a desk-made copy of the payment. Transaction search lagged by about six hours (n=1), so the game never relies on it; it reads every record by id.

Dependencies: `npm audit` reports 0 vulnerabilities. The PayPal Agent Toolkit's own dependency tree had 10 advisories (LangChain, the AI SDK, mathjs and others); `package.json` overrides them to fixed versions, and the tests and the live reader check pass with the overrides. Of those packages, the toolkit's MCP entry point loads only mathjs.

## Built with

- PayPal: Orders v2, Payments v2 (refunds), Invoicing v2, Payouts v1, and the PayPal Agent Toolkit (`@paypal/agent-toolkit`) as an MCP server.
- AI in the game: Claude (Anthropic API or Claude Code), or none in scripted mode.
- AI used to build it: the code, the case and this README were written with Claude Code (Anthropic); we ran and tested it in the sandbox.
- Everything in this repository was created during the hackathon's submission period.

## License

MIT. All names, shops and addresses in the case are fictional.
