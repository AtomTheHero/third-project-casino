/* ============================================================
   TABLESIGHT AI — three-phase demo
   Phase 1: computer vision capture at a live blackjack table
   Phase 2: data aggregation into a full player rating
   Phase 3: intelligence layer -> real-time host decision
   ============================================================ */

'use strict';

/* ---------------- playback engine with seek ---------------- */
let runId = 0;          // bumped on every restart / seek -> cancels old runs
let paused = false;
let vtime = 0;          // virtual demo time (ms since demo start)
let ffTarget = 0;       // fast-forward: consume sleeps instantly until vtime reaches this

const $ = (id) => document.getElementById(id);

function sleep(ms) {
  const myRun = runId;
  return new Promise((resolve, reject) => {
    /* fast-forward mode: consume instantly (microtask, no real wait) */
    if (vtime + ms <= ffTarget) {
      vtime += ms;
      queueMicrotask(() => (myRun === runId ? resolve() : reject({ cancelled: true })));
      return;
    }
    let remaining = ms;
    if (vtime < ffTarget) { remaining -= (ffTarget - vtime); vtime = ffTarget; }
    let elapsed = 0;
    const step = 40;
    const tick = () => {
      if (myRun !== runId) return reject({ cancelled: true });
      if (!paused) { elapsed += step; vtime += step; updateScrubber(); }
      if (elapsed >= remaining) return resolve();
      setTimeout(tick, step);
    };
    setTimeout(tick, step);
  });
}

/* timeline marks (measured; used by scrubber chapters + phase nav) */
const MARKS = {};
function mark(name) {
  MARKS[name] = Math.round(vtime);
  $('stage').dataset.marks = JSON.stringify(MARKS);
}

/* chapter times are measured from an instrumented full run (see MARKS) */
const TOTAL = 124200;
const CHAPTERS = [
  ['INTRO', 0], ['HAND 1', 5720], ['HAND 2', 23120], ['HAND 3', 41520],
  ['HAND 4', 60000], ['PROFILE', 81040], ['SIMULATION', 97480],
  ['DECISION', 106760], ['HOST PHONE', 115200],
];
const PHASE_STARTS = { 1: 0, 2: 81040, 3: 97480 };

$('pauseBtn').addEventListener('click', () => {
  paused = !paused;
  $('pauseBtn').textContent = paused ? '▶ RESUME' : '⏸ PAUSE';
});
$('restartBtn').addEventListener('click', () => startDemo(0));
$('replayBtn').addEventListener('click', () => startDemo(0));
document.querySelectorAll('.phase-btn').forEach(btn =>
  btn.addEventListener('click', () => startDemo(PHASE_STARTS[+btn.dataset.scene])));

/* ---------------- scrubber UI ---------------- */
function updateScrubber() {
  const p = Math.min(vtime / TOTAL, 1) * 100;
  $('scrubFill').style.width = p + '%';
  if (!scrubDragging) $('scrubHead').style.left = p + '%';
}

let scrubDragging = false;
(function buildScrubber() {
  const track = $('scrubTrack');
  for (const [label, t] of CHAPTERS) {
    const tick = document.createElement('div');
    tick.className = 'scrub-tick';
    tick.style.left = (t / TOTAL * 100) + '%';
    track.appendChild(tick);
    const chap = document.createElement('button');
    chap.className = 'scrub-chap';
    chap.style.left = (t / TOTAL * 100) + '%';
    chap.textContent = label;
    chap.addEventListener('click', (e) => { e.stopPropagation(); startDemo(t); });
    $('scrubChapters').appendChild(chap);
  }
  const pctFromEvent = (e) => {
    const r = track.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  };
  track.addEventListener('pointerdown', (e) => {
    scrubDragging = true;
    track.setPointerCapture(e.pointerId);
    $('scrubHead').style.left = (pctFromEvent(e) * 100) + '%';
  });
  track.addEventListener('pointermove', (e) => {
    if (scrubDragging) $('scrubHead').style.left = (pctFromEvent(e) * 100) + '%';
  });
  track.addEventListener('pointerup', (e) => {
    scrubDragging = false;
    startDemo(pctFromEvent(e) * TOTAL);
  });
})();

function showScene(n) {
  document.querySelectorAll('.scene').forEach(s => s.classList.remove('visible'));
  $('scene' + n).classList.add('visible');
  document.querySelectorAll('.phase-btn').forEach(b =>
    b.classList.toggle('active', +b.dataset.scene === n));
}

async function titleCard(phase, main, sub, hold = 2600) {
  $('titlePhase').textContent = phase;
  $('titleMain').textContent = main;
  $('titleSub').textContent = sub;
  $('titleOverlay').classList.add('show');
  await sleep(hold);
  $('titleOverlay').classList.remove('show');
  await sleep(500);
}

async function startDemo(targetMs = 0) {
  runId++;
  paused = false;
  vtime = 0;
  ffTarget = Math.max(0, Math.min(targetMs, TOTAL - 1000));
  $('pauseBtn').textContent = '⏸ PAUSE';
  $('endOverlay').classList.remove('show');
  $('titleOverlay').classList.remove('show');
  updateScrubber();
  try {
    await runScene1();
    await runScene2();
    await runScene3();
    mark('end');
    vtime = TOTAL;
    updateScrubber();
    $('endOverlay').classList.add('show');
  } catch (e) {
    if (!e || !e.cancelled) console.error(e);
  }
}

/* ============================================================
   SCENE 1 — COMPUTER VISION CAPTURE
   ============================================================ */

/* Venetian-style betting spots: [left%, top%, rotation]. Seat 5 (index 3) is our player. */
const SPOTS = [
  [13, 33, -33], [23.5, 44.5, -22], [34.5, 51.5, -10],
  [45, 54, 0], [57.5, 51, 11], [69, 42.5, 23],
];
(function buildSpots() {
  for (const [x, y, r] of SPOTS) {
    const s = document.createElement('div');
    s.className = 'spot';
    s.style.left = x + '%'; s.style.top = y + '%';
    s.style.transform = `rotate(${r}deg)`;
    s.innerHTML = '<div class="rect"></div><div class="pair">PAIR</div>';
    $('spotLayer').appendChild(s);
  }
})();

const SUIT_RED = { '♥': 1, '♦': 1 };
const HILO = (r) => ('23456'.includes(r) ? 1 : ('789'.includes(r) ? 0 : -1));

let runningCount = 0, decksLeft = 4.5;
let sessionHands = 43, clockSec = 21 * 3600 + 14 * 60 + 32;
let clockTimer = null;

function fmtClock(s) {
  const h = Math.floor(s / 3600) % 24, m = Math.floor(s / 60) % 60, ss = s % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
}

function logEvent(tag, text, cls = '') {
  const log = $('eventLog');
  const row = document.createElement('div');
  row.innerHTML = `<span class="t">${fmtClock(clockSec)}</span><span class="tag ${cls}">[${tag}]</span>${text}`;
  log.appendChild(row);
  while (log.children.length > 14) log.removeChild(log.firstChild);
}

function makeCard(rank, suit, faceDown) {
  const el = document.createElement('div');
  el.className = 'card ' + (SUIT_RED[suit] ? 'red' : 'black') + (faceDown ? ' facedown' : '');
  el.innerHTML = `<div class="corner">${rank}<small>${suit}</small></div><div class="pip">${suit}</div>`;
  return el;
}

/* deal a card from the shoe to (x%,y%) of the feed */
async function dealCard(rank, suit, x, y, rot, faceDown) {
  const el = makeCard(rank, suit, faceDown);
  el.style.left = '84%'; el.style.top = '8%'; el.style.transform = 'rotate(38deg)';
  $('cardLayer').appendChild(el);
  el.getBoundingClientRect(); // reflow
  el.style.left = x + '%'; el.style.top = y + '%'; el.style.transform = `rotate(${rot}deg)`;
  await sleep(470);
  return el;
}

function flipCard(el, rank, suit) {
  el.classList.remove('facedown');
  el.className = 'card ' + (SUIT_RED[suit] ? 'red' : 'black');
  el.innerHTML = `<div class="corner">${rank}<small>${suit}</small></div><div class="pip">${suit}</div>`;
}

/* tight CV box around a card dealt at (x%,y%) */
function cardBox(x, y, label) {
  return cvBox(x - 0.55, y - 1.1, 5.6, 11.4, label);
}

/* CV bounding box at (x%,y%) sized (w%,h%) */
function cvBox(x, y, w, h, label, cls = '') {
  const b = document.createElement('div');
  b.className = 'cvbox ' + cls;
  b.style.left = x + '%'; b.style.top = y + '%';
  b.style.width = w + '%'; b.style.height = h + '%';
  b.innerHTML = `<span class="cvlabel">${label}</span>`;
  $('cvLayer').appendChild(b);
  return b;
}

function updateCountHud(rank) {
  if (rank) runningCount += HILO(rank);
  const tc = (runningCount / decksLeft).toFixed(1);
  $('hudCount').textContent = `RC ${runningCount >= 0 ? '+' : ''}${runningCount} · TC ${tc >= 0 ? '+' : ''}${tc}`;
}

async function banner(text, cls, hold = 1500) {
  const b = $('actionBanner');
  b.className = cls; b.textContent = text; b.classList.add('show');
  await sleep(hold);
  b.classList.remove('show');
  await sleep(220);
}

function setSkill(score, grade, adherence, edge, ap, avgBet) {
  $('skillScoreNum').textContent = score;
  $('skillGrade').textContent = grade;
  $('skillMeter').style.width = score + '%';
  $('adherence').textContent = adherence;
  $('adherence').className = 'warn';
  $('effEdge').textContent = edge;
  $('effEdge').className = 'ok';
  $('apProb').textContent = ap;
  $('avgBet').textContent = avgBet;
}

function addHandChip(label, optimal) {
  const c = document.createElement('div');
  c.className = 'hand-chip ' + (optimal ? 'opt' : 'dev');
  c.textContent = label + (optimal ? ' ✓' : ' ✗');
  $('handChips').appendChild(c);
}

function chipStack(x, y, colors) {
  const s = document.createElement('div');
  s.className = 'chip-stack';
  s.style.left = x + '%'; s.style.top = y + '%';
  colors.forEach(col => {
    const c = document.createElement('div');
    c.className = 'chip ' + col;
    s.appendChild(c);
  });
  $('chipLayer').appendChild(s);
  return s;
}

/* ---- animated hand gestures with pose-landmark overlay ---- */
const PALM_SVG = `<svg class="hand-svg" viewBox="0 0 100 140">
  <g class="hand-shape">
    <rect x="27" y="30" width="11" height="48" rx="5.5"/>
    <rect x="41" y="22" width="11" height="56" rx="5.5"/>
    <rect x="55" y="26" width="11" height="52" rx="5.5"/>
    <rect x="69" y="36" width="10" height="42" rx="5"/>
    <rect x="10" y="66" width="12" height="36" rx="6" transform="rotate(30 16 84)"/>
    <ellipse cx="50" cy="92" rx="27" ry="26"/>
    <rect x="36" y="108" width="28" height="32" rx="9"/>
  </g>
  <g class="kps">
    <polyline points="50,116 32,74 32,36"/>
    <polyline points="50,116 46,70 46,28"/>
    <polyline points="50,116 60,72 60,32"/>
    <polyline points="50,116 74,78 74,42"/>
    <polyline points="50,116 18,88 14,72"/>
    <circle cx="50" cy="116" r="3"/>
    <circle cx="32" cy="74" r="2.4"/><circle cx="32" cy="36" r="2.4"/>
    <circle cx="46" cy="70" r="2.4"/><circle cx="46" cy="28" r="2.4"/>
    <circle cx="60" cy="72" r="2.4"/><circle cx="60" cy="32" r="2.4"/>
    <circle cx="74" cy="78" r="2.4"/><circle cx="74" cy="42" r="2.4"/>
    <circle cx="18" cy="88" r="2.4"/><circle cx="14" cy="72" r="2.4"/>
  </g>
</svg>`;

const POINT_SVG = `<svg class="hand-svg" viewBox="0 0 100 140">
  <g class="hand-shape">
    <rect x="34" y="22" width="12" height="56" rx="6"/>
    <circle cx="58" cy="74" r="9"/>
    <circle cx="68" cy="80" r="9"/>
    <circle cx="76" cy="88" r="8"/>
    <ellipse cx="54" cy="94" rx="26" ry="24"/>
    <rect x="12" y="72" width="12" height="34" rx="6" transform="rotate(32 18 89)"/>
    <rect x="40" y="110" width="28" height="30" rx="9"/>
  </g>
  <g class="kps">
    <polyline points="54,118 40,76 40,28"/>
    <polyline points="54,118 58,74"/>
    <polyline points="54,118 68,80"/>
    <circle cx="54" cy="118" r="3"/>
    <circle cx="40" cy="76" r="2.4"/>
    <circle cx="40" cy="28" r="2.8"/>
    <circle cx="58" cy="74" r="2.4"/><circle cx="68" cy="80" r="2.4"/>
  </g>
</svg>`;

async function animateGesture(kind) {
  const tap = kind === 'HIT';
  const wrap = document.createElement('div');
  wrap.className = 'hand-wrap';
  wrap.style.left = tap ? '49%' : '41.5%';
  wrap.style.top = '59%';
  wrap.innerHTML = (tap ? POINT_SVG : PALM_SVG) + '<div class="ripple"></div>';
  $('floatLayer').appendChild(wrap);
  wrap.getBoundingClientRect();
  wrap.classList.add('in');                      // hand enters from player edge
  await sleep(480);
  logEvent('POSE', 'Hand detected · 21 landmarks locked', '');
  wrap.classList.add(tap ? 'tap' : 'wave');      // gesture motion
  await sleep(1550);
  wrap.classList.add('out');                     // hand withdraws
  await sleep(380);
  wrap.remove();
}

function floatText(x, y, txt, color) {
  const f = document.createElement('div');
  f.className = 'float-txt';
  f.style.left = x + '%'; f.style.top = y + '%'; f.style.color = color;
  f.textContent = txt;
  $('floatLayer').appendChild(f);
  setTimeout(() => f.remove(), 1700);
}

/* ---- the scripted hands ---- */
const HANDS = [
  {
    bet: 100, chips: ['black', 'black'],
    player: [['10','♦'], ['6','♣']], pTotal: '16 (HARD)',
    dealerUp: ['9','♠'], dealerHole: ['8','♥'], dTotal: '17',
    dealerDraws: [],
    optimal: 'HIT', action: 'STAND', gesture: 'HAND WAVE — STAND',
    reason: 'Hard 16 vs 9 → basic strategy: <span class="hl">HIT</span> (surrender if allowed).',
    verdict: 'Player <span class="bad">STOOD on hard 16 vs 9</span> — costly deviation. EV given up: <span class="bad">−4.1%</span> of wager.',
    result: 'LOSS', payout: -100, resultText: 'DEALER 17 BEATS 16 — HOUSE WINS $100',
    chipLabel: '16v9', skill: { score: 61, grade: 'C', adh: '33%', edge: '2.0%', ap: '4.8%', avg: '$100' }
  },
  {
    bet: 150, chips: ['black', 'green', 'green'],
    player: [['A','♠'], ['7','♥']], pTotal: 'SOFT 18',
    dealerUp: ['6','♦'], dealerHole: ['10','♣'], dTotal: '16 → DRAWS',
    dealerDraws: [['9','♥']],
    optimal: 'DOUBLE', action: 'STAND', gesture: 'HAND WAVE — STAND',
    reason: 'Soft 18 vs 6 → basic strategy: <span class="hl">DOUBLE DOWN</span>.',
    verdict: 'Player <span class="bad">failed to double soft 18 vs 6</span>. Won the hand anyway — <span class="hl">outcome ≠ skill</span>. EV given up: <span class="bad">−9.2%</span>.',
    result: 'WIN', payout: 150, resultText: 'DEALER BUSTS 25 — PLAYER WINS $150',
    chipLabel: 'A7v6', skill: { score: 58, grade: 'C−', adh: '31%', edge: '2.2%', ap: '3.1%', avg: '$117' }
  },
  {
    bet: 100, chips: ['black', 'black'],
    player: [['8','♣'], ['8','♦']], pTotal: 'PAIR 8-8 (16)',
    dealerUp: ['10','♥'], dealerHole: ['Q','♠'], dTotal: '20',
    dealerDraws: [],
    optimal: 'SPLIT', action: 'HIT', gesture: 'TAP FELT — HIT',
    hitCard: ['K','♦'], hitTotal: '26 — BUST',
    reason: 'Pair of 8s vs 10 → basic strategy: <span class="hl">ALWAYS SPLIT 8s</span>.',
    verdict: 'Player <span class="bad">hit 8-8 instead of splitting</span> and busted. Signature low-skill error. EV given up: <span class="bad">−11.4%</span>.',
    result: 'LOSS', payout: -100, resultText: 'PLAYER BUSTS 26 — HOUSE WINS $100',
    chipLabel: '88vT', skill: { score: 54, grade: 'C−', adh: '29%', edge: '2.3%', ap: '2.4%', avg: '$112' }
  },
  {
    bet: 125, chips: ['black', 'green'],
    player: [['J','♥'], ['Q','♣']], pTotal: '20 (HARD)',
    dealerUp: ['7','♦'], dealerHole: ['9','♣'], dTotal: '16 → DRAWS',
    dealerDraws: [['8','♠']],
    optimal: 'STAND', action: 'STAND', gesture: 'HAND WAVE — STAND',
    reason: 'Hard 20 vs 7 → basic strategy: <span class="hl">STAND</span>.',
    verdict: '<span class="good">Correct play.</span> Bet sizing still shows <span class="hl">zero correlation with count</span> (r = 0.04) → not an advantage player.',
    result: 'WIN', payout: 125, resultText: 'DEALER BUSTS 24 — PLAYER WINS $125',
    chipLabel: '20v7', skill: { score: 56, grade: 'C−', adh: '31%', edge: '2.3%', ap: '2.1%', avg: '$118' }
  },
];

async function runScene1() {
  showScene(1);
  /* reset */
  ['cardLayer','chipLayer','cvLayer','floatLayer','eventLog','handChips'].forEach(id => $(id).innerHTML = '');
  $('strategyBody').innerHTML = 'Awaiting hand…';
  runningCount = 2; decksLeft = 4.5; sessionHands = 43;
  clockSec = 21 * 3600 + 14 * 60 + 32;
  $('hudHands').textContent = 'SESSION HANDS: 43';
  setSkill(63, 'C', '35%', '1.9%', '5.2%', '$104');
  updateCountHud();
  clearInterval(clockTimer);
  clockTimer = setInterval(() => { if (!paused) { clockSec++; $('hudClock').textContent = fmtClock(clockSec); } }, 350);

  await titleCard('PHASE 01 / 03', 'Computer Vision Capture',
    'One overhead camera per table on The Venetian casino floor. Every card, chip, gesture and payout — detected, classified and scored in real time. No pit clipboard. No guesswork.');

  /* lock onto the scene */
  logEvent('POSE', 'Dealer skeleton locked · conf 99.1%');
  cvBox(38, 2, 24, 14, 'DEALER · STAFF #221 · 99.1%', 'roi');
  await sleep(800);
  logEvent('POSE', 'Player seat 5 occupied · re-ID match');
  cvBox(34, 78, 32, 19, 'PLAYER #4187 · SEAT 5 · 98.7%', 'roi');
  await sleep(800);
  logEvent('FACE', 'Identity: Venetian Rewards match — M. Torres (SAPPHIRE)', '');
  cvBox(42.5, 55, 15, 15, 'BET ZONE · SEAT 5', 'roi');
  await sleep(1000);

  for (let i = 0; i < HANDS.length; i++) {
    mark('hand' + (i + 1));
    await playHand(HANDS[i], i);
  }

  await banner('SESSION PROFILE COMPLETE — STREAMING TO INTELLIGENCE LAYER', 'neutral', 2400);
  clearInterval(clockTimer);
}

async function playHand(h, idx) {
  const CV = $('cvLayer');
  /* keep the 3 ROI boxes (first children), clear the rest */
  while (CV.children.length > 3) CV.removeChild(CV.lastChild);
  $('cardLayer').innerHTML = '';
  $('chipLayer').innerHTML = '';

  /* --- bet detection --- */
  const stack = chipStack(46.6, 59.5, h.chips);
  await sleep(450);
  const betBox = cvBox(44.5, 55.5, 9, 12, `WAGER $${h.bet} · 99.6%`);
  logEvent('CHIP', `Wager detected: $${h.bet} (${h.chips.length} chips) seat 5`, 'ocr');
  $('strategyBody').innerHTML = `Hand #${sessionHands + 1} · wager <span class="hl">$${h.bet}</span><br>Dealing…`;
  await sleep(900);

  /* --- deal: P1, D-up, P2, D-hole --- */
  const pc1 = await dealCard(h.player[0][0], h.player[0][1], 41, 66, -7, false);
  cardBox(41, 66, `${h.player[0][0]}${h.player[0][1]} · 99.4%`);
  logEvent('OCR', `Card: ${h.player[0][0]}${h.player[0][1]} → player seat 5`, 'ocr');
  updateCountHud(h.player[0][0]);
  await sleep(420);

  await dealCard(h.dealerUp[0], h.dealerUp[1], 43, 16, -4, false);
  cardBox(43, 16, `${h.dealerUp[0]}${h.dealerUp[1]} · 99.2%`);
  logEvent('OCR', `Card: ${h.dealerUp[0]}${h.dealerUp[1]} → dealer upcard`, 'ocr');
  updateCountHud(h.dealerUp[0]);
  await sleep(420);

  const pc2 = await dealCard(h.player[1][0], h.player[1][1], 46.5, 67.5, 5, false);
  cardBox(46.5, 67.5, `${h.player[1][0]}${h.player[1][1]} · 99.5%`);
  logEvent('OCR', `Card: ${h.player[1][0]}${h.player[1][1]} → player seat 5`, 'ocr');
  updateCountHud(h.player[1][0]);
  await sleep(420);

  const hole = await dealCard(h.dealerHole[0], h.dealerHole[1], 48.5, 16.5, 6, true);
  logEvent('OCR', 'Card: face-down → dealer hole', 'ocr');
  await sleep(500);

  /* --- strategy engine evaluates --- */
  cvBox(39.3, 63.2, 18.5, 17.5, `PLAYER ${h.pTotal}`, 'warn');
  logEvent('EVAL', `Player ${h.pTotal} vs dealer ${h.dealerUp[0]}`, 'eval');
  $('strategyBody').innerHTML =
    `Player: <span class="hl">${h.pTotal}</span> · Dealer: <span class="hl">${h.dealerUp[0]}${h.dealerUp[1]}</span><br>` +
    `Optimal play: <span class="good">${h.optimal}</span><br>Watching player decision…`;
  await sleep(1400);

  /* --- player acts: animated hand gesture, then classification --- */
  await animateGesture(h.action);
  await banner(`GESTURE DETECTED: ${h.gesture}`, 'neutral', 1400);
  logEvent('POSE', `Gesture classified: ${h.action} · conf 97.8%`, '');

  if (h.hitCard) {
    const hc = await dealCard(h.hitCard[0], h.hitCard[1], 52, 69, 12, false);
    cardBox(52, 69, `${h.hitCard[0]}${h.hitCard[1]} · 99.1%`);
    logEvent('OCR', `Card: ${h.hitCard[0]}${h.hitCard[1]} → player seat 5`, 'ocr');
    updateCountHud(h.hitCard[0]);
    await sleep(600);
    logEvent('EVAL', `Player total ${h.hitTotal}`, 'eval');
  }

  /* --- verdict --- */
  const good = h.action === h.optimal;
  await banner(
    good ? `✓ OPTIMAL PLAY — ${h.action}` : `✗ DEVIATION — PLAYED ${h.action}, OPTIMAL ${h.optimal}`,
    good ? 'good' : 'bad', 1800);
  $('strategyBody').innerHTML = h.reason + '<br>' + h.verdict;
  logEvent('EVAL', good ? 'Decision optimal — skill model updated' : `Deviation logged — optimal was ${h.optimal}`, good ? 'eval' : 'alert');
  addHandChip(h.chipLabel, good);
  const s = h.skill;
  setSkill(s.score, s.grade, s.adh, s.edge, s.ap, s.avg);
  await sleep(1100);

  /* --- dealer resolves --- */
  flipCard(hole, h.dealerHole[0], h.dealerHole[1]);
  cardBox(48.5, 16.5, `${h.dealerHole[0]}${h.dealerHole[1]} · 99.0%`);
  logEvent('OCR', `Hole card revealed: ${h.dealerHole[0]}${h.dealerHole[1]} — dealer ${h.dTotal}`, 'ocr');
  updateCountHud(h.dealerHole[0]);
  await sleep(700);

  for (const [r, su] of h.dealerDraws) {
    await dealCard(r, su, 53.5, 17, 9, false);
    cardBox(53.5, 17, `${r}${su} · 99.3%`);
    logEvent('OCR', `Card: ${r}${su} → dealer`, 'ocr');
    updateCountHud(r);
    await sleep(500);
  }

  /* --- result --- */
  const win = h.result === 'WIN';
  await banner(h.resultText, win ? 'good' : 'bad', 1700);
  floatText(48, 52, (h.payout > 0 ? '+$' : '−$') + Math.abs(h.payout), win ? '#00ff9d' : '#fb6f6f');
  logEvent('CHIP', win ? `Payout $${h.payout} confirmed → player` : `Wager $${Math.abs(h.payout)} collected → house`, 'ocr');
  sessionHands++;
  $('hudHands').textContent = 'SESSION HANDS: ' + sessionHands;
  decksLeft = Math.max(3.5, decksLeft - 0.12);
  await sleep(900);
}

/* ============================================================
   SCENE 2 — DATA AGGREGATION
   ============================================================ */

const RAW_EVENTS = [
  'evt.card { rank:<b>10♦</b>, dest:seat5, conf:.994 }',
  'evt.chip { value:<b>$100</b>, zone:bet_5, n:2 }',
  'evt.gesture { class:<b>stand</b>, conf:.978 }',
  'evt.card { rank:<b>9♠</b>, dest:dealer, conf:.992 }',
  'evt.eval { optimal:<b>hit</b>, played:stand, dev:true }',
  'evt.payout { amt:<b>-$100</b>, dir:house }',
  'evt.card { rank:<b>A♠</b>, dest:seat5, conf:.995 }',
  'evt.pose { id:<b>player_4187</b>, seat:5, dwell:+1s }',
  'evt.eval { optimal:<b>double</b>, played:stand, dev:true }',
  'evt.card { rank:<b>8♣</b>, dest:seat5, conf:.993 }',
  'evt.card { rank:<b>8♦</b>, dest:seat5, conf:.991 }',
  'evt.eval { optimal:<b>split</b>, played:hit, dev:true }',
  'evt.payout { amt:<b>+$150</b>, dir:player }',
  'evt.count { rc:<b>+3</b>, tc:+0.7, spread_r:.04 }',
  'evt.card { rank:<b>J♥</b>, dest:seat5, conf:.996 }',
  'evt.eval { optimal:<b>stand</b>, played:stand, dev:false }',
  'evt.chip { value:<b>$125</b>, zone:bet_5, n:2 }',
  'evt.session { hands:<b>47</b>, dur:01:12:44 }',
];

const PROFILE_FIELDS = [
  ['PLAYER ID', '#4187', ''],
  ['CLUB LEVEL', 'SAPPHIRE', 'sapphire'],
  ['ZONE', 'PIT 3', ''],
  ['BANK', 'BJ-BANK-2', ''],
  ['ASSET', 'BJ-07', ''],
  ['STAND / SEAT', 'SEAT 5', ''],
  ['GAME TITLE', 'BLACKJACK 3:2', ''],
  ['BUY-IN', '$1,000', ''],
  ['TIME ON DEVICE', '1:12:44', ''],
  ['HANDS PLAYED', '47', ''],
  ['AVG BET', '$118', ''],
  ['NET WIN (HOUSE)', '+$285', 'good'],
  ['THEO WIN (SESSION)', '$127', 'good'],
  ['ADW (AVG DAILY WORTH)', '$412', 'good'],
  ['SKILL GRADE', 'C− (56/100)', 'warn'],
  ['STRAT ADHERENCE', '31%', 'warn'],
  ['EFFECTIVE EDGE', '2.3%', 'good'],
  ['AP PROBABILITY', '2.1%', ''],
];

const DERIVED = [
  ['Effective house edge vs this player', '2.3% (baseline 0.5%)', 92, '#00ff9d'],
  ['Theo uplift from skill errors', '+360%', 86, '#00ff9d'],
  ['Bet spread ↔ count correlation', 'r = 0.04 (none)', 8, '#38bdf8'],
  ['Churn risk — checkout tomorrow 11:00', '42%', 42, '#fbbf24'],
  ['Retention value (2 extra days)', '$824 theo', 74, '#00ff9d'],
];

async function runScene2() {
  mark('scene2');
  showScene(2);
  $('rawStream').innerHTML = '';
  $('profileGrid').innerHTML = '';
  $('derivedList').innerHTML = '';
  $('pipeNote').innerHTML = '';
  $('pfName').textContent = '— — —';
  $('pfTier').textContent = 'RESOLVING IDENTITY…';
  const st = $('pfStatus'); st.textContent = 'SYNCING'; st.classList.remove('done');

  await titleCard('PHASE 02 / 03', 'Data Aggregation',
    'Every detection event streams into one unified player record — the full rating a casino currently needs three systems and a pit boss to approximate, built automatically per hand.');

  /* build empty field grid */
  const fields = PROFILE_FIELDS.map(([label]) => {
    const f = document.createElement('div');
    f.className = 'pf-field';
    f.innerHTML = `<label>${label}</label><b>—</b>`;
    $('profileGrid').appendChild(f);
    return f;
  });

  /* raw stream keeps flowing in background */
  let evIdx = 0;
  const streamTimer = setInterval(() => {
    if (paused) return;
    const row = document.createElement('div');
    row.innerHTML = `<span style="color:#2e3d4e">${String(1201 + evIdx).padStart(4,'0')}</span>  ${RAW_EVENTS[evIdx % RAW_EVENTS.length]}`;
    $('rawStream').appendChild(row);
    while ($('rawStream').children.length > 24) $('rawStream').removeChild($('rawStream').firstChild);
    evIdx++;
  }, 260);
  const myRun = runId;
  const stopStream = () => clearInterval(streamTimer);

  try {
    await sleep(900);
    $('pfName').textContent = 'Michael Torres';
    $('pfTier').textContent = 'VENETIAN REWARDS · SAPPHIRE · #4187';

    /* fill fields one by one */
    for (let i = 0; i < fields.length; i++) {
      const [label, value, cls] = PROFILE_FIELDS[i];
      fields[i].classList.add('on');
      fields[i].querySelector('b').textContent = value;
      if (cls) fields[i].querySelector('b').className = cls;
      await sleep(330);
    }
    st.textContent = 'PROFILE COMPLETE'; st.classList.add('done');
    await sleep(500);

    /* derived metrics */
    for (const [label, val, pct, color] of DERIVED) {
      const d = document.createElement('div');
      d.className = 'derived-item';
      d.innerHTML = `<label>${label}<b>${val}</b></label><div class="dbar"><div style="background:${color}"></div></div>`;
      $('derivedList').appendChild(d);
      d.getBoundingClientRect();
      d.classList.add('on');
      d.querySelector('.dbar div').style.width = pct + '%';
      await sleep(520);
    }

    $('pipeNote').innerHTML =
      `<span class="hl">▸</span> PMS: Venezia Tower Ste. 1408, <span class="hl">checkout tomorrow 11:00</span><br>` +
      `<span class="hl">▸</span> 6 trips / 12 mo · theo $9,340 → <span class="hl">18,680 Tier Points</span><br>` +
      `<span class="hl">▸</span> 1,320 Tier Points short of <span class="hl">RUBY</span> (20,000)<br>` +
      `<span class="hl">▸</span> Handing off to intelligence layer…`;
    await sleep(2800);
  } finally {
    if (myRun === runId) stopStream(); else stopStream();
  }
}

/* ============================================================
   SCENE 3 — INTELLIGENCE LAYER + HOST DECISION
   ============================================================ */

const INTEL_INPUT_LINES = [
  'player_id      : <b>#4187 — M. Torres</b>',
  'tier           : <b>SAPPHIRE</b> · Venetian Rewards',
  'tier_points    : <b>18,680</b> · <span class="warn">1,320 short of RUBY</span>',
  'live_position  : <b>PIT 3 · BJ-07 · SEAT 5</b>',
  'skill_grade    : <span class="warn">C− (adherence 31%)</span>',
  'effective_edge : <span class="good">2.3%</span> vs 0.5% baseline',
  'adw            : <span class="good">$412 / day</span>',
  'ap_probability : <span class="good">2.1% — cleared</span>',
  'room_status    : Venezia Twr 1408 · <span class="bad">CHECKOUT 11:00</span>',
  'churn_risk     : <span class="warn">42%</span>',
  'objective      : <b>maximize retained theo</b>',
];

const READOUTS = [
  ['P(HOUSE PROFITS / DAY)', '97.7%', 'good'],
  ['PLAYER WIN PROB / HAND', '41.2%', 'warn'],
  ['THEO IF RETAINED +2 DAYS', '+$824', 'good'],
  ['DECISION LATENCY', '212 ms', 'cyan'],
];

const ACTIONS = [
  { name: 'Extend suite comp +2 nights — Venezia Tower', sub: '0.91 accept × 0.68 stay × $1,086 wknd theo',
    gain: '+$672', cost: '−$260', ev: '+$412', pct: 100, ok: true, selected: true },
  { name: 'Award 1,320 Tier Points → RUBY now', sub: '0.44 return-trip lift × $1,540 avg trip theo',
    gain: '+$678', cost: '−$360', ev: '+$318', pct: 77, ok: true },
  { name: 'Sphere show tickets — Saturday', sub: '0.74 accept × $605 extra-session theo',
    gain: '+$448', cost: '−$150', ev: '+$298', pct: 72, ok: true },
  { name: 'Dinner for two — Mott 32', sub: '0.88 accept × $245 late-night play after dinner',
    gain: '+$216', cost: '−$120', ev: '+$96', pct: 23, ok: true },
  { name: '$100 free slot play', sub: '$185 reinvested play · cannibalizes table time',
    gain: '+$185', cost: '−$100', ev: '+$85', pct: 20, ok: true },
  { name: 'No action', sub: '0.42 churn × $824 remaining-trip theo lost',
    gain: '$0', cost: '$0', ev: '−$346', pct: 0, ok: false },
];

const TRACE_LINES = [
  'P(accept offer) <b>0.91</b> × P(stays 2 nights) <b>0.68</b> = <b>0.62</b> conversion',
  '× 2-day theo <b>$824</b> × weekend uplift <b>1.32</b> = <b class="good">+$672 expected gross</b>',
  '− suite cost 2 nights × $130 = <b class="bad">−$260</b>',
  '= <b class="good">NET +$412</b> · ROI <b>1.6×</b> · beats next-best action by <b>$94</b>',
];

async function runScene3() {
  mark('scene3');
  showScene(3);
  $('intelInput').innerHTML = '';
  $('coreReadouts').innerHTML = '';
  $('actionList').innerHTML = '';
  $('phoneFeed').innerHTML = '';
  $('decisionTrace').innerHTML = '';
  $('decisionTrace').classList.remove('on');
  $('actionsHead').style.opacity = 0;
  $('coreSims').textContent = '0';
  $('coreRing').classList.remove('done');

  await titleCard('PHASE 03 / 03', 'Intelligence Layer → Host',
    'The engine prices every action the casino could take — gross theo gained, comp cost, net expected value — and pushes the most profitable move to the host\'s phone while the player is still in the seat.');

  /* input lines */
  for (let i = 0; i < INTEL_INPUT_LINES.length; i++) {
    const d = document.createElement('div');
    d.innerHTML = INTEL_INPUT_LINES[i];
    d.style.animationDelay = '0s';
    $('intelInput').appendChild(d);
    await sleep(210);
  }

  /* simulation counter */
  const target = 25000;
  let sims = 0;
  while (sims < target) {
    if (!paused) {
      sims = Math.min(target, sims + 700 + Math.floor(Math.random() * 900));
      $('coreSims').textContent = sims.toLocaleString();
    }
    await sleep(60);
  }
  $('coreRing').classList.add('done');

  /* readouts */
  for (const [label, val, cls] of READOUTS) {
    const r = document.createElement('div');
    r.className = 'readout';
    r.innerHTML = `<label>${label}</label><b class="${cls}">${val}</b>`;
    $('coreReadouts').appendChild(r);
    await sleep(320);
  }
  await sleep(400);

  /* action evaluation */
  mark('decision');
  $('actionsHead').style.opacity = 1;
  const rows = [];
  for (const a of ACTIONS) {
    const row = document.createElement('div');
    row.className = 'action-item';
    row.innerHTML =
      `<div class="action-name">${a.name}<small>${a.sub}</small></div>` +
      `<div class="action-col"><label>GROSS</label><b class="g">${a.gain}</b></div>` +
      `<div class="action-col"><label>COST</label><b class="c">${a.cost}</b></div>` +
      `<div class="action-evbar"><div></div></div>` +
      `<div class="action-ev ${a.ok ? (a.pct === 0 ? 'zero' : 'pos') : 'neg'}"><label>NET EV</label>${a.ev}</div>`;
    $('actionList').appendChild(row);
    row.getBoundingClientRect();
    row.classList.add('on');
    row.querySelector('.action-evbar div').style.width = Math.max(a.pct, 3) + '%';
    rows.push(row);
    await sleep(480);
  }
  await sleep(700);

  /* select winner */
  rows.forEach((row, i) => {
    if (ACTIONS[i].selected) {
      row.classList.add('selected');
      const badge = document.createElement('div');
      badge.className = 'action-badge';
      badge.textContent = 'SELECTED';
      row.appendChild(badge);
    } else row.classList.add('rejected');
  });
  await sleep(900);

  /* decision trace — show the math behind the winner */
  const trace = $('decisionTrace');
  trace.classList.add('on');
  trace.innerHTML = '<div class="trace-head">DECISION TRACE — SUITE COMP EXTENSION</div>';
  for (const line of TRACE_LINES) {
    const d = document.createElement('div');
    d.className = 'trace-line';
    d.innerHTML = line;
    trace.appendChild(d);
    await sleep(650);
  }
  await sleep(1200);

  /* push to phone */
  mark('phone');
  const notif = document.createElement('div');
  notif.className = 'notif priority';
  notif.innerHTML = `
    <div class="notif-head">⚡ RECOMMENDED ACTION <span class="when">now</span></div>
    <div class="notif-title">Michael Torres — Sapphire</div>
    <div class="notif-body">
      At <b>BJ-07, Pit 3</b> right now · down $285 tonight.<br>
      Offer: <b>extend suite comp 2 nights</b> (Venezia Tower Ste. 1408).
    </div>
    <div class="notif-why">
      <b>WHY:</b> Skill grade C− → edge 2.3%. ADW $412/day.
      Checkout 11:00 tomorrow. $672 expected theo − $260 comp
      = <b>net +$412 (1.6× ROI)</b>.
      Hook: <b>1,320 Tier Pts from Ruby</b>.
    </div>
    <div class="notif-actions">
      <button class="primary" id="acceptBtn">Approve</button>
      <button>Adjust</button>
      <button>Dismiss</button>
    </div>`;
  $('phoneFeed').appendChild(notif);
  notif.getBoundingClientRect();
  notif.classList.add('on');
  await sleep(2600);

  /* host approves */
  const btn = notif.querySelector('#acceptBtn');
  btn.classList.add('pressed');
  btn.textContent = '✓ Approved';
  await sleep(900);

  const toasts = [
    '<b>✓ PMS</b> — Venezia Tower Ste. 1408 extended through Thursday',
    '<b>✓ CRM</b> — offer sent via Venetian Rewards app · read 21:29',
    '<b>✓ LEDGER</b> — comp logged · $260 against $824 projected theo',
  ];
  for (const t of toasts) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = t;
    $('phoneFeed').appendChild(el);
    el.getBoundingClientRect();
    el.classList.add('on');
    await sleep(950);
  }
  await sleep(2600);
}

/* ---------------- go (optional ?t=SECONDS deep link) ---------------- */
const startAtSec = new URLSearchParams(location.search).get('t');
startDemo(startAtSec ? +startAtSec * 1000 : 0);
