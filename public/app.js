const $ = (id) => document.getElementById(id);

function el(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null) node.append(kid.nodeType ? kid : String(kid));
  return node;
}

async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

let game;
let current = 'partner';
let transcripts = {};
const pending = {};
const selected = new Set();
const SETTLE_TEXT = $('settle-text').textContent;

function renderCase() {
  $('shop').textContent = `${game.shop} · an audit in your PayPal sandbox`;
  $('ai').textContent = `AI: ${game.ai}`;
  $('premise').replaceChildren(...game.premise.map((p) => el('p', {}, p)));
  $('staff').replaceChildren(...game.staff.map((s) => el('li', {}, el('b', {}, s.code), ` ${s.name}. ${s.role}`)));
  $('rules').replaceChildren(...game.rules.map((r) => el('li', {}, r)));
  $('sheet').tBodies[0].replaceChildren(
    ...game.sheet.map((r) =>
      el('tr', {}, el('td', { class: 'ref' }, r.ref), el('td', {}, r.customer), el('td', {}, r.item, r.remark ? el('div', { class: 'note' }, r.remark) : null), el('td', { class: 'num' }, `$${r.booked}`)),
    ),
  );
  $('messages').replaceChildren(...game.messages.map((m) => el('div', { class: 'msg' }, el('b', {}, `${m.from} · ${m.subject}`), m.body)));
  $('tools').replaceChildren(...game.partner_tools.map((t) => el('li', {}, t)));
  $('settle-text').textContent = game.refs.invoice ? SETTLE_TEXT.replace('HPS-0042', game.refs.invoice.number) : SETTLE_TEXT;

  const people = [{ id: 'partner', name: 'Partner' }, ...game.suspects];
  $('tabs').replaceChildren(
    ...people.map((p) => el('button', { role: 'tab', 'aria-selected': String(p.id === current), onclick: () => switchTo(p.id) }, p.id === 'partner' ? 'Partner (AI)' : p.name.split(' ')[0])),
  );
  $('culprits').replaceChildren(el('legend', {}, 'Culprit'), ...game.suspects.map((s) => el('label', {}, el('input', { type: 'radio', name: 'culprit', value: s.id }), ` ${s.name}`)));
}

function switchTo(id) {
  current = id;
  selected.clear();
  renderCase();
  const s = game.suspects.find((x) => x.id === id);
  $('who').textContent = id === 'partner' ? 'Your AI partner reads PayPal for you. Ask it to pull orders, refunds, the invoice or the payout batch.' : `${s.name}, ${s.role}. "${s.intro}"`;
  $('text').placeholder = id === 'partner' ? 'e.g. "Pull every order and its refunds"' : `Ask ${s.name.split(' ')[0]} something, or show a record`;
  $('show').hidden = id === 'partner';
  renderChat();
  refreshState();
}

// Partner replies sometimes use **bold**; show it without trusting any HTML.
function rich(text) {
  return text.split(/(\*\*[^*]+\*\*)/).map((part) => (/^\*\*[^*]+\*\*$/.test(part) ? el('b', {}, part.slice(2, -2)) : part));
}

function renderChat() {
  const items = [...(transcripts[current] ?? []), ...(pending[current] ?? [])];
  $('chat').replaceChildren(
    ...items.map((m) => {
      const b = el('div', { class: `bubble ${m.who}${m.error ? ' err' : ''}` }, ...rich(m.text));
      if (m.calls?.length) b.append(el('div', { class: 'calls' }, `PayPal: ${m.calls.map((c) => c.name).join(', ')}`));
      return b;
    }),
  );
  $('chat').scrollTop = $('chat').scrollHeight;
}

async function refreshState() {
  let s;
  try {
    s = await api('/api/state');
  } catch (err) {
    $('who').textContent = err.message;
    return null;
  }
  transcripts = s.transcripts;
  renderChat();
  $('call-count').textContent = s.log.length ? `${s.log.length}` : '';
  if (game.limits && s.turns.partner >= game.limits.partner) $('text').placeholder = 'Question limit reached for this game. Press "New game" to play again.';
  $('log').replaceChildren(...s.log.map((c) => el('li', { class: c.ok ? '' : 'bad' }, el('span', { class: 'ref' }, c.name), ` ${JSON.stringify(c.args)}`)));
  $('evidence').replaceChildren(...s.evidence.map((e) => el('li', {}, e.summary)));
  const keys = s.evidence.map((e) => e.key);
  $('show-chips').replaceChildren(
    ...keys.map((k) => el('button', { type: 'button', class: 'chip', 'aria-pressed': String(selected.has(k)), onclick: () => { selected.has(k) ? selected.delete(k) : selected.add(k); refreshState(); } }, k)),
  );
  $('cite').replaceChildren(...keys.map((k) => el('label', {}, el('input', { type: 'checkbox', name: 'cite', value: k }), ` ${k}`)));
  $('settle').hidden = !s.solved;
  if (s.proposal) {
    renderProposal(s.proposal);
  } else {
    // A new game has no proposal yet: clear what the last game left behind.
    clearInterval(polling);
    $('settle-status').replaceChildren();
    $('propose').disabled = false;
  }
  return s;
}

$('composer').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = $('text').value.trim();
  const show = [...selected];
  if (!text && !show.length) return;
  const who = current;
  pending[who] = [{ who: 'me', text: [text, ...show.map((k) => `[shows ${k}]`)].filter(Boolean).join(' ') }, { who: 'them', text: '...' }];
  $('text').value = '';
  selected.clear();
  renderChat();
  const btn = e.submitter ?? $('composer').querySelector('button');
  btn.disabled = true;
  try {
    if (who === 'partner') await api('/api/partner', { text });
    else await api(`/api/suspects/${who}`, { text, show });
  } catch {
    // The server keeps the error in the transcript.
  } finally {
    btn.disabled = false;
    delete pending[who];
  }
  refreshState();
});

$('open-accuse').addEventListener('click', () => {
  $('verdict').replaceChildren();
  $('accuse').showModal();
});

$('submit-accuse').addEventListener('click', async (e) => {
  e.preventDefault();
  const culprit = $('accuse-form').querySelector('input[name=culprit]:checked')?.value;
  const evidence = [...$('accuse-form').querySelectorAll('input[name=cite]:checked')].map((i) => i.value);
  if (!culprit) return $('verdict').replaceChildren(el('p', { class: 'bad' }, 'Pick a culprit.'));
  const r = await api('/api/accuse', { culprit, evidence });
  const lines = Object.entries(r.lines).map(([k, ok]) => el('p', {}, ok ? '✓ ' : '✗ ', game.lines[k]));
  if (r.solved) {
    $('verdict').replaceChildren(el('p', { class: 'good' }, 'Case solved.'), ...lines, ...r.truth.map((t) => el('p', {}, t)));
    refreshState();
  } else if (r.right_person) {
    $('verdict').replaceChildren(el('p', { class: 'bad' }, 'Right person, but the records you cited do not prove it yet.'), ...lines);
  } else {
    $('verdict').replaceChildren(el('p', { class: 'bad' }, 'The records do not support that accusation.'));
  }
});

let polling = null;
function renderProposal(p) {
  const parts = [];
  if (p.status === 'pending') parts.push(el('p', {}, 'Waiting for your approval on the clerk\'s page. ', el('a', { href: p.approve_url, target: '_blank', rel: 'noopener' }, 'Open the clerk')));
  if (p.status === 'executing') parts.push(el('p', {}, 'The clerk is sending the refund...'));
  if (p.status === 'executed') parts.push(el('p', { class: 'good' }, `Refunded. PayPal refund ${p.refund_id}, status read back from PayPal: ${p.paypal_status}.`));
  if (p.status === 'failed') parts.push(el('p', { class: 'bad' }, `The clerk could not send it: ${p.error}`));
  $('settle-status').replaceChildren(...parts);
  $('propose').disabled = true;
  if (['executed', 'failed'].includes(p.status)) clearInterval(polling);
}

$('propose').addEventListener('click', async () => {
  try {
    const p = await api('/api/settle', {});
    renderProposal(p);
    window.open(p.approve_url, '_blank', 'noopener');
    clearInterval(polling);
    polling = setInterval(async () => renderProposal(await api('/api/settle')), 2000);
  } catch (err) {
    $('settle-status').replaceChildren(el('p', { class: 'bad' }, err.message));
  }
});

$('reset').addEventListener('click', async () => {
  try {
    await api('/api/reset', {});
    // In the hosted demo each game has its own copy of Mara's payment and invoice.
    game = await api('/api/case');
  } catch (err) {
    $('who').textContent = err.message;
    return;
  }
  switchTo('partner');
});

try {
  game = await api('/api/case');
  switchTo('partner');
} catch (err) {
  $('who').textContent = `Could not start a game: ${err.message}`;
}
