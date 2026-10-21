// Escape the Convent: the player's browser. You walk the house in first person; the server tells us
// where everyone and everything else is.
import * as THREE from 'three';
import { io } from '/socket.io/socket.io.esm.min.js';
import * as L from '/shared/level.js';
import * as C from '/shared/config.js';
import { buildWorld } from './world.js';
import { Avatar, Nun, Ghost, looseItem } from './actors.js';
import { Sound } from './audio.js';
import { Dust, Haunts, setDanger } from './atmosphere.js';
import { propModels } from './models.js';
import * as UI from './ui.js';

const { $ } = UI;
const dangerEl = $('danger');
const DEBUG = new URLSearchParams(location.search).has('debug');
const EYE = 1.62;
const RADIUS = 0.3;

/* ---------- renderer and world ---------- */
const canvas = $('view');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  UI.show('panel-nogl');
  throw e;
}
renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const world = buildWorld(renderer);
const { scene } = world;
// furniture models, when /assets/models/models.json lists them, replace the built shapes
propModels().then((m) => m && world.placeProps(m));
const camera = new THREE.PerspectiveCamera(72, 1, 0.05, 80);
camera.rotation.order = 'YXZ';
scene.add(camera);
const dust = new Dust(camera);
scene.add(dust.points);
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  dust.resize(h);
}
window.addEventListener('resize', resize);
resize();

// the flashlight you carry
const torch = new THREE.SpotLight(0xffe6c0, 22, 28, 0.62, 0.9, 1.25);
torch.castShadow = true;
torch.shadow.mapSize.set(1024, 1024);
torch.shadow.camera.near = 0.2;
torch.shadow.camera.far = 26;
torch.shadow.bias = -0.0004;
torch.position.set(0.18, -0.22, 0.1);
camera.add(torch);
camera.add(torch.target);
torch.target.position.set(0, -0.15, -5);
// a little light of your own so the room right around you is never pitch black
const near = new THREE.PointLight(0x9aa0b8, 0.25, 4, 2);
camera.add(near);

const sound = new Sound();
const haunts = new Haunts(scene, sound);
UI.bindSettings();
UI.onSettings((s) => {
  sound.setVolume({ master: s.master, music: s.music, sfx: s.sfx });
  renderer.toneMappingExposure = 0.8 + s.brightness * 1.1;
  near.intensity = 0.15 + s.brightness * 0.6;
  scene.fog.density = 0.06 - s.brightness * 0.03;
});

/* ---------- state ---------- */
const S = {
  id: null,
  phase: 'JOIN',
  stage: 'power',
  padlocks: 0,
  keyRooms: [],
  doors: {},
  me: { x: L.SPAWN.x, z: L.SPAWN.z, yaw: L.SPAWN.yaw, pitch: 0, lives: C.LIVES, state: 'alive', carrying: null, hidden: null, safeUntil: 0 },
  battery: 1,
  stamina: 1,
  light: true,
  t: 0, // server clock
  tAt: 0, // when we last heard it
  finaleAt: 0,
  roster: [],
  avatars: new Map(),
  nuns: new Map(),
  ghosts: new Map(),
  loose: new Map(),
  looseInfo: [],
  keys: {},
  mapOn: false,
  locked: false,
  scare: null, // the moment of being caught
  watching: null, // whom you follow once you are out
  heartbeatAt: 0,
  chaseUntil: 0,
  bellAt: {},
  stepAt: 0,
  sendAt: 0,
  shine: {},
  dread: 0,
  fovKick: 0,
};
const serverNow = () => S.t + (performance.now() - S.tAt) / 1000;

/* ---------- network ---------- */
const socket = io({ transports: ['websocket', 'polling'] });
let token = '';
try {
  token = localStorage.getItem('convent-token') || '';
} catch (e) {
  /* ignore */
}
socket.on('connect', () => {
  if (S.joinedName) socket.emit('join', { name: S.joinedName, look: S.look, token });
});
socket.on('full', () => UI.toast('The game is full, sorry.'));
socket.on('welcome', (m) => {
  S.id = m.id;
  token = m.token;
  try {
    localStorage.setItem('convent-token', token);
  } catch (e) {
    /* ignore */
  }
  applyState(m);
  if (m.me) applyMe(m.me, true);
  if (m.phase === 'LOBBY') UI.show('panel-lobby');
  else if (m.phase === 'PLAYING') beginPrompt();
  else if (m.phase === 'RESULTS') showResults(m.result);
});
socket.on('roster', (r) => {
  S.roster = r;
  renderRoster();
});
// a new night: clear out whoever was in the house last time
function clearHouse() {
  for (const a of S.avatars.values()) a.remove();
  for (const n of S.nuns.values()) {
    n.remove();
    n.voice?.out.disconnect();
  }
  for (const g of S.ghosts.values()) g.remove();
  for (const l of S.loose.values()) scene.remove(l.mesh);
  S.avatars.clear();
  S.nuns.clear();
  S.ghosts.clear();
  S.loose.clear();
  sound.setChase(0);
}
socket.on('start', (m) => {
  clearHouse();
  haunts.reset();
  applyState(m);
  Object.assign(S.me, { lives: C.LIVES, state: 'alive', hidden: null, carrying: null, pitch: 0 });
  UI.setLives(C.LIVES);
  UI.setCarry(null);
  $('hiding').className = '';
  S.battery = 1;
  S.stamina = 1;
  S.light = true;
  beginPrompt();
});
socket.on('lobby', (m) => {
  clearHouse();
  applyState(m);
  S.phase = 'LOBBY';
  Object.assign(S.me, { lives: C.LIVES, state: 'alive', hidden: null, carrying: null });
  document.exitPointerLock();
  UI.show('panel-lobby');
});
socket.on('me', (m) => applyMe(m));
socket.on('doors', (d) => {
  for (const [id, open] of Object.entries(d)) {
    if (S.doors[id] !== open) world.setDoor(id, open);
  }
  S.doors = d;
});
socket.on('stage', (m) => {
  const was = S.stage;
  applyState(m);
  if (was === 'power' && m.stage !== 'power') {
    sound.powerUp();
    UI.toast('The lights flicker on in the cloister.');
  }
  if (m.stage === 'escape' && was !== 'escape') UI.toast('The front door is open. RUN!', 5000);
});
socket.on('feed', (f) => UI.feed(f.text));
socket.on('toast', (t) => UI.toast(t));
socket.on('note', (text) => {
  $('note-text').textContent = text;
  $('note').classList.add('on');
  setTimeout(() => $('note').classList.remove('on'), 9000);
});
socket.on('found', (m) => {
  sound.play('search', { vol: 0.8 });
  const p = L.PROPS[m.prop];
  if (!m.item) return UI.toast(`Nothing here. (${p.box.replace(/^\w+ /, '').replace(/^the /, 'The ')})`, 2200);
  if (m.item === 'battery') {
    S.battery = Math.min(1, S.battery + C.BATTERY.refill);
    sound.chime();
    return UI.toast('You found batteries! Your flashlight is brighter.');
  }
  if (m.full) return UI.toast(`There's a ${C.ITEMS[m.item].name.toLowerCase()} here, but your hands are full.`);
  sound.chime();
  UI.toast(`You found the ${C.ITEMS[m.item].name.toLowerCase()}! ${C.ITEMS[m.item].hint}.`, 5000);
});
socket.on('spotted', () => {
  S.chaseUntil = performance.now() + 6000;
  S.fovKick = 1;
  UI.toast("She's seen you. RUN! (hold Shift)", 3500);
});
socket.on('sfx', (m) => onSfx(m));
socket.on('hit', (m) => onHit(m));
socket.on('end', (r) => showResults(r));
socket.on('tick', (m) => onTick(m));

function applyState(m) {
  if (m.phase) S.phase = m.phase;
  if (m.stage) S.stage = m.stage;
  if (m.padlocks != null) S.padlocks = m.padlocks;
  if (m.keyRooms) S.keyRooms = m.keyRooms;
  if (m.finaleAt != null) S.finaleAt = m.finaleAt;
  if (m.grace != null) S.grace = m.grace;
  if (m.t != null) {
    S.t = m.t;
    S.tAt = performance.now();
  }
  if (m.doors) {
    for (const [id, open] of Object.entries(m.doors)) world.setDoor(id, open);
    S.doors = m.doors;
  }
  if (m.roster) {
    S.roster = m.roster;
    renderRoster();
  }
  world.setPower(S.stage !== 'power');
  world.setPadlocks(S.padlocks);
  UI.setObjective(S.stage, S.padlocks, S.keyRooms);
}
function applyMe(m, jump) {
  const was = S.me.hidden;
  Object.assign(S.me, { lives: m.lives, state: m.state, carrying: m.carrying, hidden: m.hidden, safeUntil: m.safeUntil });
  if (jump || (was != null && m.hidden == null)) {
    S.me.x = m.x;
    S.me.z = m.z;
    if (jump) S.me.yaw = m.yaw;
  }
  UI.setLives(S.me.lives);
  UI.setCarry(S.me.carrying);
  $('hiding').className = m.hidden != null ? `on ${L.PROPS[m.hidden].type}` : '';
  if (m.state === 'dead') {
    $('out-title').textContent = 'The convent keeps you.';
    $('out-text').textContent = 'You were caught three times. You can still watch the others: click to switch whom you follow.';
    UI.show('panel-out');
    document.exitPointerLock();
  }
  if (m.state === 'escaped') {
    $('out-title').textContent = 'You escaped!';
    $('out-text').textContent = 'You are out in the cold night air. Watch the others make it out: click to switch whom you follow.';
    UI.show('panel-out');
    document.exitPointerLock();
    sound.play('win', { vol: 0.7 });
  }
}

/* ---------- joining ---------- */
const looks = $('looks');
S.look = 0;
C.LOOKS.forEach((c, i) => {
  const b = document.createElement('button');
  b.className = 'look' + (i === 0 ? ' on' : '');
  b.style.background = c;
  b.type = 'button';
  b.setAttribute('aria-label', `Colour ${i + 1}`);
  b.addEventListener('click', () => {
    S.look = i;
    for (const x of looks.children) x.classList.toggle('on', x === b);
  });
  looks.appendChild(b);
});
try {
  $('name').value = localStorage.getItem('convent-name') || '';
} catch (e) {
  /* ignore */
}
$('join-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('name').value.trim();
  if (!name) return $('name').focus();
  try {
    localStorage.setItem('convent-name', name);
  } catch (err) {
    /* ignore */
  }
  S.joinedName = name;
  fetch('/assets/sounds.json')
    .then((r) => r.json())
    .catch(() => [])
    .then((files) => sound.start(files));
  socket.emit('join', { name, look: S.look, token });
});
function renderRoster() {
  const el = $('roster');
  if (!el) return;
  el.innerHTML = S.roster.map((p) => `<li style="--c:${C.LOOKS[p.look] || '#666'}">${p.name.replace(/[<>&]/g, '')}${p.id === S.id ? ' <em>(you)</em>' : ''}</li>`).join('');
  $('roster-count').textContent = `${S.roster.length} ${S.roster.length === 1 ? 'person' : 'people'} inside`;
}

/* ---------- pointer lock: click to step in, Esc for settings ---------- */
function beginPrompt() {
  S.phase = 'PLAYING';
  if (S.me.state !== 'alive') return applyMe({ ...S.me });
  UI.show('panel-begin');
}
function lock() {
  sound.start();
  canvas.requestPointerLock?.();
  // some browsers refuse pointer lock (or the test harness has none): play on anyway
  setTimeout(() => {
    if (!S.locked && S.phase === 'PLAYING' && S.me.state === 'alive') UI.show(null);
  }, 300);
}
for (const id of ['panel-begin', 'panel-paused']) $(id).addEventListener('click', (e) => {
  if (e.target.closest('.settings') || e.target.closest('button[data-noresume]')) return;
  lock();
});
$('btn-settings-lobby').addEventListener('click', () => $('settings-lobby').classList.toggle('on'));
document.addEventListener('pointerlockchange', () => {
  S.locked = document.pointerLockElement === canvas;
  if (S.locked) UI.show(null);
  else if (S.phase === 'PLAYING' && S.me.state === 'alive' && !S.scare) UI.show('panel-paused');
});
canvas.addEventListener('click', () => {
  if (S.phase !== 'PLAYING') return;
  if (S.me.state !== 'alive') return nextWatch();
  if (!S.locked) return lock();
  interact();
});
$('panel-out').addEventListener('click', () => nextWatch());
document.addEventListener('mousemove', (e) => {
  if (!S.locked || S.me.state !== 'alive' || S.scare) return;
  const k = 0.0008 + UI.settings.sensitivity * 0.0034;
  S.me.yaw -= e.movementX * k;
  S.me.pitch -= e.movementY * k * (UI.settings.invert ? -1 : 1);
  S.me.pitch = Math.max(-1.35, Math.min(1.35, S.me.pitch));
});
const GAME_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight', 'KeyE', 'KeyF', 'KeyM', 'Space', 'Tab']);
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (GAME_KEYS.has(e.code) && S.phase === 'PLAYING') e.preventDefault();
  if (e.repeat) return;
  S.keys[e.code] = true;
  if (S.phase !== 'PLAYING') return;
  if (e.code === 'KeyM' || e.code === 'Tab') toggleMap();
  if (S.me.state !== 'alive') {
    if (e.code === 'Space' || e.code === 'ArrowRight') nextWatch();
    return;
  }
  if (S.me.hidden != null && ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'KeyE', 'Space'].includes(e.code)) return socket.emit('unhide');
  if (e.code === 'KeyE' || e.code === 'Space') interact();
  if (e.code === 'KeyF') {
    if (!S.light && S.battery <= 0) return UI.toast('Your flashlight is dead. Look for batteries in drawers and cupboards.');
    S.light = !S.light;
    sound.click();
  }
});
document.addEventListener('keyup', (e) => delete S.keys[e.code]);
window.addEventListener('blur', () => (S.keys = {}));
function toggleMap() {
  S.mapOn = !S.mapOn;
  $('map').classList.toggle('on', S.mapOn);
}
$('btn-map').addEventListener('click', toggleMap);
$('map').addEventListener('click', toggleMap);

/* ---------- moving ---------- */
function blocked(x, z, r) {
  for (const s of world.solids) {
    if (s.door && !s.on) continue;
    if (x + r < s.x0 || x - r > s.x1 || z + r < s.z0 || z - r > s.z1) continue;
    const cx = Math.max(s.x0, Math.min(x, s.x1));
    const cz = Math.max(s.z0, Math.min(z, s.z1));
    if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) return true;
  }
  return false;
}
function move(dt) {
  const k = S.keys;
  const me = S.me;
  const arrowsTurn = UI.settings.arrowsTurn;
  let fwd = (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0);
  let side = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0);
  fwd += (k.ArrowUp ? 1 : 0) - (k.ArrowDown ? 1 : 0);
  if (arrowsTurn) me.yaw += ((k.ArrowLeft ? 1 : 0) - (k.ArrowRight ? 1 : 0)) * dt * 2.2;
  else side += (k.ArrowRight ? 1 : 0) - (k.ArrowLeft ? 1 : 0);
  fwd = Math.max(-1, Math.min(1, fwd));
  side = Math.max(-1, Math.min(1, side));
  const moving = fwd !== 0 || side !== 0;
  const wantRun = (k.ShiftLeft || k.ShiftRight) && moving && fwd >= 0;
  const run = wantRun && S.stamina > 0.02;
  S.stamina = run ? Math.max(0, S.stamina - dt / C.STAMINA) : Math.min(1, S.stamina + (dt * C.STAMINA_BACK) / C.STAMINA * (moving ? 1 : 1.6));
  if (wantRun && !run && !S.toldBreath) {
    S.toldBreath = true;
    UI.toast("You're out of breath. Walk for a moment.", 2000);
  }
  if (!wantRun) S.toldBreath = false;
  const speed = run ? C.RUN : C.WALK;
  let dx = 0;
  let dz = 0;
  if (moving) {
    const len = Math.hypot(fwd, side);
    const f = fwd / len;
    const sd = side / len;
    dx = (-Math.sin(me.yaw) * f + Math.cos(me.yaw) * sd) * speed * dt;
    dz = (-Math.cos(me.yaw) * f - Math.sin(me.yaw) * sd) * speed * dt;
  }
  // slide along walls: try each axis on its own
  if (!blocked(me.x + dx, me.z, RADIUS)) me.x += dx;
  if (!blocked(me.x, me.z + dz, RADIUS)) me.z += dz;
  me.moving = moving;
  me.run = run;
  // footsteps
  if (moving) {
    S.walked = (S.walked || 0) + Math.hypot(dx, dz);
    if (S.walked > (run ? 1.9 : 1.45)) {
      S.walked = 0;
      sound.play('step', { vol: run ? 0.55 : 0.3, rate: 0.9 + Math.random() * 0.15 });
    }
  }
  return { moving, run };
}

/* ---------- pointing at things ---------- */
const ray = new THREE.Raycaster();
const centre = new THREE.Vector2(0, 0);
let aim = null;
function findAim() {
  ray.setFromCamera(centre, camera);
  ray.far = C.REACH + 1.6;
  const hits = ray.intersectObjects(world.targets, false);
  let act = null;
  for (const h of hits) {
    if (h.object.userData.act && h.distance <= C.REACH + 1.2) {
      act = { ...h.object.userData.act, dist: h.distance };
      break;
    }
    // something solid in the way
    if (h.distance < 0.6) break;
  }
  // nothing under the crosshair: anything you can use right in front of you counts too,
  // so you do not have to aim at a low drawer exactly
  if (!act) {
    const fx = -Math.sin(S.me.yaw);
    const fz = -Math.cos(S.me.yaw);
    let best = 1.9;
    for (const p of L.PROPS) {
      if (!p.box && !p.hide && !p.special) continue;
      const cx = Math.max(p.x - p.hw, Math.min(S.me.x, p.x + p.hw));
      const cz = Math.max(p.z - p.hd, Math.min(S.me.z, p.z + p.hd));
      const d = Math.hypot(cx - S.me.x, cz - S.me.z);
      const ang = Math.acos(Math.max(-1, Math.min(1, ((p.x - S.me.x) * fx + (p.z - S.me.z) * fz) / (Math.hypot(p.x - S.me.x, p.z - S.me.z) || 1))));
      if (d < best && ang < 0.75) {
        best = d;
        act = { kind: p.special || (p.box ? 'search' : 'hide'), prop: p.id, dist: d };
      }
    }
    for (const d of L.DOORS) {
      if (d.arch) continue;
      const [x, z] = L.centre(d.c, d.r);
      const dist = Math.hypot(x - S.me.x, z - S.me.z);
      const ang = Math.acos(Math.max(-1, Math.min(1, ((x - S.me.x) * fx + (z - S.me.z) * fz) / (dist || 1))));
      if (dist < Math.min(best + 0.8, 2.4) && ang < 0.6) {
        best = dist - 0.8;
        act = { kind: d.front ? 'front' : 'door', id: d.id, dist };
      }
    }
  }
  // items dropped on the floor: look roughly at them
  for (const [id, l] of S.loose) {
    const d = Math.hypot(l.x - S.me.x, l.z - S.me.z);
    if (d < C.REACH && (!act || d < act.dist)) act = { kind: 'pickup', id, item: l.item, dist: d };
  }
  return act;
}
function describe(a) {
  if (!a) return null;
  const carrying = S.me.carrying;
  switch (a.kind) {
    case 'door':
      return S.doors[a.id] ? 'Close the door' : 'Open the door';
    case 'front':
      if (S.stage === 'escape') return null;
      if (/^key/.test(carrying || '')) return 'Unlock a padlock with your iron key';
      return [`The front door: ${3 - S.padlocks} padlock${3 - S.padlocks === 1 ? '' : 's'} left`, ''];
    case 'search':
      return L.PROPS[a.prop].box;
    case 'hide':
      return L.PROPS[a.prop].hide;
    case 'fusebox':
      if (S.stage !== 'power') return ['The fuse box hums', ''];
      return carrying === 'fuse' ? 'Put the fuse in' : ['The fuse box. A fuse is missing', ''];
    case 'desk':
      if (S.stage === 'power') return ["Mother Superior's desk. Locked", ''];
      if (S.stage === 'desk') return carrying === 'brass' ? 'Unlock the desk with the brass key' : ["Mother Superior's desk. It needs a small brass key", ''];
      return 'Read the note again';
    case 'pickup':
      return `Pick up the ${C.ITEMS[a.item].name.toLowerCase()}`;
  }
  return null;
}
function interact() {
  if (S.me.state !== 'alive' || S.scare) return;
  const a = aim;
  if (!a) return;
  if (a.kind === 'door' || a.kind === 'front') {
    if (a.kind === 'front') return socket.emit('use', { what: 'front' });
    return socket.emit('door', { id: a.id });
  }
  if (a.kind === 'search') return socket.emit('search', { prop: a.prop });
  if (a.kind === 'hide') return socket.emit('hide', { prop: a.prop });
  if (a.kind === 'fusebox') return socket.emit('use', { what: 'fusebox' });
  if (a.kind === 'desk') return socket.emit('use', { what: 'desk' });
  if (a.kind === 'pickup') return socket.emit('pickup', { id: a.id });
}

/* ---------- what the server tells us every tick ---------- */
function onTick(m) {
  S.t = m.t;
  S.tAt = performance.now();
  const seen = new Set();
  for (const [id, x, z, yaw, anim, light, state] of m.p) {
    if (id === S.id) continue;
    seen.add(id);
    let a = S.avatars.get(id);
    if (!a) {
      const info = S.roster.find((r) => r.id === id) || { name: '?', look: 0 };
      a = new Avatar(scene, { ...info, id, x, z });
      S.avatars.set(id, a);
    }
    a.set(x, z, yaw, anim, light, state);
  }
  for (const [id, a] of S.avatars) if (!seen.has(id)) (a.remove(), S.avatars.delete(id));
  for (const [id, x, z, yaw, state] of m.n) {
    let n = S.nuns.get(id);
    if (!n) {
      n = new Nun(scene);
      n.x = n.tx = x;
      n.z = n.tz = z;
      S.nuns.set(id, n);
      n.voice = sound.ctx ? sound.makeHum(S.nuns.size - 1) : null;
    }
    n.set(x, z, yaw, state);
  }
  for (const [id, x, z, alive, chasing] of m.g) {
    let g = S.ghosts.get(id);
    if (!g) {
      g = new Ghost(scene);
      g.x = g.tx = x;
      g.z = g.tz = z;
      S.ghosts.set(id, g);
    }
    g.set(x, z, alive, chasing);
  }
  const ls = new Set();
  for (const [id, item, x, z] of m.l) {
    ls.add(id);
    if (!S.loose.has(id)) {
      const mesh = looseItem(scene, item);
      mesh.position.set(x, 0, z);
      S.loose.set(id, { mesh, item, x, z });
    }
  }
  for (const [id, l] of S.loose) if (!ls.has(id)) (scene.remove(l.mesh), S.loose.delete(id));
}

function onSfx({ kind, x, z }) {
  if (!sound.ctx) return;
  const muffled = !L.clearLine(S.me.x, S.me.z, x, z, (id) => S.doors[id]);
  const at = [x, z];
  if (kind === 'door-open') sound.play('doorOpen', { at, vol: 0.8, muffled });
  if (kind === 'door-close') sound.play('slam') || sound.play('doorClose', { at, vol: 0.9, rate: 0.7, muffled });
  if (kind === 'door-creak') sound.play('doorCreak', { at, vol: 0.9, muffled });
  if (kind === 'shriek') sound.shriek(x, z);
  if (kind === 'boo') sound.boo(x, z);
  if (kind === 'banish') sound.shriek(x, z);
  if (kind === 'padlock' || kind === 'unlock') sound.clunk(x, z);
  if (kind === 'power') sound.clunk(x, z);
  if (kind === 'pull') sound.play('doorOpen', { at, vol: 1 });
  // the house acting up on its own
  if (kind === 'slam') sound.slam(x, z, muffled);
  if (kind === 'knock') sound.knock(x, z, muffled);
  if (kind === 'wail' && !UI.settings.gentle) sound.wail(x, z);
  if (kind === 'flicker' && S.stage !== 'power') {
    world.dip(2.6);
    sound.buzz(x, z, 2.6);
  }
}

/* ---------- being caught ---------- */
function onHit(m) {
  const nun = m.by === 'nun' ? [...S.nuns.values()].sort((a, b) => Math.hypot(a.x - S.me.x, a.z - S.me.z) - Math.hypot(b.x - S.me.x, b.z - S.me.z))[0] : null;
  const ghost = m.by === 'ghost' ? [...S.ghosts.values()].sort((a, b) => Math.hypot(a.x - S.me.x, a.z - S.me.z) - Math.hypot(b.x - S.me.x, b.z - S.me.z))[0] : null;
  const who = nun || ghost;
  S.scare = { t: 0, start: performance.now(), who, by: m.by, m };
  sound.sting(UI.settings.gentle);
  sound.play('hit', { vol: 0.8 });
  UI.setLives(m.lives);
}
function updateScare(dt) {
  const sc = S.scare;
  sc.t = (performance.now() - sc.start) / 1000;
  const gentle = UI.settings.gentle;
  // in the first moment the camera snaps round to whoever got you, right up close
  if (sc.who && !gentle) {
    const want = Math.atan2(-(sc.who.x - S.me.x), -(sc.who.z - S.me.z));
    let d = want - S.me.yaw;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    S.me.yaw += d * Math.min(1, dt * 14);
    S.me.pitch += ((sc.by === 'nun' ? 0.12 : 0) - S.me.pitch) * Math.min(1, dt * 10);
  }
  const black = $('blackout');
  if (sc.t > (gentle ? 0.1 : 0.9)) black.classList.add('on');
  if (sc.t > 2.6) {
    const m = sc.m;
    if (m.lives > 0) {
      S.me.x = m.x;
      S.me.z = m.z;
      S.me.yaw = m.yaw;
      S.me.pitch = 0;
      $('wake').textContent = `You wake up in the dormitory. ${m.lives} ${m.lives === 1 ? 'life' : 'lives'} left.`;
      $('wake').classList.add('on');
      setTimeout(() => $('wake').classList.remove('on'), 4000);
    }
    black.classList.remove('on');
    S.scare = null;
  }
}

/* ---------- following someone once you are out ---------- */
function nextWatch() {
  const ids = [...S.avatars.keys()].filter((id) => S.avatars.get(id).present);
  if (!ids.length) return (S.watching = null);
  const i = ids.indexOf(S.watching);
  S.watching = ids[(i + 1) % ids.length];
  const r = S.roster.find((p) => p.id === S.watching);
  $('watching').textContent = r ? `Watching ${r.name}` : '';
}

/* ---------- results ---------- */
function showResults(r) {
  if (!r) return;
  S.phase = 'RESULTS';
  document.exitPointerLock();
  sound.setChase(0);
  $('result-title').textContent = r.escaped ? `${r.escaped} of ${r.total} escaped the convent` : 'Nobody escaped. The convent keeps you all.';
  $('awards').innerHTML = r.awards.map((a) => `<li><b>${a.title}</b>${a.name.replace(/[<>&]/g, '')}<small>${a.why}</small></li>`).join('');
  $('scores').innerHTML = r.list
    .map((p) => `<tr class="${p.id === S.id ? 'me' : ''}"><td>${p.name.replace(/[<>&]/g, '')}</td><td>${{ escaped: 'Escaped', dead: 'Taken', kept: 'Still inside' }[p.state]}</td><td>${p.score}</td></tr>`)
    .join('');
  UI.show('panel-results');
}

/* ---------- keeping it smooth on slower laptops ---------- */
const perf = { frames: 0, since: performance.now(), level: 0 };
function watchSpeed(now) {
  perf.frames++;
  if (now - perf.since < 4000) return;
  const fps = (perf.frames * 1000) / (now - perf.since);
  perf.frames = 0;
  perf.since = now;
  if (fps > 26 || perf.level >= 3 || S.phase !== 'PLAYING' || document.hidden) return;
  perf.level++;
  if (perf.level === 1) renderer.setPixelRatio(1);
  if (perf.level === 2) {
    renderer.setPixelRatio(0.75);
    renderer.shadowMap.type = THREE.BasicShadowMap;
    torch.shadow.mapSize.set(512, 512);
    torch.shadow.map?.dispose();
    torch.shadow.map = null;
  }
  if (perf.level === 3) {
    // still slow: no shadows at all, less rain, no dust
    renderer.setPixelRatio(0.6);
    torch.castShadow = false;
    world.lessRain();
    dust.points.visible = false;
    dust.off = true;
  }
  resize();
}

/* ---------- every frame ---------- */
const clock = new THREE.Clock();
let mapCanvasSized = false;
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta());
  const now = performance.now();
  const t = now / 1000;
  const playing = S.phase === 'PLAYING';
  const me = S.me;
  if (!DEBUG) watchSpeed(now);
  let moving = false;
  let run = false;

  if (playing && me.state === 'alive' && me.hidden == null && !S.scare && (S.locked || !UI.shown())) ({ moving, run } = move(dt));
  if (S.scare) updateScare(dt);

  // the camera: your eyes, or a hiding place, or someone you watch
  if (me.state === 'alive' || !playing) {
    let ex = me.x;
    let ez = me.z;
    let ey = EYE;
    if (me.hidden != null) {
      const p = L.PROPS[me.hidden];
      const f = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] }[p.face];
      ey = p.type === 'bed' ? 0.22 : 1.5;
      const out = p.type === 'bed' ? p.hd - 0.25 : p.hd - 0.1;
      ex = p.x + f[0] * (p.type === 'bed' ? 0 : out);
      ez = p.z + f[1] * (p.type === 'bed' ? 0 : out);
      if (p.type === 'bed') {
        // under the bed, looking out of its side
        ex = p.x + (p.face === 'N' || p.face === 'S' ? 0.25 : 0);
        ez = p.z;
      }
    }
    // a gentle head bob while walking
    S.bob = (S.bob || 0) + (moving ? dt * (run ? 13 : 8.5) : 0);
    const bob = moving ? Math.sin(S.bob) * (run ? 0.05 : 0.03) : 0;
    // and a slow breath while standing still
    const breath = moving ? 0 : Math.sin(t * 1.5) * 0.008;
    camera.position.set(ex, ey + bob + breath, ez);
    camera.rotation.set(me.pitch, me.yaw, 0);
  } else {
    const w = S.watching && S.avatars.get(S.watching);
    if (!w || !w.present) nextWatch();
    if (w) {
      camera.position.set(w.x + Math.sin(w.yaw) * 2.2, EYE + 0.5, w.z + Math.cos(w.yaw) * 2.2);
      camera.rotation.set(-0.15, w.yaw, 0);
    }
  }

  // flashlight and battery
  if (playing && me.state === 'alive' && S.light) S.battery = Math.max(0, S.battery - dt * C.BATTERY.drainPerSec);
  if (S.battery <= 0 && S.light) {
    S.light = false;
    UI.toast('Your flashlight died. Find batteries in drawers and cupboards.');
  }
  // the flashlight stutters when the battery is low, and when something is close
  const flick = S.battery < 0.2 || S.dread > 0.35 ? (Math.sin(t * 31) * Math.sin(t * 7.3) > 1 - Math.max(S.dread * 0.5, S.battery < 0.2 ? 0.4 : 0) ? 0.25 : 1) : 1;
  torch.intensity = S.light && me.hidden == null ? 22 * (0.55 + 0.45 * Math.min(1, S.battery * 3)) * flick : 0;
  torch.visible = me.state === 'alive';
  UI.setBars(S.battery, S.stamina, S.light);

  // tell the server where we are, ten times a second
  if (playing && me.state === 'alive' && !S.scare && now - S.sendAt > 100) {
    S.sendAt = now;
    socket.emit('state', { x: +me.x.toFixed(2), z: +me.z.toFixed(2), yaw: +me.yaw.toFixed(2), run, moving, light: S.light && S.battery > 0 });
  }

  // everyone else
  // other people: skip drawing the ones behind walls or lost in the dark (checked a few times a second)
  const lookAgain = (S.frameN = (S.frameN || 0) + 1) % 6 === 0;
  for (const a of S.avatars.values()) {
    const d = Math.hypot(a.x - camera.position.x, a.z - camera.position.z);
    if (lookAgain) a.inView = d < 6 || (d < 30 && L.clearLine(camera.position.x, camera.position.z, a.x, a.z, (id) => S.doors[id]));
    a.update(dt, d);
  }
  let nearestNun = Infinity;
  let hunted = false;
  for (const [id, n] of S.nuns) {
    const moved = n.update(dt);
    const d = Math.hypot(n.x - me.x, n.z - me.z);
    nearestNun = Math.min(nearestNun, d);
    if ((n.state === 'chase' || n.state === 'finale') && d < 18) hunted = true;
    // her hum and her bell
    if (sound.ctx) {
      if (!n.voice) n.voice = sound.makeHum(S.nuns.size);
      const clear = L.clearLine(me.x, me.z, n.x, n.z, (id) => S.doors[id]);
      n.voice.set(n.x, n.z, n.state === 'chase' || n.state === 'finale' ? 0.05 : 0.55, !clear);
      if (moved > 0.01 && t - (S.bellAt[id] || 0) > 0.75) {
        S.bellAt[id] = t;
        if (d < 22) sound.bell(n.x, n.z, !clear);
      }
    }
  }
  let nearestGhost = Infinity;
  for (const g of S.ghosts.values()) {
    g.update(dt, camera.position.x, camera.position.z);
    if (g.alive) nearestGhost = Math.min(nearestGhost, Math.hypot(g.x - me.x, g.z - me.z));
  }
  // how close something is: makes the flashlight stutter and the edges of the screen darken
  const alive = playing && me.state === 'alive';
  S.dread = alive ? Math.max(0, 1 - nearestNun / 9, 0.7 * (1 - nearestGhost / 5)) : 0;
  setDanger(dangerEl, alive ? Math.max(0, 1 - nearestNun / 14) : 0, alive && (hunted && nearestNun < 18 || now < S.chaseUntil), t, UI.settings.gentle);
  haunts.update(dt, {
    me,
    eye: camera.position,
    calm: alive && !hunted && now > S.chaseUntil && nearestNun > 10 && me.hidden == null && !S.scare,
    gentle: UI.settings.gentle,
    playing: alive,
    lit: S.light && torch.intensity > 0,
    open: (x0, z0, x1, z1) => L.clearLine(x0, z0, x1, z1, (id) => S.doors[id]),
  });
  for (const o of S.previews || []) o.update(dt, camera.position.x, camera.position.z);
  for (const l of S.loose.values()) l.mesh.rotation.y += dt * 2;

  if (sound.ctx && playing) {
    sound.listen(camera.position.x, camera.position.z, camera.rotation.y);
    // heartbeat when a nun is close, faster the closer she is
    if (me.state === 'alive' && nearestNun < 14) {
      const k = 1 - nearestNun / 14;
      if (now - S.heartbeatAt > 1100 - k * 650) {
        S.heartbeatAt = now;
        sound.heartbeat(0.15 + k * 0.6);
      }
    }
    sound.setChase(me.state === 'alive' && (hunted && nearestNun < 18 || now < S.chaseUntil) ? 1 : 0);
    const y = world.yard;
    const dx = Math.max(y.x0 - me.x, 0, me.x - y.x1);
    const dz = Math.max(y.z0 - me.z, 0, me.z - y.z1);
    sound.setRain(Math.max(0, 1 - Math.hypot(dx, dz) / 10));
    // ghosts whisper now and then
    for (const g of S.ghosts.values()) {
      if (!g.alive) continue;
      const d = Math.hypot(g.x - me.x, g.z - me.z);
      if (d < 12 && Math.random() < dt * 0.15) sound.whisper(g.x, g.z, 0.2 + (1 - d / 12) * 0.3);
    }
  }

  // shining your light on a ghost drives it off
  if (playing && me.state === 'alive' && S.light && me.hidden == null) {
    const fx = -Math.sin(me.yaw);
    const fz = -Math.cos(me.yaw);
    for (const [id, g] of S.ghosts) {
      if (!g.alive) continue;
      const dx = g.x - me.x;
      const dz = g.z - me.z;
      const d = Math.hypot(dx, dz);
      if (d > 12 || d < 0.1) continue;
      const cos = (dx * fx + dz * fz) / d;
      if (cos > Math.cos(0.32) && Math.abs(me.pitch) < 0.6 && L.clearLine(me.x, me.z, g.x, g.z, (k) => S.doors[k])) {
        S.shine[id] = (S.shine[id] || 0) + dt;
        g.mat.emissiveIntensity = 1.2;
        if (S.shine[id] > 0.2) {
          socket.emit('shine', { id, dt: S.shine[id] });
          S.shine[id] = 0;
        }
      }
    }
  }

  // what you are pointing at
  if (playing && me.state === 'alive' && me.hidden == null && !S.scare) {
    aim = findAim();
    const d = describe(aim);
    if (Array.isArray(d)) UI.setPrompt(d[0], '');
    else UI.setPrompt(d);
  } else if (me.hidden != null) UI.setPrompt('Press E or a movement key to come out', '');
  else UI.setPrompt(null);

  // the clock
  if (playing) {
    const st = serverNow();
    if (S.stage === 'escape') UI.setTimer(C.DURATION.finale - (st - S.finaleAt), true);
    else UI.setTimer(C.DURATION.night - st, false);
    if (st < (S.grace ?? C.DURATION.grace) && me.state === 'alive') $('grace').textContent = `The sisters are at prayer. Look around while you can… ${Math.ceil((S.grace ?? C.DURATION.grace) - st)}`;
    else $('grace').textContent = '';
  }

  world.update(dt, t, UI.settings.brightness, camera.position);
  if (!dust.off) dust.update(t, torch.visible ? torch.intensity / 22 : 0);
  // the view widens for a moment when she sees you
  if (S.fovKick > 0.001) {
    S.fovKick = Math.max(0, S.fovKick - dt * 0.8);
    camera.fov = 72 + (UI.settings.gentle ? 0 : Math.sin(Math.min(1, (1 - S.fovKick) * 3) * Math.PI * 0.5) * S.fovKick * 8);
    camera.updateProjectionMatrix();
  }
  renderer.render(scene, camera);

  if (S.mapOn) {
    const mc = $('map-canvas');
    if (!mapCanvasSized || mc.width !== mc.clientWidth * 2) {
      mc.width = mc.clientWidth * 2;
      mc.height = mc.clientHeight * 2;
      mapCanvasSized = true;
    }
    if (Math.floor(t * 10) % 2 === 0)
      UI.drawMap(mc, {
        me: me.state === 'alive' ? me : null,
        others: [...S.avatars.values()].map((a) => ({ x: a.x, z: a.z, visible: a.present })),
        stage: S.stage,
        keyRooms: S.keyRooms,
        loose: [...S.loose.values()],
      });
    const room = L.roomAt(me.x, me.z);
    $('map-here').textContent = room ? `You are in the ${L.ROOMS[room].name}` : '';
  }
}
world.onThunder = () => sound.ctx && sound.thunder(0.6 + Math.random() * 0.4);
UI.setLives(C.LIVES);
UI.setObjective('power', 0, []);
UI.show('panel-join');
document.body.dataset.ready = '1';
frame();

if (DEBUG) {
  window.__c = {
    S,
    world,
    camera,
    renderer,
    haunts,
    socket,
    L,
    get aim() {
      return aim;
    },
    perf,
    tp(x, z, yaw) {
      S.me.x = x;
      S.me.z = z;
      if (yaw != null) S.me.yaw = yaw;
    },
    look(yaw, pitch = 0) {
      S.me.yaw = yaw;
      S.me.pitch = pitch;
    },
    interact,
    // a still nun or ghost of our own, to look at
    preview(kind, x, z, yaw = 0, state = 'patrol') {
      const o = kind === 'nun' ? new Nun(scene) : new Ghost(scene);
      o.x = o.tx = x;
      o.z = o.tz = z;
      o.yaw = o.tyaw = yaw;
      if (kind === 'nun') o.state = state;
      else o.set(x, z, true, state === 'chase');
      (S.previews ||= []).push(o);
      return S.previews.length - 1;
    },
    lockless() {
      UI.show(null);
    },
  };
}
