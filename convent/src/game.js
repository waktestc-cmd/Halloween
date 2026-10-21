// Escape the Convent: the server runs the house. Players report where they are; the server owns
// the doors, the hidden items, the puzzle stages, the nuns and ghosts, and who gets caught.
import crypto from 'crypto';
import * as L from '../shared/level.js';
import * as C from '../shared/config.js';

const DEV = process.env.DEV === '1';
// tests can shorten the quiet start
const GRACE = process.env.GRACE != null ? Number(process.env.GRACE) : C.DURATION.grace;
const TICK = 1 / 20;
const SEND_EVERY = 3; // ticks between snapshots (about 7 a second)
const rint = (n) => crypto.randomInt(n);
const pick = (a) => a[rint(a.length)];
const shuffle = (a) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = rint(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const angDiff = (a, b) => {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
};
const clean = (s, n) =>
  String(s || '')
    .replace(/[<>&"'`\u0000-\u001f]/g, '')
    .trim()
    .slice(0, n);

/* ---------- route finding on the tile grid ---------- */
const key = (c, r) => c + ',' + r;
function walkable(c, r, ghost) {
  if (!L.floorTile(c, r)) return false;
  if (!ghost && L.BLOCKED.has(key(c, r))) return false;
  if (L.at(c, r) === '+') {
    const d = L.DOORS.find((d) => d.c === c && d.r === r);
    if (d && d.front) return false; // nobody wanders out of the front door
  }
  return true;
}
function route(from, to, ghost) {
  const [c0, r0] = L.tileOf(from.x, from.z);
  const [c1, r1] = L.tileOf(to.x, to.z);
  if (c0 === c1 && r0 === r1) return [];
  const prev = new Map([[key(c0, r0), null]]);
  const q = [[c0, r0]];
  while (q.length) {
    const [c, r] = q.shift();
    if (c === c1 && r === r1) break;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc;
      const nr = r + dr;
      const k = key(nc, nr);
      if (prev.has(k) || !walkable(nc, nr, ghost)) continue;
      prev.set(k, [c, r]);
      q.push([nc, nr]);
    }
  }
  if (!prev.has(key(c1, r1))) return null;
  const path = [];
  for (let n = [c1, r1]; n && !(n[0] === c0 && n[1] === r0); n = prev.get(key(n[0], n[1]))) path.unshift(L.centre(n[0], n[1]));
  // finish at the exact point when it is in the goal tile
  if (path.length) path[path.length - 1] = [to.x, to.z];
  return path;
}
const WALK_TILES = [];
for (let r = 0; r < L.H; r++) for (let c = 0; c < L.W; c++) if (walkable(c, r) && L.at(c, r) !== '+') WALK_TILES.push([c, r]);
const tilesIn = (room) => WALK_TILES.filter(([c, r]) => L.at(c, r) === room);
// places the nuns like to walk to: mostly the cloister, sometimes into a room
const PATROL = Object.keys(L.ROOMS).filter((k) => k !== 'd');

export class Game {
  constructor(io) {
    this.io = io;
    this.players = new Map();
    this.hosts = new Set();
    this.reset();
    setInterval(() => this.tick(), TICK * 1000);
  }

  reset() {
    this.phase = 'LOBBY';
    this.t = 0;
    this.tickN = 0;
    this.feed = [];
    this.doors = Object.fromEntries(L.DOORS.map((d) => [d.id, !!d.arch]));
    this.stage = 'power';
    this.padlocks = 0;
    this.finaleAt = 0;
    this.nuns = [];
    this.ghosts = [];
    this.loose = []; // items dropped on the floor
    this.boxes = new Map(); // prop id -> item
    this.searched = new Set();
    this.hidden = new Map(); // prop id -> player id
    this.keyRooms = [];
    this.result = null;
    this.level = this.level || C.DIFFICULTY.normal;
    for (const p of this.players.values()) this.freshPlayer(p);
  }

  freshPlayer(p) {
    Object.assign(p, {
      x: L.SPAWN.x + (Math.random() - 0.5) * 6,
      z: L.SPAWN.z + (Math.random() - 0.5) * 2,
      yaw: L.SPAWN.yaw,
      run: false,
      light: true,
      moving: false,
      lives: C.LIVES,
      state: 'alive',
      safeUntil: 0,
      wakeAt: null,
      hidden: null,
      carrying: null,
      stats: { caught: 0, found: 0, placed: 0, escapedAt: 0, closest: 99 },
    });
  }

  /* ---------- connections ---------- */
  attachHost(socket) {
    this.hosts.add(socket);
    socket.join('hosts');
    socket.emit('welcome', { host: true, ...this.publicState() });
    socket.on('start', (m = {}) => this.start(m));
    socket.on('reset', () => {
      this.reset();
      this.io.to('players').to('hosts').emit('lobby', this.publicState());
    });
    socket.on('disconnect', () => this.hosts.delete(socket));
  }

  attachPlayer(socket) {
    let me = null;
    socket.on('join', (msg = {}) => {
      if (me) return;
      const name = clean(msg.name, 18) || 'Guest';
      // a returning player (same browser) gets their place back
      const token = clean(msg.token, 40);
      me = [...this.players.values()].find((p) => p.token && p.token === token) || null;
      if (me) {
        me.socket = socket;
        me.name = name;
        me.online = true;
      } else {
        if (this.players.size >= 40) return socket.emit('full');
        me = { id: crypto.randomBytes(4).toString('hex'), token: token || crypto.randomBytes(8).toString('hex'), name, look: Number(msg.look) % C.LOOKS.length || 0, socket, online: true };
        this.freshPlayer(me);
        if (this.phase !== 'LOBBY') {
          // late arrivals join the game in progress
          me.state = 'alive';
        }
        this.players.set(me.id, me);
      }
      socket.join('players');
      socket.emit('welcome', { id: me.id, token: me.token, ...this.publicState(), me: this.mine(me) });
      this.broadcastLobby();
    });
    socket.on('state', (m = {}) => {
      if (!me || this.phase !== 'PLAYING' || me.state !== 'alive' || me.hidden != null) return;
      const x = Number(m.x);
      const z = Number(m.z);
      if (!Number.isFinite(x) || !Number.isFinite(z)) return;
      // after a catch, wait until the browser has moved you back to the dormitory
      if (me.wakeAt) {
        if (Math.hypot(x - me.wakeAt.x, z - me.wakeAt.z) > 3) return;
        me.wakeAt = null;
        me.safeUntil = this.t + C.RESPAWN_SAFE;
      }
      // trust the browser's walking, but not teleporting
      const d = Math.hypot(x - me.x, z - me.z);
      if (d < 8) {
        me.x = x;
        me.z = z;
      }
      me.yaw = Number(m.yaw) || 0;
      me.run = !!m.run;
      me.moving = !!m.moving;
      me.light = !!m.light;
      if (me.moving) this.noise(me, me.run ? C.NOISE.run : C.NOISE.walk);
      if (me.z > L.ESCAPE_Z && this.stage === 'escape') this.escape(me);
    });
    socket.on('door', (m = {}) => {
      const d = L.DOORS.find((d) => d.id === m.id);
      if (!this.can(me) || !d || d.arch) return;
      if (d.front) return this.useFront(me);
      if (!this.near(me, L.centre(d.c, d.r), C.REACH + 0.8)) return;
      this.doors[d.id] = !this.doors[d.id];
      this.emitDoors();
      this.sfx(this.doors[d.id] ? 'door-open' : 'door-close', ...L.centre(d.c, d.r));
      this.noise(me, C.NOISE.door);
    });
    socket.on('search', (m = {}) => {
      const p = L.PROPS[m.prop | 0];
      if (!this.can(me) || !p || !p.box || !this.near(me, [p.x, p.z], C.REACH + Math.max(p.hw, p.hd))) return;
      this.noise(me, C.NOISE.search);
      const item = this.boxes.get(p.id);
      if (!item) {
        socket.emit('found', { prop: p.id, item: null });
        return;
      }
      if (item === 'battery') {
        this.boxes.delete(p.id);
        socket.emit('found', { prop: p.id, item: 'battery' });
        return;
      }
      if (me.carrying) {
        socket.emit('found', { prop: p.id, item, full: me.carrying });
        return;
      }
      this.boxes.delete(p.id);
      me.carrying = item;
      me.stats.found++;
      socket.emit('found', { prop: p.id, item });
      socket.emit('me', this.mine(me));
      this.say(`${me.name} found the ${C.ITEMS[item].name.toLowerCase()}!`);
    });
    socket.on('pickup', (m = {}) => {
      const it = this.loose.find((l) => l.id === m.id);
      if (!this.can(me) || !it || me.carrying || !this.near(me, [it.x, it.z], C.REACH)) return;
      this.loose = this.loose.filter((l) => l !== it);
      me.carrying = it.item;
      socket.emit('me', this.mine(me));
      this.say(`${me.name} picked up the ${C.ITEMS[it.item].name.toLowerCase()}.`);
    });
    socket.on('hide', (m = {}) => {
      const p = L.PROPS[m.prop | 0];
      if (!this.can(me) || !p || !p.hide || this.hidden.has(p.id) || !this.near(me, [p.x, p.z], C.REACH + Math.max(p.hw, p.hd))) {
        if (p && this.hidden.has(p.id)) socket.emit('toast', 'Someone is already hiding there!');
        return;
      }
      me.hidden = p.id;
      this.hidden.set(p.id, me.id);
      socket.emit('me', this.mine(me));
      // a nun who watched you climb in knows exactly where you are
      for (const n of this.nuns) if (n.target === me.id && this.t - n.sawAt < 1.2) n.pullFrom = p.id;
    });
    socket.on('unhide', () => {
      if (!me || me.hidden == null) return;
      this.unhide(me);
      socket.emit('me', this.mine(me));
    });
    socket.on('use', (m = {}) => {
      if (!this.can(me)) return;
      if (m.what === 'fusebox') this.useFuse(me);
      if (m.what === 'desk') this.useDesk(me);
      if (m.what === 'front') this.useFront(me);
    });
    socket.on('shine', (m = {}) => {
      if (!this.can(me)) return;
      const g = this.ghosts.find((g) => g.id === m.id && g.alive);
      if (!g || dist(g, me) > 14) return;
      g.burn += Math.min(0.5, Number(m.dt) || 0.1);
      if (g.burn >= C.GHOST.burn) this.banishGhost(g, me);
    });
    if (DEV) {
      // test hooks: where things are hidden, and stepping anywhere
      socket.on('dev:where', () => socket.emit('dev:where', { boxes: [...this.boxes], nuns: this.nuns.map((n) => ({ x: n.x, z: n.z, yaw: n.yaw, state: n.state })), ghosts: this.ghosts.map((g) => ({ x: g.x, z: g.z, alive: g.alive })) }));
      socket.on('dev:tp', (m = {}) => me && Object.assign(me, { x: Number(m.x), z: Number(m.z) }));
      socket.on('dev:freeze', (on) => (this.frozen = !!on));
    }
    socket.on('disconnect', () => {
      if (!me) return;
      me.online = false;
      if (me.hidden != null) this.unhide(me);
      if (this.phase === 'LOBBY') this.players.delete(me.id);
      else if (me.carrying) this.drop(me);
      this.broadcastLobby();
    });
  }

  can(me) {
    return me && this.phase === 'PLAYING' && me.state === 'alive';
  }
  near(me, [x, z], r) {
    return Math.hypot(me.x - x, me.z - z) <= r;
  }

  /* ---------- the night ---------- */
  start(opts = {}) {
    if (this.phase === 'PLAYING') return;
    this.reset();
    this.level = C.DIFFICULTY[opts.difficulty] || C.DIFFICULTY.normal;
    if (!this.players.size) return;
    this.phase = 'PLAYING';
    this.t = 0;
    this.hideItems();
    const n = [...this.players.values()].filter((p) => p.online).length || 1;
    const nuns = Math.min(C.NUN.max, Math.max(1, Math.ceil(n / this.level.perPlayers)));
    const homes = shuffle(['p', 'x', 'l', 'o']);
    this.nuns = Array.from({ length: nuns }, (_, i) => {
      const [c, r] = pick(tilesIn(homes[i]));
      const [x, z] = L.centre(c, r);
      return { id: 'n' + i, name: ['Sister Madeline', 'Sister Agatha', 'Sister Ursula'][i], x, z, yaw: 0, state: 'idle', path: [], wait: 0, target: null, sawAt: -99, last: null, gloatUntil: 0, pullFrom: null, heard: null, hum: i };
    });
    const ghosts = Math.min(C.GHOST.max, Math.round((C.GHOST.base + Math.floor(n / C.GHOST.perPlayers)) * this.level.ghosts));
    this.ghosts = Array.from({ length: ghosts }, (_, i) => this.newGhost('g' + i));
    this.hauntAt = GRACE + C.HAUNT.first;
    this.say('The doors lock behind you. Find a way out before dawn.');
    this.io.to('players').to('hosts').emit('start', this.publicState());
    for (const p of this.players.values()) p.socket.emit('me', this.mine(p));
  }

  hideItems() {
    // one item per hiding place; the iron keys go to three different rooms away from the office
    const boxes = shuffle(L.BOXES.filter((b) => b.room !== 'd'));
    const used = new Set();
    const take = (pred) => {
      const b = boxes.find((b) => !used.has(b.id) && pred(b));
      used.add(b.id);
      return b;
    };
    this.boxes.set(take((b) => b.room !== 'c').id, 'fuse');
    this.boxes.set(take((b) => b.room !== 'o').id, 'brass');
    const rooms = new Set();
    for (const k of ['key1', 'key2', 'key3']) {
      const b = take((b) => b.room !== 'o' && b.room !== 'e' && !rooms.has(b.room));
      rooms.add(b.room);
      this.boxes.set(b.id, k);
      this.keyRooms.push(b.room);
    }
    for (let i = 0; i < C.BATTERY.spares; i++) {
      const b = boxes.find((b) => !used.has(b.id));
      if (!b) break;
      used.add(b.id);
      this.boxes.set(b.id, 'battery');
    }
  }

  newGhost(id) {
    const [c, r] = pick(WALK_TILES.filter(([c, r]) => L.at(c, r) !== 'd'));
    const [x, z] = L.centre(c, r);
    return { id, x, z, alive: true, back: 0, path: [], burn: 0, chasing: null, wait: 0, yaw: 0, ghost: true };
  }

  useFuse(me) {
    if (this.stage !== 'power' || !this.near(me, [L.FUSEBOX.x, L.FUSEBOX.z], C.REACH + 0.6)) return;
    if (me.carrying !== 'fuse') return me.socket.emit('toast', 'The fuse box is missing a fuse.');
    me.carrying = null;
    me.stats.placed++;
    this.stage = 'desk';
    this.noise(me, C.NOISE.padlock);
    this.sfx('power', L.FUSEBOX.x, L.FUSEBOX.z);
    this.say(`${me.name} fixed the fuse box. The lights flicker on.`);
    this.emitStage();
    me.socket.emit('me', this.mine(me));
  }

  useDesk(me) {
    const d = L.OFFICE_DESK;
    if (!this.near(me, [d.x, d.z], C.REACH + 1)) return;
    if (this.stage === 'power') return me.socket.emit('toast', "The desk is locked. It's too dark to see the lock anyway.");
    if (this.stage !== 'desk') return me.socket.emit('note', this.note());
    if (me.carrying !== 'brass') return me.socket.emit('toast', 'The desk is locked with a small brass lock.');
    me.carrying = null;
    me.stats.placed++;
    this.stage = 'keys';
    this.sfx('unlock', d.x, d.z);
    this.say(`${me.name} opened the desk and found a note: the iron keys are in the ${this.keyRooms.map((k) => L.ROOMS[k].name).join(', the ')}.`);
    this.emitStage();
    me.socket.emit('me', this.mine(me));
    me.socket.emit('note', this.note());
  }

  note() {
    return `The three keys to the front door are kept apart. One in the ${L.ROOMS[this.keyRooms[0]].name}, one in the ${L.ROOMS[this.keyRooms[1]].name}, one in the ${L.ROOMS[this.keyRooms[2]].name}. — M.S.`;
  }

  useFront(me) {
    const [fx, fz] = L.centre(L.FRONT.c, L.FRONT.r);
    if (!this.near(me, [fx, fz], C.REACH + 1)) return;
    if (this.stage === 'escape') return;
    if (!/^key\d$/.test(me.carrying || '')) {
      const left = 3 - this.padlocks;
      return me.socket.emit('toast', `The front door is locked with ${left} padlock${left === 1 ? '' : 's'}.`);
    }
    me.carrying = null;
    me.stats.placed++;
    this.padlocks++;
    this.noise(me, C.NOISE.padlock);
    this.sfx('padlock', fx, fz);
    this.say(`${me.name} unlocked a padlock. ${3 - this.padlocks} to go.`);
    if (this.padlocks >= 3) {
      this.stage = 'escape';
      this.doors.front = true;
      this.finaleAt = this.t;
      this.emitDoors();
      this.say('The front door swings open. Everyone get out!');
      for (const n of this.nuns) n.state = 'finale';
    }
    this.emitStage();
    me.socket.emit('me', this.mine(me));
  }

  escape(me) {
    if (me.state !== 'alive') return;
    me.state = 'escaped';
    me.stats.escapedAt = this.t;
    if (me.carrying) me.carrying = null;
    this.say(`${me.name} escaped!`);
    me.socket.emit('me', this.mine(me));
    this.checkEnd();
  }

  unhide(me) {
    this.hidden.delete(me.hidden);
    const p = L.PROPS[me.hidden];
    me.hidden = null;
    // step out in front of where you hid
    const f = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] }[p.face];
    me.x = p.x + f[0] * (p.hw + 0.7);
    me.z = p.z + f[1] * (p.hd + 0.7);
  }

  drop(me) {
    if (!me.carrying) return;
    this.loose.push({ id: crypto.randomBytes(3).toString('hex'), item: me.carrying, x: me.x, z: me.z });
    this.say(`${me.name} dropped the ${C.ITEMS[me.carrying].name.toLowerCase()}!`);
    me.carrying = null;
  }

  // caught by a nun or touched by a ghost
  hit(me, by) {
    if (me.state !== 'alive' || this.t < me.safeUntil) return;
    if (me.hidden != null) this.unhide(me);
    this.drop(me);
    me.lives--;
    me.stats.caught++;
    const who = by.name || 'a ghost';
    if (me.lives <= 0) {
      me.state = 'dead';
      this.say(`${me.name} was taken by ${who}.`);
    } else {
      this.say(`${me.name} was caught by ${who}! ${me.lives} ${me.lives === 1 ? 'life' : 'lives'} left.`);
      me.x = L.SPAWN.x + (Math.random() - 0.5) * 6;
      me.z = L.SPAWN.z + (Math.random() - 0.5) * 2;
      me.yaw = L.SPAWN.yaw;
      me.safeUntil = Infinity; // until the browser shows you waking up
      me.wakeAt = { x: me.x, z: me.z };
    }
    me.socket.emit('hit', { by: by.kind, name: who, lives: me.lives, x: me.x, z: me.z, yaw: me.yaw });
    me.socket.emit('me', this.mine(me));
    this.checkEnd();
  }

  checkEnd() {
    const all = [...this.players.values()].filter((p) => p.online || p.state !== 'alive');
    if (all.length && all.every((p) => p.state !== 'alive')) this.end();
  }

  end() {
    if (this.phase !== 'PLAYING') return;
    this.phase = 'RESULTS';
    const list = [...this.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      state: p.state === 'alive' ? 'kept' : p.state,
      lives: p.lives,
      score: Math.max(0, (p.state === 'escaped' ? 100 : 0) + p.stats.placed * 50 + p.stats.found * 10 - p.stats.caught * 10 + Math.max(0, p.lives) * 5),
      ...p.stats,
    }));
    list.sort((a, b) => b.score - a.score);
    const escaped = list.filter((p) => p.state === 'escaped').length;
    const awards = [];
    const best = (ok, f, title, why) => {
      const p = list.filter(ok).sort(f)[0];
      if (p) awards.push({ title, name: p.name, why });
    };
    best((p) => p.caught === 0, (a, b) => b.score - a.score, 'Never caught', 'Slipped past every nun');
    best((p) => p.placed > 0, (a, b) => b.placed - a.placed, 'Locksmith', 'Fixed the most locks');
    best((p) => p.found > 0, (a, b) => b.found - a.found, 'Finder', 'Found the most hidden things');
    best((p) => p.caught > 0, (a, b) => b.caught - a.caught, 'Nun magnet', 'Caught the most times');
    best((p) => p.closest < 2.5, (a, b) => a.closest - b.closest, 'Closest call', 'Felt her breath');
    this.result = { escaped, total: list.length, list, awards, won: escaped > 0 };
    this.io.to('players').to('hosts').emit('end', this.result);
  }

  /* ---------- noise, sight and the nuns ---------- */
  noise(src, radius) {
    if (this.phase !== 'PLAYING' || this.t < GRACE) return;
    for (const n of this.nuns) {
      if (n.state === 'chase' || n.state === 'gloat' || n.state === 'finale') continue;
      const d = dist(n, src);
      const through = L.clearLine(n.x, n.z, src.x, src.z, (id) => this.doors[id]) ? 1 : 0.55;
      if (d <= radius * through) {
        n.state = 'investigate';
        n.heard = { x: src.x, z: src.z };
        n.path = route(n, n.heard) || [];
      }
    }
  }

  sees(n, p) {
    if (p.state !== 'alive' || p.hidden != null || this.t < p.safeUntil) return false;
    const d = dist(n, p);
    const lit = this.stage !== 'power' && L.roomAt(p.x, p.z) === 'c';
    const range = (p.light || lit ? C.NUN.sightLit : C.NUN.sight) * this.level.sight;
    if (d > range) return false;
    const toward = Math.atan2(p.x - n.x, p.z - n.z);
    if (d > C.NUN.near && Math.abs(angDiff(toward, n.yaw)) > C.NUN.fov) return false;
    return L.clearLine(n.x, n.z, p.x, p.z, (id) => this.doors[id]);
  }

  step(e, speed, dt) {
    // walk along the path, opening doors on the way
    while (e.path.length) {
      const [tx, tz] = e.path[0];
      const dx = tx - e.x;
      const dz = tz - e.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.15) {
        e.path.shift();
        continue;
      }
      const s = Math.min(d, speed * dt);
      e.x += (dx / d) * s;
      e.z += (dz / d) * s;
      const want = Math.atan2(dx, dz);
      e.yaw += angDiff(want, e.yaw) * Math.min(1, dt * 8);
      if (!e.ghost) {
        const [c, r] = L.tileOf(e.x + (dx / d) * 1.2, e.z + (dz / d) * 1.2);
        if (L.at(c, r) === '+') {
          const door = L.DOORS.find((q) => q.c === c && q.r === r);
          if (door && !door.arch && !door.front && !this.doors[door.id]) {
            this.doors[door.id] = true;
            this.emitDoors();
            this.sfx('door-creak', ...L.centre(c, r));
          }
        }
      }
      return true;
    }
    return false;
  }

  nunTick(n, dt) {
    const alive = [...this.players.values()].filter((p) => p.state === 'alive' && p.online);
    if (this.t < GRACE) return;
    if (n.state === 'gloat') {
      if (this.t < n.gloatUntil) return;
      n.state = 'patrol';
      n.path = [];
    }
    // dragging someone out of their hiding place
    if (n.pullFrom != null) {
      const p = L.PROPS[n.pullFrom];
      const who = this.players.get(this.hidden.get(n.pullFrom));
      if (!who || who.hidden !== n.pullFrom) n.pullFrom = null;
      else {
        if (!n.path.length) n.path = route(n, { x: p.x, z: p.z }) || [];
        this.step(n, C.NUN.chase, dt);
        if (Math.hypot(n.x - p.x, n.z - p.z) < Math.max(p.hw, p.hd) + 1.3) {
          n.pullFrom = null;
          this.sfx('pull', p.x, p.z);
          this.catch(n, who);
        }
        return;
      }
    }
    // who can she see?
    let seen = null;
    let best = Infinity;
    for (const p of alive) {
      const d = dist(n, p);
      if (d < best && this.sees(n, p)) {
        seen = p;
        best = d;
      }
      if (d < p.stats.closest && d < 6) p.stats.closest = d;
    }
    if (seen) {
      if (n.state !== 'chase' && n.state !== 'finale') {
        this.sfx('shriek', n.x, n.z);
        seen.socket.emit('spotted', { by: n.id });
      }
      if (n.state !== 'finale') n.state = 'chase';
      n.target = seen.id;
      n.sawAt = this.t;
      n.last = { x: seen.x, z: seen.z };
    }
    const target = n.target && this.players.get(n.target);
    if (n.state === 'finale') {
      // once the door is open she knows where everyone is
      let near = null;
      let nd = Infinity;
      for (const p of alive) {
        if (p.hidden != null || this.t < p.safeUntil) continue;
        const d = dist(n, p);
        if (d < nd) {
          near = p;
          nd = d;
        }
      }
      if (near) {
        n.target = near.id;
        n.last = { x: near.x, z: near.z };
      }
    }
    if ((n.state === 'chase' || n.state === 'finale') && n.last) {
      const t = target && target.state === 'alive' ? target : null;
      if (t && dist(n, t) < C.NUN.catchAt && this.t >= t.safeUntil && t.hidden == null) return this.catch(n, t);
      if (n.state === 'chase' && this.t - n.sawAt > C.NUN.loseAfter) {
        n.state = 'search';
        n.wait = C.NUN.search;
        n.path = route(n, n.last) || [];
      } else {
        // straight at you when nothing is in the way, otherwise along the corridors
        const goal = this.t - n.sawAt < 0.3 && t ? t : n.last;
        if (L.clearLine(n.x, n.z, goal.x, goal.z, (id) => this.doors[id]) && dist(n, goal) < 8) n.path = [[goal.x, goal.z]];
        else if (!n.path.length || this.tickN % 10 === 0) n.path = route(n, goal) || [];
        this.step(n, (n.state === 'finale' ? C.NUN.finale : C.NUN.chase) * this.level.speed, dt);
      }
      return;
    }
    if (n.state === 'investigate') {
      if (!this.step(n, C.NUN.investigate * this.level.speed, dt)) {
        n.state = 'search';
        n.wait = C.NUN.search * 0.6;
      }
      return;
    }
    if (n.state === 'search') {
      n.wait -= dt;
      if (!this.step(n, C.NUN.patrol, dt)) {
        // look around a nearby spot
        const [c, r] = L.tileOf(n.x, n.z);
        const opts = WALK_TILES.filter(([cc, rr]) => Math.abs(cc - c) + Math.abs(rr - r) <= 3);
        const [tc, tr] = pick(opts);
        const [x, z] = L.centre(tc, tr);
        n.path = route(n, { x, z }) || [];
      }
      if (n.wait <= 0) {
        n.state = 'patrol';
        n.path = [];
      }
      return;
    }
    // patrol: walk somewhere, pause, look about, walk somewhere else
    if (n.state === 'idle') n.state = 'patrol';
    if (!this.step(n, C.NUN.patrol, dt)) {
      if (n.wait > 0) {
        n.wait -= dt;
        n.yaw += dt * 0.8 * Math.sin(this.t * 0.7 + n.hum);
        return;
      }
      const room = Math.random() < 0.45 ? 'c' : pick(PATROL);
      const [c, r] = pick(tilesIn(room));
      const [x, z] = L.centre(c, r);
      n.path = route(n, { x, z }) || [];
      n.wait = 1.5 + Math.random() * 3;
    }
  }

  catch(n, p) {
    this.sfx('caught', p.x, p.z);
    this.hit(p, { kind: 'nun', name: n.name });
    n.state = this.stage === 'escape' ? 'finale' : 'gloat';
    n.gloatUntil = this.t + C.NUN.gloat;
    n.target = null;
    n.path = [];
  }

  ghostTick(g, dt) {
    if (this.t < GRACE) return;
    if (!g.alive) {
      if (this.t >= g.back) Object.assign(g, this.newGhost(g.id));
      return;
    }
    g.burn = Math.max(0, g.burn - dt * 0.25);
    let near = null;
    let nd = C.GHOST.notice;
    for (const p of this.players.values()) {
      if (p.state !== 'alive' || !p.online || p.hidden != null || this.t < p.safeUntil) continue;
      const d = dist(g, p);
      if (d < nd && L.clearLine(g.x, g.z, p.x, p.z, (id) => this.doors[id])) {
        near = p;
        nd = d;
      }
    }
    if (near) {
      if (g.chasing !== near.id) this.sfx('boo', g.x, g.z);
      g.chasing = near.id;
      g.path = [[near.x, near.z]];
      this.step(g, C.GHOST.approach, dt);
      if (dist(g, near) < C.GHOST.touch) {
        this.hit(near, { kind: 'ghost', name: 'a ghost' });
        g.alive = false;
        g.back = this.t + C.GHOST.back;
      }
      return;
    }
    g.chasing = null;
    if (!this.step(g, C.GHOST.drift, dt)) {
      const [c, r] = L.tileOf(g.x, g.z);
      const opts = WALK_TILES.filter(([cc, rr]) => Math.abs(cc - c) + Math.abs(rr - r) <= 6 && L.at(cc, rr) !== 'd');
      const [tc, tr] = pick(opts.length ? opts : WALK_TILES);
      const [x, z] = L.centre(tc, tr);
      g.path = route(g, { x, z }, true) || [];
    }
  }

  /* ---------- the house itself ----------
     Now and then something happens near someone: a door slams or creaks open on its own, knocking
     behind a closed door, the lamps stutter, a wail far off. It never hurts anyone, and the nuns
     ignore it. */
  haunt() {
    this.hauntAt = this.t + C.HAUNT.every[0] + Math.random() * (C.HAUNT.every[1] - C.HAUNT.every[0]);
    if (this.stage === 'escape') return;
    const alive = [...this.players.values()].filter((p) => p.state === 'alive' && p.online && p.hidden == null);
    if (!alive.length) return;
    const p = pick(alive);
    const people = [...this.players.values()].filter((q) => q.state === 'alive' && q.online);
    const doors = L.DOORS.filter((d) => {
      if (d.arch || d.front) return false;
      const [x, z] = L.centre(d.c, d.r);
      const far = Math.hypot(x - p.x, z - p.z);
      // never close a door on someone standing in it
      return far > 4 && far < 14 && people.every((q) => Math.hypot(q.x - x, q.z - z) > 2.6) && this.nuns.every((n) => Math.hypot(n.x - x, n.z - z) > 2.6);
    });
    const kinds = ['wail'];
    if (doors.some((d) => !this.doors[d.id])) kinds.push('knock', 'knock');
    if (doors.some((d) => this.doors[d.id])) kinds.push('slam', 'slam');
    if (doors.some((d) => !this.doors[d.id])) kinds.push('creak');
    if (this.stage !== 'power') kinds.push('flicker');
    const kind = pick(kinds);
    if (kind === 'slam' || kind === 'creak') {
      const d = pick(doors.filter((d) => this.doors[d.id] === (kind === 'slam')));
      this.doors[d.id] = kind === 'creak';
      this.emitDoors();
      this.sfx(kind === 'slam' ? 'slam' : 'door-creak', ...L.centre(d.c, d.r));
    } else if (kind === 'knock') {
      const d = pick(doors.filter((d) => !this.doors[d.id]));
      this.sfx('knock', ...L.centre(d.c, d.r));
    } else if (kind === 'flicker') this.sfx('flicker', L.FUSEBOX.x, L.FUSEBOX.z);
    else {
      // far off, somewhere in the house
      const [c, r] = pick(WALK_TILES.filter(([c, r]) => {
        const [x, z] = L.centre(c, r);
        const d = Math.hypot(x - p.x, z - p.z);
        return d > 12 && d < 26;
      }));
      this.sfx('wail', ...L.centre(c, r));
    }
  }

  banishGhost(g, by) {
    g.alive = false;
    g.back = this.t + C.GHOST.back;
    g.burn = 0;
    this.sfx('banish', g.x, g.z);
    this.say(`${by.name} chased off a ghost with their flashlight.`);
  }

  tick() {
    if (this.phase !== 'PLAYING') return;
    this.t += TICK;
    this.tickN++;
    if (!this.frozen) {
      for (const n of this.nuns) this.nunTick(n, TICK);
      for (const g of this.ghosts) this.ghostTick(g, TICK);
      if (this.t > this.hauntAt) this.haunt();
    }
    if (this.tickN % SEND_EVERY === 0) this.snapshot();
    if (this.stage === 'escape' && this.t - this.finaleAt > C.DURATION.finale) this.end();
    if (this.t > C.DURATION.night) this.end();
  }

  /* ---------- telling everyone ---------- */
  snapshot() {
    const r = (v) => Math.round(v * 100) / 100;
    const msg = {
      t: r(this.t),
      p: [...this.players.values()]
        .filter((p) => p.online && p.state !== 'escaped')
        .map((p) => [p.id, r(p.x), r(p.z), r(p.yaw), p.moving ? (p.run ? 2 : 1) : 0, p.light ? 1 : 0, p.state === 'dead' ? 0 : p.hidden != null ? 2 : 1]),
      n: this.nuns.map((n) => [n.id, r(n.x), r(n.z), r(n.yaw), n.state]),
      g: this.ghosts.map((g) => [g.id, r(g.x), r(g.z), g.alive ? 1 : 0, g.chasing ? 1 : 0]),
      l: this.loose.map((l) => [l.id, l.item, r(l.x), r(l.z)]),
    };
    this.io.to('players').to('hosts').volatile.emit('tick', msg);
  }

  publicState() {
    return {
      phase: this.phase,
      t: this.t,
      stage: this.stage,
      padlocks: this.padlocks,
      doors: this.doors,
      keyRooms: this.stage === 'keys' || this.stage === 'escape' ? this.keyRooms : [],
      roster: this.roster(),
      feed: this.feed.slice(-8),
      finaleAt: this.finaleAt,
      result: this.result,
      grace: GRACE,
      dev: DEV,
    };
  }
  roster() {
    return [...this.players.values()].filter((p) => p.online || this.phase !== 'LOBBY').map((p) => ({ id: p.id, name: p.name, look: p.look, lives: p.lives, state: p.state, carrying: p.carrying, online: p.online }));
  }
  mine(p) {
    return { id: p.id, lives: p.lives, state: p.state, carrying: p.carrying, hidden: p.hidden, safeUntil: p.safeUntil, x: p.x, z: p.z, yaw: p.yaw };
  }
  broadcastLobby() {
    this.io.to('players').to('hosts').emit('roster', this.roster());
  }
  emitDoors() {
    this.io.to('players').to('hosts').emit('doors', this.doors);
  }
  emitStage() {
    this.io.to('players').to('hosts').emit('stage', { stage: this.stage, padlocks: this.padlocks, keyRooms: this.stage === 'keys' || this.stage === 'escape' ? this.keyRooms : [], finaleAt: this.finaleAt, roster: this.roster() });
  }
  sfx(kind, x, z) {
    this.io.to('players').to('hosts').emit('sfx', { kind, x, z });
  }
  say(text) {
    this.feed.push({ t: this.t, text });
    if (this.feed.length > 50) this.feed.shift();
    this.io.to('players').to('hosts').emit('feed', { t: this.t, text });
    this.io.to('hosts').emit('roster', this.roster());
  }
}
