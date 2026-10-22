// The flat parts of the screen: settings, the map, the heads-up display and the full-screen panels.
import * as L from '/shared/level.js';
import * as C from '/shared/config.js';

export const $ = (id) => document.getElementById(id);

/* ---------- settings, remembered in this browser ---------- */
const DEFAULTS = { master: 0.8, music: 0.7, sfx: 0.9, brightness: 0.35, sensitivity: 0.5, arrowsTurn: true, gentle: false, bigText: false, invert: false };
export const settings = (() => {
  let s = { ...DEFAULTS };
  try {
    s = { ...DEFAULTS, ...JSON.parse(localStorage.getItem('convent-settings') || '{}') };
  } catch (e) {
    /* private window: settings last for this visit only */
  }
  return s;
})();
const listeners = [];
export function onSettings(f) {
  listeners.push(f);
  f(settings);
}
function saveSettings() {
  try {
    localStorage.setItem('convent-settings', JSON.stringify(settings));
  } catch (e) {
    /* ignore */
  }
  document.body.classList.toggle('big-text', !!settings.bigText);
  for (const f of listeners) f(settings);
}
export function bindSettings() {
  for (const el of document.querySelectorAll('[data-setting]')) {
    const k = el.dataset.setting;
    if (el.type === 'checkbox') {
      el.checked = !!settings[k];
      el.addEventListener('change', () => {
        settings[k] = el.checked;
        saveSettings();
      });
    } else {
      el.value = settings[k];
      el.addEventListener('input', () => {
        settings[k] = Number(el.value);
        saveSettings();
      });
    }
  }
  $('btn-fullscreen').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  });
  $('btn-reset-settings').addEventListener('click', () => {
    Object.assign(settings, DEFAULTS);
    for (const el of document.querySelectorAll('[data-setting]')) {
      if (el.type === 'checkbox') el.checked = !!settings[el.dataset.setting];
      else el.value = settings[el.dataset.setting];
    }
    saveSettings();
  });
  document.body.classList.toggle('big-text', !!settings.bigText);
}

/* ---------- panels: only one full-screen panel shows at a time ---------- */
export function show(id) {
  for (const el of document.querySelectorAll('.panel')) el.classList.toggle('on', el.id === id);
  // the heads-up display belongs to the game itself
  document.body.classList.toggle('playing', !id || ['panel-paused', 'panel-out', 'panel-begin'].includes(id));
}
export function shown() {
  const el = document.querySelector('.panel.on');
  return el ? el.id : null;
}

/* ---------- heads-up display ---------- */
let toastTimer = 0;
export function toast(text, ms = 3200) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), ms);
}
// everything that has happened tonight, newest first, for the map's side card
export const news = [];
export function feed(text) {
  news.unshift(text);
  news.length = Math.min(news.length, 8);
  const el = $('feed');
  const row = document.createElement('div');
  row.textContent = text;
  el.prepend(row);
  while (el.children.length > 5) el.lastChild.remove();
  setTimeout(() => row.classList.add('old'), 9000);
}
export function setLives(n, tester) {
  $('lives').innerHTML = Array.from({ length: C.LIVES }, (_, i) => `<span class="life ${i < n ? 'on' : ''}" title="life"></span>`).join('') + (tester ? '<span class="tester">Tester: lives never run out</span>' : '');
}
export function setPrompt(text, key = 'E') {
  const el = $('prompt');
  if (!text) return el.classList.remove('on');
  el.innerHTML = key ? `<kbd>${key}</kbd> ${text}` : text;
  el.classList.add('on');
}
// what you carry: always on show, so you know your hands are empty too (you carry one thing at a time)
// ...and how much candy you have collected
export function setCarry(item, candy = 0) {
  const el = $('carry');
  el.classList.add('on');
  el.classList.toggle('empty', !item);
  const sweets = `<span class="candy-count" title="Walk over sweets to collect them">Candy: ${candy}</span>`;
  if (!item) el.innerHTML = `<span class="item-icon empty"></span><div><b>Your hands are empty</b><small>Search drawers and cupboards with <kbd>E</kbd></small></div>${sweets}`;
  else el.innerHTML = `<span class="item-icon ${item}"></span><div><b>You carry: ${C.ITEMS[item].name}</b><small>${C.ITEMS[item].hint}. <kbd>G</kbd> to drop</small></div>${sweets}`;
}

/* ---------- the side card on the map: the goal, what you carry, the monsters, the news ---------- */
const esc = (t) => String(t).replace(/[<>&]/g, '');
const STEPS = [
  ['power', 'Fix the fuse box in the gallery'],
  ['desk', "Open the Count's desk with the brass key"],
  ['keys', 'Bring three iron keys to the front door'],
  ['escape', 'Run out of the front door'],
];
export function mapSide({ stage, padlocks, keyRooms, carrying, candy = 0, lives, tester, monsters, dawn, clockLabel = 'Dawn in' }) {
  const at = STEPS.findIndex(([s]) => s === stage);
  const steps = STEPS.map(([s, text], i) => `<li class="${i < at ? 'done' : i === at ? 'now' : ''}">${i < at ? '✓ ' : ''}${text}${s === 'keys' && i === at ? ` (${padlocks} of 3)` : ''}</li>`).join('');
  const rooms = keyRooms.length ? `<p><b>Iron keys are in:</b> ${keyRooms.map((k) => L.ROOMS[k].name).join(', ')}</p>` : '';
  const hands = carrying ? `${C.ITEMS[carrying].name}: ${C.ITEMS[carrying].hint.toLowerCase()}` : 'Nothing yet';
  const sleeping = monsters.some((m) => m.kind === 'creature' && m.state === 'asleep');
  const zombies = monsters.filter((m) => m.kind === 'zombie').length;
  return `
    <h3>Your goal</h3><ol class="steps">${steps}</ol>${rooms}
    <p><b>You carry:</b> ${hands}</p>
    <p><b>Candy:</b> ${candy} <small>(walk over sweets to collect them)</small></p>
    <p><b>Lives:</b> ${tester ? 'never run out (tester)' : `${lives} of ${C.LIVES}`} · <b>${clockLabel}</b> ${dawn}</p>
    <h3>Who is in the house</h3>
    <ul class="who">
      <li>🧛 <b>The Count</b>: you hear him breathe. Shine your light in his face and he backs off.</li>
      <li>⚡ <b>The Doctor's Monster</b>: ${sleeping ? 'asleep in the Laboratory until the power is fixed.' : 'awake! Heavy footsteps, slow but sees far.'}</li>
      <li>🧟 <b>${zombies} ${zombies === 1 ? 'zombie' : 'zombies'}</b>: they groan, and shuffle around the graveyard.</li>
      <li>👻 <b>Ghosts</b>: they hum. Hold your flashlight on one until it vanishes.</li>
    </ul>
    <h3>What's happening</h3>
    <ul class="news">${news.length ? news.map((n) => `<li>${esc(n)}</li>`).join('') : '<li>All quiet, for now.</li>'}</ul>`;
}
export function setObjective(stage, padlocks, keyRooms) {
  let text = C.STAGES[stage];
  if (stage === 'keys') {
    const rooms = keyRooms.map((k) => L.ROOMS[k].name).join(', ');
    text = `Find the three iron keys${rooms ? ` (${rooms})` : ''} and bring them to the front door. ${padlocks} of 3 unlocked.`;
  }
  $('objective').textContent = text;
}
export function setTimer(sec, finale) {
  const s = Math.max(0, Math.ceil(sec));
  $('timer').innerHTML = `<small>${finale ? 'Door closes in' : 'Dawn in'}</small>${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  $('timer').classList.toggle('urgent', finale || s < 60);
}
let batteryLabel = '';
export function setBars(battery, stamina, lightOn, charging) {
  $('battery-fill').style.width = `${Math.round(battery * 100)}%`;
  $('battery').classList.toggle('low', battery < 0.2);
  $('battery').classList.toggle('off', !lightOn && !charging);
  $('battery').classList.toggle('charging', !!charging);
  // say what the flashlight is doing, in words
  const label = lightOn && battery <= 0 ? 'Dead. Press <kbd>F</kbd> to recharge' : charging ? 'Flashlight off, recharging' : 'Flashlight <kbd>F</kbd>';
  if (label !== batteryLabel) $('battery-label').innerHTML = batteryLabel = label;
  $('stamina-fill').style.width = `${Math.round(stamina * 100)}%`;
  $('stamina').classList.toggle('show', stamina < 0.98);
}

/* ---------- the map ---------- */
export const MONSTER_SIGN = { vampire: '🧛', creature: '⚡', zombie: '🧟' };
const ROOM_TINT = { c: '#3a352c', g: '#1f2a1c' };
export function drawMap(canvas, { me, others = [], monsters = null, ghosts = null, stage, keyRooms = [], host = false, loose = [], searched = [], secrets = null, candy = null }) {
  const g = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const s = Math.min(W / L.W, H / (L.H - 0.5));
  const ox = (W - L.W * s) / 2;
  const oy = (H - (L.H - 0.5) * s) / 2;
  const X = (x) => ox + (x / L.TILE) * s;
  const Y = (z) => oy + (z / L.TILE) * s;
  g.clearRect(0, 0, W, H);
  // rooms
  for (let r = 0; r < L.H; r++)
    for (let c = 0; c < L.W; c++) {
      const ch = L.at(c, r);
      if (ch === '#' || ch === ' ') continue;
      const keyRoom = keyRooms.includes(ch);
      g.fillStyle = ch === '+' ? '#6a5a40' : keyRoom ? '#5a4a22' : ROOM_TINT[ch] || '#4a4136';
      g.fillRect(ox + c * s, oy + r * s, s + 0.5, s + 0.5);
    }
  // furniture, faintly
  g.fillStyle = 'rgba(0,0,0,0.35)';
  for (const p of L.PROPS) if (p.solid) g.fillRect(X(p.x - p.hw), Y(p.z - p.hd), (p.hw * 2 * s) / L.TILE, (p.hd * 2 * s) / L.TILE);
  // walls drawn as outlines between floor and stone
  g.strokeStyle = '#d8c9a8';
  g.lineWidth = Math.max(1.5, s * 0.12);
  g.beginPath();
  for (let r = 0; r < L.H; r++)
    for (let c = 0; c < L.W; c++) {
      if (!L.floorTile(c, r)) continue;
      const x0 = ox + c * s;
      const y0 = oy + r * s;
      if (!L.floorTile(c, r - 1)) g.moveTo(x0, y0), g.lineTo(x0 + s, y0);
      if (!L.floorTile(c, r + 1)) g.moveTo(x0, y0 + s), g.lineTo(x0 + s, y0 + s);
      if (!L.floorTile(c - 1, r)) g.moveTo(x0, y0), g.lineTo(x0, y0 + s);
      if (!L.floorTile(c + 1, r)) g.moveTo(x0 + s, y0), g.lineTo(x0 + s, y0 + s);
    }
  g.stroke();
  // names of rooms
  g.fillStyle = '#e8dcc0';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const [k, rm] of Object.entries(L.ROOMS)) {
    if (k === 'c') continue;
    const cx = ox + ((rm.c0 + rm.c1 + 1) / 2) * s;
    const cy = oy + ((rm.r0 + rm.r1 + 1) / 2) * s;
    const words = rm.name.split(' ');
    const fs = Math.max(11, Math.min(s * 0.62, ((rm.c1 - rm.c0 + 1) * s) / Math.max(...words.map((w) => w.length)) * 1.7));
    g.font = `600 ${fs}px Georgia, serif`;
    words.forEach((w, i) => g.fillText(w, cx, cy + (i - (words.length - 1) / 2) * fs * 1.1));
  }
  g.font = `italic ${Math.max(11, s * 0.5)}px Georgia, serif`;
  g.fillText('Gallery', ox + 11 * s, oy + 7 * s);
  // the things that matter
  const icon = (x, z, color, text) => {
    g.fillStyle = color;
    g.beginPath();
    g.arc(X(x), Y(z), Math.max(5, s * 0.28), 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff';
    g.font = `700 ${Math.max(10, s * 0.4)}px Georgia, serif`;
    g.fillText(text, X(x), Y(z) + Math.max(10, s * 0.6));
  };
  icon(L.FUSEBOX.x, L.FUSEBOX.z, stage === 'power' ? '#ffcc33' : '#666', 'Fuse box');
  icon(L.OFFICE_DESK.x, L.OFFICE_DESK.z, stage === 'desk' ? '#ffcc33' : '#666', 'Desk');
  const [fx, fz] = L.centre(L.FRONT.c, L.FRONT.r);
  icon(fx, fz - 0.6, stage === 'keys' || stage === 'escape' ? '#ffcc33' : '#888', 'Front door');
  for (const l of loose) icon(l.x, l.z, '#ffd080', 'Dropped!');
  // places already searched and empty: a small grey tick
  g.font = `700 ${Math.max(10, s * 0.45)}px sans-serif`;
  g.fillStyle = 'rgba(200,200,190,0.75)';
  for (const p of searched) g.fillText('✓', X(p.x), Y(p.z));
  // tester mode: where things are hidden
  if (secrets)
    for (const it of secrets) {
      g.fillStyle = it.item === 'fuse' ? '#7fdfff' : it.item === 'brass' ? '#ffb347' : '#e0e0e0';
      g.beginPath();
      g.arc(X(it.x), Y(it.z), Math.max(4, s * 0.22), 0, Math.PI * 2);
      g.fill();
      g.font = `700 ${Math.max(9, s * 0.36)}px Georgia, serif`;
      g.fillText({ fuse: 'FUSE', brass: 'BRASS KEY' }[it.item] || 'IRON KEY', X(it.x), Y(it.z) - Math.max(9, s * 0.45));
    }
  // candy (big screen): tiny pink dots
  if (candy) {
    g.fillStyle = '#ff7eb6';
    for (const c of candy) {
      g.beginPath();
      g.arc(X(c.x), Y(c.z), Math.max(2, s * 0.09), 0, Math.PI * 2);
      g.fill();
    }
  }
  // people
  for (const o of others) {
    if (!o.visible) continue;
    g.fillStyle = '#9fd0ff';
    g.beginPath();
    g.arc(X(o.x), Y(o.z), Math.max(3.5, s * 0.2), 0, Math.PI * 2);
    g.fill();
    if (host && o.name) {
      g.font = `${Math.max(10, s * 0.38)}px Georgia, serif`;
      g.fillStyle = '#cfe6ff';
      g.fillText(o.name, X(o.x), Y(o.z) - Math.max(9, s * 0.45));
    }
  }
  // the monsters (big screen only): a red dot, brighter when hunting, grey while asleep, with a sign
  if (monsters)
    for (const n of monsters) {
      g.fillStyle = n.state === 'asleep' ? '#666' : n.state === 'chase' || n.state === 'finale' ? '#ff3030' : '#c02020';
      const r = Math.max(7, s * 0.42);
      g.beginPath();
      g.arc(X(n.x), Y(n.z), r, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#fff';
      g.lineWidth = 2;
      g.stroke();
      g.font = `${r * 1.3}px sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(MONSTER_SIGN[n.kind] || '', X(n.x), Y(n.z) + 1);
      g.textBaseline = 'alphabetic';
    }
  if (ghosts)
    for (const gh of ghosts) {
      if (!gh.alive) continue;
      g.fillStyle = 'rgba(220,230,255,0.85)';
      g.beginPath();
      g.arc(X(gh.x), Y(gh.z), Math.max(4, s * 0.24), 0, Math.PI * 2);
      g.fill();
    }
  if (me) {
    // you: an arrow pointing the way you face
    g.save();
    g.translate(X(me.x), Y(me.z));
    g.rotate(-me.yaw);
    const a = Math.max(8, s * 0.5);
    g.fillStyle = '#ffcc33';
    g.strokeStyle = '#000';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, -a);
    g.lineTo(a * 0.65, a * 0.7);
    g.lineTo(0, a * 0.35);
    g.lineTo(-a * 0.65, a * 0.7);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
  }
}
