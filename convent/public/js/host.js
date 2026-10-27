// The big screen: who has joined, then a live map of the whole house (monsters and ghosts included,
// which the players cannot see), the progress so far, and the news as it happens.
import { io } from '/socket.io/socket.io.esm.min.js';
import * as L from '/shared/level.js';
import * as C from '/shared/config.js';
import { STORY } from '/shared/story.js';
import { mountPatch, reveal } from './harvest.js';
import { drawMap } from './ui.js';
import { costumeImage, costumeSVG } from './costumes.js';

const $ = (id) => document.getElementById(id);
const key = new URLSearchParams(location.search).get('key') || '';
const socket = io({ auth: { role: 'host', key }, transports: ['websocket', 'polling'] });
const S = { phase: 'LOBBY', roster: [], stage: 'power', padlocks: 0, keyRooms: [], t: 0, tAt: 0, finaleAt: 0, tick: null, searched: [], candy: new Map(), stats: null };
const esc = (s) => String(s).replace(/[<>&]/g, '');

const joinUrl = `${location.protocol}//${location.host}/`;
$('h-url').textContent = location.host;
$('h-qr').src = `/qr.svg?u=${encodeURIComponent(joinUrl)}`;

function section(id) {
  for (const s of document.querySelectorAll('main > section')) s.classList.toggle('on', s.id === id);
}
function apply(m) {
  for (const k of ['phase', 'stage', 'padlocks', 'keyRooms', 'finaleAt', 'searched']) if (m[k] != null) S[k] = m[k];
  if (m.t != null) {
    S.t = m.t;
    S.tAt = performance.now();
  }
  if (m.roster) S.roster = m.roster;
  if (m.candy) S.candy = new Map(m.candy.map(([id, x, z]) => [id, { x, z }]));
  render();
}
function render() {
  section(S.phase === 'LOBBY' ? 'h-lobby' : S.phase === 'PLAYING' ? 'h-game' : 'h-results');
  document.body.classList.toggle('lobby', S.phase === 'LOBBY');
  if (S.phase === 'LOBBY') $('h-timer').textContent = '';
  const n = S.roster.length;
  $('h-count').innerHTML = `<span class="num">${n}</span> inside.`;
  $('h-start').disabled = !n;
  if (S.phase === 'LOBBY') lightWindows();
  const order = ['power', 'desk', 'keys', 'escape'];
  for (const li of document.querySelectorAll('#h-steps li')) {
    const i = order.indexOf(li.dataset.s);
    const now = order.indexOf(S.stage);
    li.className = i < now ? 'done' : i === now ? 'now' : '';
  }
  $('h-locks').textContent = S.stage === 'keys' ? `(${S.padlocks} of 3)` : '';
  document.body.dataset.phase = S.phase;
  renderPlayers();
}

/* ---------- who is playing, and how they are doing: the part the Zoom audience watches ---------- */
const roomName = (r) => (r === 'c' ? 'Hallway' : r ? L.ROOMS[r].name : '');
const MONSTER = { vampire: '🧛', creature: '⚡', zombie: '🧟' };
const DOING = { asleep: 'asleep on the slab', idle: 'prowling', patrol: 'prowling', investigate: 'heard something', search: 'searching', chase: 'chasing someone!', gloat: 'caught someone', finale: 'guarding the door', flinch: 'dazzled by a flash' };
function status(p, st) {
  if (p.state === 'escaped') return ['out', 'Escaped!'];
  if (p.state === 'dead') return ['gone', 'Taken'];
  if (p.online === false) return ['away', 'Disconnected'];
  if (S.phase !== 'PLAYING') return ['', 'Ready'];
  if (st?.hidden) return ['hiding', `Hiding${st.room ? ' in the ' + roomName(st.room) : ''}`];
  return ['', st?.room ? roomName(st.room) : 'Exploring'];
}
function renderPlayers() {
  const stats = new Map((S.stats?.players || []).map((p) => [p.id, p]));
  // alphabetical, so people can find themselves, and the rows don't jump about; the taken sink to the bottom
  const list = [...S.roster].sort((a, b) => (a.state === 'dead') - (b.state === 'dead') || a.name.localeCompare(b.name));
  const count = (f) => S.roster.filter(f).length;
  const inside = count((p) => p.state === 'alive' && p.online !== false);
  const hiding = [...stats.values()].filter((st) => st.hidden && S.roster.find((p) => p.id === st.id && p.state === 'alive')).length;
  const candy = [...stats.values()].reduce((n, st) => n + st.candy, 0);
  const tile = (n, label, cls = '') => `<div class="${cls}"><b>${n}</b>${label}</div>`;
  $('h-tally').innerHTML =
    tile(inside, 'inside') + tile(hiding, 'hiding') + tile(count((p) => p.state === 'escaped'), 'escaped', 'out') + tile(count((p) => p.state === 'dead'), 'taken', 'gone') + tile(candy, 'candy', 'sweet');
  $('h-players').classList.toggle('many', list.length > 12);
  $('h-players').innerHTML = list
    .map((p) => {
      const st = stats.get(p.id);
      const [cls, where] = status(p, st);
      const lives = p.state === 'escaped' || p.state === 'dead' ? '' : `<span class="lives" title="lives">${'●'.repeat(Math.max(0, p.lives))}<i>${'●'.repeat(Math.max(0, C.LIVES - Math.max(0, p.lives)))}</i></span>`;
      const extra = [p.carrying ? `<em>${C.ITEMS[p.carrying].name}</em>` : '', st?.candy ? `<span class="c">🍬${st.candy}</span>` : ''].join(' ');
      return `<li class="${cls}"><span class="who">${costumeSVG(p.costume ?? 0)}</span><span class="name">${esc(p.name)}</span>${lives}<span class="where">${where} ${extra}</span></li>`;
    })
    .join('');
  // the monsters in one or two lines: the zombies together, since there can be several
  const ms = S.stats?.monsters || [];
  const zombies = ms.filter((n) => n.kind === 'zombie');
  const line = (n, label) => `<span>${MONSTER[n.kind]} ${label}: ${DOING[n.state] || n.state}${n.room && n.state !== 'asleep' ? ` <small>(${roomName(n.room)})</small>` : ''}</span>`;
  const moving = zombies.filter((n) => n.state === 'chase').length;
  $('h-monsters').innerHTML = hideMonsters
    ? '<span class="note">Monsters hidden from this screen</span>'
    : ms.filter((n) => n.kind !== 'zombie').map((n) => line(n, C.KINDS[n.kind].name.replace(/^./, (c) => c.toUpperCase()))).join('') +
      (zombies.length ? `<span>🧟 ${zombies.length} zombie${zombies.length > 1 ? 's' : ''}${moving ? `, ${moving} chasing!` : ''}</span>` : '') +
      (S.stats?.ghosts ? `<span>⚪ ${S.stats.ghosts} ghost${S.stats.ghosts > 1 ? 's' : ''}</span>` : '');
  fitPlayers();
}
// a full house still fits on one screen: the list's text shrinks until every name shows
function fitPlayers() {
  const el = $('h-players');
  if (!el.offsetParent) return;
  let fs = 20;
  el.style.fontSize = fs + 'px';
  while (el.scrollHeight > el.clientHeight + 1 && fs > 12) el.style.fontSize = --fs + 'px';
}
addEventListener('resize', fitPlayers);

/* ---------- host controls ---------- */
// on a shared screen a stray click must not end anyone's night: the button asks once more first
function twice(btn, act) {
  let armed = 0;
  const label = btn.textContent;
  btn.addEventListener('click', () => {
    if (armed) {
      clearTimeout(armed);
      armed = 0;
      btn.textContent = label;
      btn.classList.remove('armed');
      return act();
    }
    btn.textContent = btn.dataset.confirm;
    btn.classList.add('armed');
    armed = setTimeout(() => {
      armed = 0;
      btn.textContent = label;
      btn.classList.remove('armed');
    }, 4000);
  });
}
twice($('h-reset'), () => socket.emit('reset'));
twice($('h-finish'), () => socket.emit('finish'));
let hideMonsters = false;
try {
  hideMonsters = localStorage.getItem('host-hide-monsters') === '1';
} catch {}
function setHide(on) {
  hideMonsters = on;
  $('h-hide').setAttribute('aria-pressed', on);
  $('h-hide').textContent = on ? 'Show monsters' : 'Hide monsters';
  try {
    localStorage.setItem('host-hide-monsters', on ? '1' : '0');
  } catch {}
  renderPlayers();
}
$('h-hide').addEventListener('click', () => setHide(!hideMonsters));
setHide(hideMonsters);
socket.on('denied', () => (document.body.innerHTML = '<p style="padding:40px">Wrong host key.</p>'));
socket.on('welcome', (m) => {
  apply(m);
  for (const f of m.feed || []) addFeed(f.text);
  if (m.result) results(m.result);
  if (m.harvest) harvest(m.harvest);
});
socket.on('roster', (r) => apply({ roster: r }));
socket.on('lobby', (m) => {
  $('h-harvest').hidden = true;
  spook(false);
  S.stats = null;
  $('h-feed').innerHTML = '';
  apply(m);
});
socket.on('stats', (m) => {
  S.stats = m;
  renderPlayers();
});
// the story on the big screen as the night starts: about 16 seconds, or a click
let storyTimer = 0;
function tellStory() {
  $('h-story-title').textContent = STORY.title;
  $('h-story-text').innerHTML = STORY.paras.map((t, i) => `<p style="animation-delay:${0.4 + i * 3.2}s">${t}</p>`).join('');
  $('h-story').hidden = false;
  clearTimeout(storyTimer);
  storyTimer = setTimeout(() => ($('h-story').hidden = true), 17000);
}
$('h-story').addEventListener('click', () => {
  clearTimeout(storyTimer);
  $('h-story').hidden = true;
});
socket.on('start', (m) => {
  tellStory();
  laugh(); // the house laughs as the doors lock (if another screen started it)
  $('h-feed').innerHTML = '';
  S.stats = null;
  apply(m);
});
socket.on('stage', (m) => apply(m));

/* ---------- the pumpkin patch: the top scorer picks, everyone watches ---------- */
const dark = [new Audio('/assets/sounds/nun-hum.mp3'), new Audio('/assets/sounds/heartbeat.mp3')];
dark.forEach((a, i) => ((a.loop = true), (a.volume = i ? 0.35 : 0.45)));
const spook = (on) => dark.forEach((a) => (on ? a.play().catch(() => {}) : a.pause()));
let patchShown = '';
function harvest(h) {
  if (!h) return;
  const box = $('h-harvest');
  if (h.open) {
    $('h-harvest-title').textContent = `${h.winner.name} scored the most, and walks into the graveyard…`;
    $('h-harvest-msg').textContent = 'Six pumpkins hang there. Each hides a number from 1 to 6, and one of them is the 6.';
    $('h-harvest-msg').className = 'harvest-msg';
    mountPatch($('h-patch'), h.pumpkins);
    patchShown = 'open';
    box.hidden = false;
    spook(true);
  } else if (h.result) {
    if (box.hidden || patchShown === 'open') {
      if (!$('h-patch').querySelector('.pk')) mountPatch($('h-patch'), h.pumpkins);
      box.hidden = false;
    }
    patchShown = 'done';
    const r = h.result;
    reveal($('h-patch'), r);
    $('h-harvest-title').textContent = r.won ? `${h.winner.name} found the 6: ${r.text}` : `${h.winner.name} found a ${r.number}…`;
    $('h-harvest-msg').textContent = r.won ? 'The 6 was inside!' : `The 6 was in pumpkin ${r.prizeAt + 1}.`;
    $('h-harvest-msg').className = 'harvest-msg' + (r.won ? ' won' : '');
    const win = new Audio(r.won ? '/assets/sounds/sfx-win.mp3' : '/assets/sounds/ghost-boo.mp3');
    win.volume = 0.8;
    setTimeout(() => win.play().catch(() => {}), 900);
    setTimeout(() => spook(false), 9000);
  } else {
    box.hidden = true;
    spook(false);
  }
}
socket.on('harvest', harvest);
$('h-harvest').addEventListener('click', () => {
  $('h-harvest').hidden = true;
  spook(false);
});
socket.on('feed', (f) => addFeed(f.text));
socket.on('searched', (ids) => (S.searched = ids));
socket.on('candy+', ([id, x, z]) => S.candy.set(id, { x, z }));
socket.on('candy-', (id) => S.candy.delete(id));
socket.on('tick', (m) => {
  S.tick = m;
  S.t = m.t;
  S.tAt = performance.now();
});
socket.on('end', (r) => results(r));
let level = 'normal';
for (const b of document.querySelectorAll('#h-level button'))
  b.addEventListener('click', () => {
    level = b.dataset.level;
    for (const x of document.querySelectorAll('#h-level button')) x.classList.toggle('on', x === b);
  });
$('h-start').addEventListener('click', () => {
  laugh(); // played from the click itself, so the browser lets it
  socket.emit('start', { difficulty: level, prize: $('h-prize').checked });
});

/* ---------- the evil laugh, the moment the night starts ---------- */
const laughSound = new Audio('/assets/sounds/evil-laugh.wav');
laughSound.preload = 'auto';
let laughedAt = 0;
function laugh() {
  if (performance.now() - laughedAt < 4000) return;
  laughedAt = performance.now();
  laughSound.currentTime = 0;
  laughSound.play().catch(() => {});
}

/* ---------- the house in the lobby: a window lights up for each guest ---------- */
const windows = new Map(); // player id -> { i, t, costume, name }
function lightWindows() {
  const live = S.roster.filter((p) => p.online !== false);
  const ids = new Set(live.map((p) => p.id));
  for (const id of [...windows.keys()]) if (!ids.has(id)) windows.delete(id);
  const used = new Set([...windows.values()].map((w) => w.i));
  for (const p of live) {
    const w = windows.get(p.id);
    if (w) {
      Object.assign(w, { costume: p.costume, name: p.name });
      continue;
    }
    let i = 0;
    while (used.has(i)) i++;
    used.add(i);
    windows.set(p.id, { i, t: performance.now(), costume: p.costume, name: p.name });
  }
}
const T = { ink: '#0a0908', soot: '#15120e', bone: '#ede3cf', flame: '#ff7a1a', ember: '#ffc46b' };
const hexA = (hex, a) => {
  const n = parseInt(hex.slice(1, 7), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};
const flicker = (t, seed = 0, amp = 0.03) => 1 + amp * (0.6 * Math.sin(t * 11.3 + seed) + 0.3 * Math.sin(t * 23.7 + seed * 2.1) + 0.1 * Math.sin(t * 47.1 + seed * 3.7));
function houseGeom(w, h) {
  const base = h * 0.93;
  const m = { x0: w * 0.3, x1: w * 0.78, top: h * 0.4, apex: h * 0.17 };
  const tw = { x0: w * 0.175, x1: w * 0.3, top: h * 0.32, apex: h * 0.12 };
  const wins = [];
  const cols = 7;
  const rows = 4;
  const cw = (m.x1 - m.x0) / cols;
  const rh = (base - h * 0.1 - m.top) / rows;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (r === rows - 1 && c === 3) continue; // the front door
      wins.push({ x: m.x0 + cw * (c + 0.5), y: m.top + rh * (r + 0.42), w: cw * 0.46, h: rh * 0.52 });
    }
  const tcw = (tw.x1 - tw.x0) / 2;
  for (let r = 0; r < 5; r++) for (let c = 0; c < 2; c++) wins.push({ x: tw.x0 + tcw * (c + 0.5), y: tw.top + rh * 0.35 + r * rh * 0.92, w: tcw * 0.44, h: rh * 0.5 });
  wins.push({ x: (m.x0 + m.x1) / 2 - cw * 0.6, y: m.top - rh * 0.55, w: cw * 0.34, h: rh * 0.42 });
  wins.push({ x: (m.x0 + m.x1) / 2 + cw * 0.6, y: m.top - rh * 0.55, w: cw * 0.34, h: rh * 0.42 });
  return { base, m, tw, wins, cw, rh };
}
function drawHouse(c, w, h, t) {
  const g = houseGeom(w, h);
  const { m, tw, base } = g;
  c.clearRect(0, 0, w, h);
  // the facade: a soot silhouette with faint bone lines where the roofs meet the sky
  c.fillStyle = T.soot;
  c.beginPath();
  c.moveTo(m.x0 - g.cw * 0.25, m.top);
  c.lineTo((m.x0 + m.x1) / 2, m.apex);
  c.lineTo(m.x1 + g.cw * 0.25, m.top);
  c.lineTo(m.x1, m.top);
  c.lineTo(m.x1, base);
  c.lineTo(m.x0, base);
  c.closePath();
  c.fill();
  c.fillRect(m.x1 - g.cw * 1.4, m.apex + (m.top - m.apex) * 0.2, g.cw * 0.4, (m.top - m.apex) * 0.6);
  c.beginPath();
  c.moveTo(tw.x0 - g.cw * 0.12, tw.top);
  c.lineTo((tw.x0 + tw.x1) / 2, tw.apex);
  c.lineTo(tw.x1 + g.cw * 0.12, tw.top);
  c.lineTo(tw.x1, tw.top);
  c.lineTo(tw.x1, base);
  c.lineTo(tw.x0, base);
  c.closePath();
  c.fill();
  c.strokeStyle = hexA(T.bone, 0.18);
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(m.x0 - g.cw * 0.25, m.top);
  c.lineTo((m.x0 + m.x1) / 2, m.apex);
  c.lineTo(m.x1 + g.cw * 0.25, m.top);
  c.moveTo(tw.x0 - g.cw * 0.12, tw.top);
  c.lineTo((tw.x0 + tw.x1) / 2, tw.apex);
  c.lineTo(tw.x1 + g.cw * 0.12, tw.top);
  c.moveTo(w * 0.05, base);
  c.lineTo(w * 0.95, base);
  c.stroke();
  // the tower's finial, and a full moon
  c.fillStyle = T.soot;
  const fx0 = (tw.x0 + tw.x1) / 2;
  c.fillRect(fx0 - 1.5, tw.apex - h * 0.05, 3, h * 0.05);
  const moon = c.createRadialGradient(w * 0.88, h * 0.62, 0, w * 0.88, h * 0.62, h * 0.16);
  moon.addColorStop(0, hexA(T.bone, 0.85));
  moon.addColorStop(0.33, hexA(T.bone, 0.75));
  moon.addColorStop(0.36, hexA(T.bone, 0.08));
  moon.addColorStop(1, hexA(T.bone, 0));
  c.fillStyle = moon;
  c.fillRect(w * 0.88 - h * 0.16, h * 0.46, h * 0.32, h * 0.32);
  // the front door under a porch roof, with steps
  const dx = (m.x0 + m.x1) / 2;
  c.fillStyle = T.ink;
  c.fillRect(dx - g.cw * 0.26, base - g.rh * 0.78, g.cw * 0.52, g.rh * 0.78);
  c.fillStyle = T.soot;
  c.beginPath();
  c.moveTo(dx - g.cw * 0.8, base - g.rh * 0.86);
  c.lineTo(dx, base - g.rh * 1.18);
  c.lineTo(dx + g.cw * 0.8, base - g.rh * 0.86);
  c.closePath();
  c.fill();
  for (let i = 0; i < 3; i++) c.fillRect(dx - g.cw * (0.5 + i * 0.1), base - g.rh * 0.06 * (3 - i), g.cw * (1 + i * 0.2), g.rh * 0.06);
  // windows: dark until somebody arrives, then lit, with their costume in it and their name below
  const byIndex = new Map();
  for (const wd of windows.values()) byIndex.set(wd.i, wd);
  g.wins.forEach((win, i) => {
    const p = byIndex.get(i);
    const x = win.x - win.w / 2;
    const y = win.y - win.h / 2;
    if (!p) {
      c.fillStyle = T.ink;
      c.fillRect(x, y, win.w, win.h);
      return;
    }
    const age = (performance.now() - p.t) / 1000;
    // the light comes on: a stutter, then it holds
    let on = age < 0.15 ? age / 0.15 : age < 0.3 ? 0.35 : age < 0.45 ? 1.1 : 1;
    on *= flicker(t, i * 1.3, 0.03);
    const spill = c.createRadialGradient(win.x, win.y, 0, win.x, win.y, win.w * 1.9);
    spill.addColorStop(0, hexA(T.flame, 0.22 * on));
    spill.addColorStop(1, hexA(T.flame, 0));
    c.fillStyle = spill;
    c.fillRect(win.x - win.w * 2, win.y - win.w * 2, win.w * 4, win.w * 4);
    const gl = c.createRadialGradient(win.x, win.y + win.h * 0.15, 0, win.x, win.y + win.h * 0.15, win.h * 0.8);
    gl.addColorStop(0, T.ember);
    gl.addColorStop(0.5, T.flame);
    gl.addColorStop(1, '#5a2205');
    c.save();
    c.globalAlpha = Math.max(0, Math.min(1, on));
    c.fillStyle = gl;
    c.fillRect(x, y, win.w, win.h);
    c.restore();
    const img = costumeImage(p.costume ?? 0, T.ink);
    if (img.complete) {
      c.save();
      c.beginPath();
      c.rect(x, y, win.w, win.h);
      c.clip();
      const s = win.h * 1.05;
      c.drawImage(img, win.x - s / 2, y + win.h - s * 0.98, s, s);
      c.restore();
    }
    c.fillStyle = T.ink;
    c.fillRect(win.x - 1.5, y, 3, win.h * 0.4);
    c.fillStyle = T.bone;
    c.font = `700 ${Math.round(Math.max(13, Math.min(20, win.w * 0.28)))}px "Atkinson Hyperlegible", sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'top';
    c.globalAlpha = Math.max(0, Math.min(1, age * 2));
    c.fillText(p.name, win.x, y + win.h + 5, g.cw * 0.96);
    c.globalAlpha = 1;
  });
}
$('h-again').addEventListener('click', () => socket.emit('reset'));

function addFeed(text) {
  const el = document.createElement('div');
  el.textContent = text;
  $('h-feed').prepend(el);
  while ($('h-feed').children.length > 3) $('h-feed').lastChild.remove();
}
function results(r) {
  S.phase = 'RESULTS';
  $('h-timer').textContent = 'Dawn';
  $('h-result-title').textContent = r.escaped ? `${r.escaped} of ${r.total} escaped the manor!` : 'Nobody escaped. The manor keeps them all.';
  $('h-awards').innerHTML = r.awards.map((a) => `<li><b>${a.title}</b>${esc(a.name)}<br /><small>${a.why}</small></li>`).join('');
  $('h-scores').innerHTML = r.list.map((p) => `<li>${esc(p.name)}: ${p.score} ${{ escaped: '(escaped)', dead: '(taken)', kept: '' }[p.state]}${p.candy ? ` <small>· ${p.candy} candy</small>` : ''}</li>`).join('');
  render();
}

function frame() {
  requestAnimationFrame(frame);
  if (S.phase === 'LOBBY') {
    const hc = $('h-house');
    const k = Math.min(2, window.devicePixelRatio || 1);
    if (hc.width !== Math.round(hc.clientWidth * k)) {
      hc.width = Math.round(hc.clientWidth * k);
      hc.height = Math.round(hc.clientHeight * k);
    }
    const g = hc.getContext('2d');
    g.setTransform(k, 0, 0, k, 0, 0);
    drawHouse(g, hc.clientWidth, hc.clientHeight, performance.now() / 1000);
    return;
  }
  if (S.phase !== 'PLAYING') return;
  const t = S.t + (performance.now() - S.tAt) / 1000;
  const left = S.stage === 'escape' ? C.DURATION.finale - (t - S.finaleAt) : C.DURATION.night - t;
  const s = Math.max(0, Math.ceil(left));
  $('h-timer').textContent = `${S.stage === 'escape' ? 'Door closes in ' : 'Dawn in '}${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const c = $('h-map');
  if (c.width !== c.clientWidth * 2) {
    c.width = c.clientWidth * 2;
    c.height = c.clientHeight * 2;
  }
  const m = S.tick;
  if (!m) return;
  const names = new Map(S.roster.map((p) => [p.id, p.name]));
  drawMap(c, {
    host: true,
    others: m.p.filter((p) => p[6] !== 0).map(([id, x, z]) => ({ x, z, visible: true, name: names.get(id) })),
    monsters: hideMonsters ? [] : m.n.map(([id, x, z, yaw, state, kind]) => ({ x, z, state, kind })),
    ghosts: hideMonsters ? [] : m.g.map(([id, x, z, alive]) => ({ x, z, alive })),
    loose: m.l.map(([id, item, x, z]) => ({ x, z })),
    stage: S.stage,
    keyRooms: S.keyRooms,
    searched: S.searched.map((id) => L.PROPS[id]),
    candy: S.candy.values(),
  });
}
frame();
