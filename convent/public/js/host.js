// The big screen: who has joined, then a live map of the whole house (monsters and ghosts included,
// which the players cannot see), the progress so far, and the news as it happens.
import { io } from '/socket.io/socket.io.esm.min.js';
import * as L from '/shared/level.js';
import * as C from '/shared/config.js';
import { drawMap } from './ui.js';

const $ = (id) => document.getElementById(id);
const key = new URLSearchParams(location.search).get('key') || '';
const socket = io({ auth: { role: 'host', key }, transports: ['websocket', 'polling'] });
const S = { phase: 'LOBBY', roster: [], stage: 'power', padlocks: 0, keyRooms: [], t: 0, tAt: 0, finaleAt: 0, tick: null, searched: [] };
const esc = (s) => String(s).replace(/[<>&]/g, '');

const joinUrl = `${location.protocol}//${location.host}/`;
$('h-url').textContent = joinUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
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
  render();
}
function render() {
  section(S.phase === 'LOBBY' ? 'h-lobby' : S.phase === 'PLAYING' ? 'h-game' : 'h-results');
  const n = S.roster.length;
  $('h-count').textContent = n ? `${n} ${n === 1 ? 'person' : 'people'} inside` : 'Nobody here yet';
  $('h-roster').innerHTML = S.roster.map((p) => `<li style="--c:${C.LOOKS[p.look] || '#666'}">${esc(p.name)}</li>`).join('');
  $('h-start').disabled = !n;
  const order = ['power', 'desk', 'keys', 'escape'];
  for (const li of document.querySelectorAll('#h-steps li')) {
    const i = order.indexOf(li.dataset.s);
    const now = order.indexOf(S.stage);
    li.className = i < now ? 'done' : i === now ? 'now' : '';
  }
  $('h-locks').textContent = S.stage === 'keys' ? `(${S.padlocks} of 3)` : '';
  $('h-players').innerHTML = S.roster
    .map((p) => {
      const cls = p.state === 'dead' ? 'gone' : p.state === 'escaped' ? 'out' : '';
      const lives = p.state === 'escaped' ? 'escaped' : '●'.repeat(Math.max(0, p.lives)) + '○'.repeat(C.LIVES - Math.max(0, p.lives));
      return `<li class="${cls}">${esc(p.name)} <small>${lives}</small>${p.carrying ? ` <em>${C.ITEMS[p.carrying].name}</em>` : ''}</li>`;
    })
    .join('');
}
socket.on('denied', () => (document.body.innerHTML = '<p style="padding:40px">Wrong host key.</p>'));
socket.on('welcome', (m) => {
  apply(m);
  for (const f of m.feed || []) addFeed(f.text);
  if (m.result) results(m.result);
});
socket.on('roster', (r) => apply({ roster: r }));
socket.on('lobby', (m) => apply(m));
socket.on('start', (m) => {
  $('h-feed').innerHTML = '';
  apply(m);
});
socket.on('stage', (m) => apply(m));
socket.on('feed', (f) => addFeed(f.text));
socket.on('searched', (ids) => (S.searched = ids));
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
$('h-start').addEventListener('click', () => socket.emit('start', { difficulty: level }));
$('h-again').addEventListener('click', () => socket.emit('reset'));

function addFeed(text) {
  const el = document.createElement('div');
  el.textContent = text;
  $('h-feed').prepend(el);
  while ($('h-feed').children.length > 14) $('h-feed').lastChild.remove();
}
function results(r) {
  S.phase = 'RESULTS';
  $('h-result-title').textContent = r.escaped ? `${r.escaped} of ${r.total} escaped the manor!` : 'Nobody escaped. The manor keeps them all.';
  $('h-awards').innerHTML = r.awards.map((a) => `<li><b>${a.title}</b>${esc(a.name)}<br /><small>${a.why}</small></li>`).join('');
  $('h-scores').innerHTML = r.list.map((p) => `<li>${esc(p.name)}: ${p.score} ${{ escaped: '(escaped)', dead: '(taken)', kept: '' }[p.state]}</li>`).join('');
  render();
}

function frame() {
  requestAnimationFrame(frame);
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
    monsters: m.n.map(([id, x, z, yaw, state, kind]) => ({ x, z, state, kind })),
    ghosts: m.g.map(([id, x, z, alive]) => ({ x, z, alive })),
    loose: m.l.map(([id, item, x, z]) => ({ x, z })),
    stage: S.stage,
    keyRooms: S.keyRooms,
    searched: S.searched.map((id) => L.PROPS[id]),
  });
}
frame();
