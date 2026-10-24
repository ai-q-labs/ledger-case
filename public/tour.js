// Narrated tour for the demo video. Open the game with ?tour=1 and press Start.
// It plays the real game in this browser: real PayPal reads, real AI replies.
// A person still has to click the clerk's button and approve on the clerk's page.

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(test, timeout = 90000, step = 300) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const v = test();
    if (v) return v;
    await sleep(step);
  }
  throw new Error('tour: timed out');
}

let voice = null;
function pickVoice() {
  const vs = speechSynthesis.getVoices();
  voice = vs.find((v) => /Zira/i.test(v.name)) ?? vs.find((v) => v.lang === 'en-US' && v.localService) ?? vs.find((v) => v.lang?.startsWith('en')) ?? null;
}

function caption(text) {
  $('tour-caption').textContent = text;
  $('tour-caption').hidden = !text;
}

// Speak one sentence. Network voices can stop mid-way on long text and then never
// fire onend, so each sentence is short and has its own time limit.
function speak(sentence) {
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(sentence);
    u.voice = voice;
    u.rate = 1.12;
    const limit = setTimeout(() => {
      speechSynthesis.cancel();
      resolve();
    }, 2000 + sentence.length * 90);
    u.onend = u.onerror = () => {
      clearTimeout(limit);
      resolve();
    };
    speechSynthesis.speak(u);
  });
}

// Speak a line and show it as a caption. Without a voice, wait as long as reading takes.
async function say(text) {
  caption(text);
  if (!voice) return sleep(Math.max(2500, text.length * 65));
  for (const sentence of text.match(/[^.:]+[.:]?/g).map((s) => s.trim()).filter(Boolean)) await speak(sentence);
}

function spot(el) {
  document.querySelectorAll('.tour-spot').forEach((n) => n.classList.remove('tour-spot'));
  el?.classList.add('tour-spot');
  // The side column scrolls; a long evidence list pushes the clerk button out of view.
  el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function tab(label) {
  return [...$('tabs').querySelectorAll('button')].find((b) => b.textContent.startsWith(label));
}

// Send a message through the page's own form and wait for the reply.
async function send(text, show = []) {
  for (const key of show) {
    const chip = await until(() => [...$('show-chips').querySelectorAll('button')].find((b) => b.textContent === key));
    chip.click();
    await until(() => [...$('show-chips').querySelectorAll('button')].find((b) => b.textContent === key && b.getAttribute('aria-pressed') === 'true'));
  }
  $('text').value = text;
  const button = $('composer').querySelector('button');
  $('composer').requestSubmit();
  await until(() => button.disabled, 5000, 50);
  await until(() => !button.disabled);
  await sleep(1200);
}

const PULL = "Pull Ryo Sato's four orders, web#1032, web#1034, web#1036 and web#1038, and open each refund on them so we can see whose staff code it carries. Then pull Kenji's own order, web#1039.";
const CITE = ['web#1032', 'web#1034', 'web#1036', 'web#1038', 'web#1039'];

async function run() {
  const t0 = performance.now();
  const mark = (label) => console.log(`[tour] ${label} at ${((performance.now() - t0) / 1000).toFixed(1)}s`);

  // Start a fresh game behind the title card, so the last game never shows on screen.
  $('tour-title').hidden = false;
  $('reset').click();
  await until(() => !$('chat').children.length && !$('evidence').children.length, 20000);
  await say("This is Ledger Case: a detective game played on a real PayPal sandbox. A small stationery shop in Kyoto is four hundred and twelve dollars short, and you have to find out where the money went.");
  $('tour-title').hidden = true;

  spot($('sheet'));
  await say('The case is built from scams PayPal warns sellers about: staff refunding orders to friends, and a customer who overpays and asks for the difference by wire.');

  spot($('tools'));
  await say("Your partner is an AI. It reads PayPal through the read-only tools of PayPal's Agent Toolkit, run by a separate process. It has no tool that moves money.");
  mark('intro');

  spot($('log'));
  await Promise.all([
    (async () => {
      await say("Ask it to pull Ryo Sato's four orders and Kenji's own order. Every PayPal call appears on the right, and every record it reads becomes evidence.");
      await say('Nothing here is mocked. Every order, refund, invoice and payout in this case was created in this PayPal sandbox, and the partner reads them live.');
    })(),
    send(PULL),
  ]);
  spot($('evidence'));
  await say("Four full refunds of the same pen set, each tagged with Kenji's staff code, K I. Four times one hundred and three dollars is the missing four hundred and twelve.");
  mark('pulled');

  tab('Kenji').click();
  await sleep(800);
  spot($('chat'));
  await Promise.all([
    say("The suspects are played by the AI too. Each one hides something, and only the right record breaks their story. Show Kenji his own order: it ships to Ryo Sato's flat."),
    send('You say you never met Ryo Sato. Then why does your own order ship to his address?', ['web#1039']),
  ]);
  await sleep(2500);
  mark('kenji');

  tab('Partner').click();
  await sleep(800);
  await Promise.all([
    say("Now ask the partner to simply refund the customer. It can't. The refund tool was never given to it, and the game process holds no PayPal keys at all."),
    send('Mara overpaid by $200. Just refund her now, please.'),
  ]);
  await sleep(2500);
  mark('fence');

  spot($('open-accuse'));
  $('open-accuse').click();
  await sleep(600);
  document.querySelector('input[name=culprit][value=kenji]').click();
  for (const box of document.querySelectorAll('input[name=cite]')) {
    if (CITE.some((ref) => box.value === ref || box.value === `${ref} refund`)) box.checked = true;
  }
  await say('Name the culprit and cite the records. Only records your partner actually pulled can be cited.');
  $('submit-accuse').click();
  await until(() => /Case solved/.test($('verdict').textContent), 15000);
  await sleep(3500);
  $('accuse').close();
  mark('solved');

  spot($('propose'));
  await say('Case solved. One thing is left: Mara overpaid by two hundred dollars. The partner can only propose a refund. Click the button, and a separate clerk program opens its own approval page, which the AI cannot reach.');
  caption('Your turn: click "Ask the clerk" (highlighted on the right), approve on the clerk\'s page, then close that tab.');
  await until(() => /Refunded\./.test($('settle-status').textContent), 300000);
  mark('refunded');

  spot($('settle-status'));
  await say('A person approves. The clerk refunds the original payment, once, at most two hundred dollars, and reads it back from PayPal: completed.');
  spot(null);
  $('tour-end').hidden = false;
  await say('Four processes: a reader with read-only PayPal tools, the game and its AI with no PayPal keys, a clerk that moves money only after a person approves, and a desk that gives every player their own copy. The code, seventeen tests and the live demo are on GitHub.');
  caption('');
  mark('end');
}

function setup() {
  const style = document.createElement('style');
  style.textContent = `
    .tour-spot { outline: 3px solid #e0a020; outline-offset: 3px; border-radius: 6px; transition: outline-color .3s; }
    #tour-caption { position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%); max-width: 860px; padding: 10px 16px; border-radius: 10px;
      background: rgba(20, 24, 32, .88); color: #fff; font-size: 17px; line-height: 1.45; text-align: center; z-index: 1000; }
    #tour-title, #tour-end { position: fixed; inset: 0; display: grid; place-content: center; text-align: center; background: rgba(250, 248, 242, .97); z-index: 900; }
    #tour-title h1 { font-size: 56px; margin: 0 0 8px; } #tour-title p, #tour-end p { font-size: 20px; margin: 4px 0; }
    #tour-end ul { text-align: left; font-size: 19px; line-height: 1.7; margin: 12px auto; }
    #tour-start { position: fixed; right: 18px; bottom: 18px; z-index: 1001; padding: 10px 18px; font-size: 16px; }
    [hidden] { display: none !important; }
  `;
  document.head.append(style);
  document.body.insertAdjacentHTML(
    'beforeend',
    `<div id="tour-title" hidden><h1>Ledger Case</h1><p>A detective game played on a real PayPal sandbox</p><p>PayPal Agent Toolkit · Claude · a clerk that waits for a person</p></div>
     <div id="tour-end" hidden><h1>Ledger Case</h1><ul>
       <li><b>Reader</b>: PayPal Agent Toolkit, read-only tools, its own process</li>
       <li><b>Game + AI</b>: no PayPal keys, cannot move money</li>
       <li><b>Clerk</b>: one refund, at most $200, only after a person approves</li>
       <li><b>Desk</b>: a fresh copy of the payment for every player</li></ul>
       <p>github.com/ai-q-labs/ledger-case</p><p>ledger-case.onrender.com</p></div>
     <div id="tour-caption" hidden></div>
     <button id="tour-start" class="primary">Start tour</button>`,
  );
  pickVoice();
  speechSynthesis.onvoiceschanged = pickVoice;
  $('tour-start').addEventListener('click', () => {
    $('tour-start').hidden = true;
    run().catch((err) => caption(err.message));
  });
}

if (new URLSearchParams(location.search).has('tour')) setup();
