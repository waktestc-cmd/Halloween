'use strict';
// Pumpkin Smash game engine: one room, all state in memory, server-authoritative.
const crypto = require('crypto');
const S = require('../public/shared.js');

const FAST = process.env.DEV_FAST === '1';
const SCALE = Number(process.env.DEV_SCALE) || (FAST ? 0.15 : 1); // DEV_SCALE: test-only override
const T = (sec) => Math.round(sec * 1000 * SCALE);

const DUR = {
  rules: T(20),
  acts: [0, T(180), T(90), T(150)],
  pumpkinEvery: T(30),
  overtimeRelocate: T(20),
  overtimeMax: T(60),
  hammerRoom: T(25),
  hammerFoundTail: T(20), // once the hammer is found, act 2 wraps up within this
  soulEvery: [0, T(1.8), T(1.8), T(0.32)],
  pitch: T(10),
  vote: T(45),
  smash: 7600, // animation timeline, not a gameplay timer
  bloodMoon: T(30),
  lockedDoors: T(15),
  ghostFlood: T(25),
  soulShowerBanner: T(8),
};
const SOUL_CAP = [0, 10, 10, 32]; // natural souls per room, per act
const NROOMS = S.ROOMS.length;
const MIN_OPEN = 4;
const OPEN_MORE = [0, 0, 3, 5]; // extra rooms that open in each act
const NP = S.NUM_PUMPKINS;
const CLAIMS_PER_SEC = 10;
const EVENTS_PER_SEC = 40;
const SOUL_IN_DRAWER = 0.4; // chance an empty hiding place has a soul in it
const OPEN_AGAIN = T(25); // before the same hiding place can give you another soul
const PHONE_SOULS = 2;

const rint = (n) => crypto.randomInt(n); // 0..n-1
const pick = (arr) => arr[rint(arr.length)];
const clamp01 = (v) => Math.min(0.97, Math.max(0.03, Number(v) || 0.5));

// Souls rest on the floor painted into each room; pumpkins and the hammer hide inside things
// (wardrobes, chests, the oven): see tools/build_rooms.py.
const ROOM_META = require('../public/rooms/rooms.json').rooms;
const metaOf = (r) => ROOM_META.find((x) => x.id === S.ROOMS[r].id) || { surfaces: [], containers: [] };
const SURFACES = S.ROOMS.map((r, i) => {
  const m = metaOf(i);
  return m.surfaces.length ? m.surfaces : [{ x1: 0.2, x2: 0.8, y: 0.85, s: 1 }];
});
const CONTAINERS = S.ROOMS.map((r, i) => metaOf(i).containers || []);
function rpos(room) {
  const list = SURFACES[room];
  let total = 0;
  for (const sf of list) total += sf.x2 - sf.x1;
  let k = Math.random() * total;
  let sf = list[0];
  for (const c of list) {
    k -= c.x2 - c.x1;
    if (k <= 0) {
      sf = c;
      break;
    }
  }
  return { x: sf.x1 + Math.random() * (sf.x2 - sf.x1), y: sf.y, s: sf.s };
}
// where something dropped at (x, y) comes to rest: the nearest surface at or below it
function settle(room, x, y) {
  let best = null;
  let bestD = Infinity;
  for (const sf of SURFACES[room]) {
    const dx = x < sf.x1 ? sf.x1 - x : x > sf.x2 ? x - sf.x2 : 0;
    const dy = sf.y >= y - 0.02 ? sf.y - y : 1 + (y - sf.y);
    const d = dx * 2 + dy;
    if (d < bestD) {
      bestD = d;
      best = sf;
    }
  }
  return { x: Math.min(best.x2, Math.max(best.x1, x)), y: best.y, s: best.s, sf: best };
}
const say = (lines) => lines[rint(lines.length)];

function cleanName(raw) {
  return String(raw || '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, S.MAX_NAME)
    .trim();
}

class Game {
  constructor(io, log = console.log) {
    this.io = io;
    this.log = log;
    this.players = new Map(); // lowercase name -> player
    this.items = new Map(); // id -> {id, t, r, x, y, n?, v?}
    this.nextItemId = 1;
    this.gameId = 0;
    this.dirty = true;
    this.lastTick = Date.now();
    this.feedId = 1;
    this.resetGameState();
    this.phase = 'LOBBY';
    setInterval(() => this.tick(), 100);
    setInterval(() => this.flush(true), 1000);
    setInterval(() => this.flush(false), 200);
    setInterval(() => this.sendPeers(), 150);
  }

  // Everyone in a room sees the others in it: where their lanterns are.
  sendPeers() {
    if (this.phase !== 'HUNT') return;
    const now = Date.now();
    const byRoom = S.ROOMS.map(() => []);
    for (const p of this.players.values()) {
      if (!p.connected || p.room == null || !p.pos || now - p.pos.t > 4000) continue;
      byRoom[p.room].push({ n: p.name, c: p.costume, u: p.pos.u, v: p.pos.v, d: p.deadUntil > now ? 1 : 0 });
    }
    for (const p of this.players.values()) {
      if (!p.connected || !p.socketId || p.room == null) continue;
      this.io.to(p.socketId).volatile.emit('peers', byRoom[p.room].filter((q) => q.n !== p.name));
    }
  }

  resetGameState() {
    this.phase = 'LOBBY';
    this.act = 0;
    this.elapsed = 0;
    this.dur = null;
    this.paused = false;
    this.overtime = false;
    this.overtimeElapsed = 0;
    this.relocateT = 0;
    this.huntClock = 0;
    this.soulT = 0;
    this.baseOpen = 0;
    this.open = MIN_OPEN;
    this.hammerRoomT = 0;
    this.items.clear();
    this.pumpkins = [];
    for (let n = 1; n <= NP; n++) this.pumpkins.push({ n, spawned: false, itemId: null, holder: null, house: false });
    this.hammer = { itemId: null, holder: null, found: false };
    this.events = [];
    this.schedule = [];
    this.feed = [];
    this.pitchIndex = 0;
    this.smash = null;
    this.result = null;
    this.secret = null; // the winning pumpkin number: NEVER leaves the server before RESULT
  }

  // ---------- helpers ----------
  pub(key) {
    const p = key && this.players.get(key);
    return p ? { name: p.name, costume: p.costume } : null;
  }
  connectedPlayers() {
    return [...this.players.values()].filter((p) => p.connected);
  }
  markDirty() {
    this.dirty = true;
  }
  addFeed(kind, key, text, extra) {
    const e = Object.assign({ id: this.feedId++, kind, who: this.pub(key), text, t: Date.now() }, extra || {});
    this.feed.push(e);
    if (this.feed.length > 60) this.feed.shift();
    this.markDirty();
    return e;
  }
  announce(payload) {
    this.io.emit('announce', payload);
  }
  roomsWithEligible(test) {
    const set = new Set();
    for (const p of this.connectedPlayers()) if (p.room != null && test(p)) set.add(p.room);
    return [...set];
  }

  // ---------- the house ----------
  setOpen(act, tell) {
    const before = this.open;
    this.open = Math.min(NROOMS, Math.max(MIN_OPEN, this.baseOpen + OPEN_MORE[act]));
    if (tell && this.open > before) {
      const names = S.ROOMS.slice(before, this.open).map((r) => r.name.toLowerCase());
      const list = names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names[0];
      this.addFeed('event', null, `More of the house is open: the ${list}.`);
      this.log(`[house] ${this.open} rooms open`);
    }
    this.markDirty();
  }
  openRooms() {
    return S.ROOMS.slice(0, this.open).map((r, i) => i);
  }
  randRoom() {
    return rint(this.open);
  }
  // the open room with the fewest people in it (ties broken at random)
  quietRoom(except) {
    const count = new Array(NROOMS).fill(0);
    for (const p of this.connectedPlayers()) if (p.room != null) count[p.room]++;
    const rooms = this.openRooms().filter((r) => r !== except);
    const least = Math.min(...rooms.map((r) => count[r]));
    return pick(rooms.filter((r) => count[r] === least));
  }
  // a hiding place in this room with nothing in it yet
  freeContainer(room) {
    const n = CONTAINERS[room].length;
    if (!n) return null;
    const used = new Set();
    for (const it of this.items.values()) if (it.r === room && it.c != null) used.add(it.c);
    const free = [];
    for (let c = 0; c < n; c++) if (!used.has(c)) free.push(c);
    return free.length ? pick(free) : rint(n);
  }
  hidePos(room, c) {
    if (c == null) return rpos(room);
    const k = CONTAINERS[room][c];
    return { x: k.x + k.w / 2, y: k.y + k.h * 0.8, s: 1, c };
  }

  // ---------- items ----------
  addItem(t, r, x, y, extra) {
    const it = Object.assign({ id: this.nextItemId++, t, r, x, y }, extra || {});
    this.items.set(it.id, it);
    this.io.to('players').emit('item+', it);
    return it;
  }
  moveItem(it, r, pos) {
    it.r = r;
    it.x = pos.x;
    it.y = pos.y;
    it.s = pos.s;
    it.c = pos.c;
    this.io.to('players').emit('item~', { id: it.id, r, x: it.x, y: it.y, s: it.s, c: it.c });
  }
  // somewhere new to hide a pumpkin or the hammer
  hideItem(it, room) {
    this.moveItem(it, room, this.hidePos(room, this.freeContainer(room)));
  }
  removeItem(id, by) {
    const it = this.items.get(id);
    if (!it) return null;
    this.items.delete(id);
    this.io.to('players').emit('item-', { id, by: by || null });
    return it;
  }
  sendItems(target) {
    target.emit('items', [...this.items.values()]);
  }
  spawnSoul(room, natural = true, x, y, v = 1, scale = 1) {
    if (natural) {
      let count = 0;
      for (const it of this.items.values()) if (it.t === 's' && it.r === room) count++;
      if (count >= SOUL_CAP[this.act]) return;
    }
    const p = x == null ? rpos(room) : { x, y, s: scale };
    this.addItem('s', room, p.x, p.y, { v, s: p.s });
  }

  // ---------- state machine ----------
  setPhase(phase, dur) {
    this.phase = phase;
    this.elapsed = 0;
    this.dur = dur;
    this.log(`[phase] ${phase}${this.act ? ' act ' + this.act : ''}`);
    this.markDirty();
  }

  startGame() {
    for (const [k, p] of this.players) if (!p.connected) this.players.delete(k);
    if (this.players.size === 0) return false;
    this.resetGameState();
    this.gameId++;
    this.secret = crypto.randomInt(1, NP + 1);
    // the house is as big as the party: about one room for every two or three people
    this.baseOpen = Math.round(this.players.size / 2.5);
    this.setOpen(1, false);
    for (const p of this.players.values()) this.resetPlayer(p, true);
    const pool = ['lockedDoors', 'ghostFlood', 'soulShower'];
    const first = pool.splice(rint(pool.length), 1)[0];
    const second = pool[rint(pool.length)];
    this.schedule = [
      { act: 1, at: DUR.acts[1] * (0.35 + Math.random() * 0.35), type: first, done: false },
      { act: 2, at: DUR.acts[2] * (0.3 + Math.random() * 0.3), type: second, done: false },
      { act: 3, at: DUR.acts[3] * 0.3, type: 'bloodMoon', done: false },
    ];
    this.sendItems(this.io.to('players'));
    this.setPhase('RULES', DUR.rules);
    for (const p of this.players.values()) this.sendMe(p);
    return true;
  }

  resetPlayer(p, newRoom) {
    p.souls = 0;
    p.deaths = 0;
    p.pumpkin = null;
    p.hammer = false;
    p.vote = null;
    p.scares = 0;
    p.deadUntil = 0;
    p.pos = null;
    p.opened = {};
    p.room = newRoom ? this.quietRoom(null) : null;
  }

  startAct(n) {
    this.phase = 'HUNT';
    this.act = n;
    this.overtime = false;
    this.soulT = 0;
    this.setPhase('HUNT', DUR.acts[n]);
    this.setOpen(n, n > 1);
    if (n === 2) this.spawnHammer();
    this.addFeed('act', null, `Act ${S.ACTS[n].ordinal}. ${S.ACTS[n].name}.`);
    this.announce({ kind: 'act', act: n });
  }

  endAct(skipped) {
    if (this.act === 1) {
      while (this.spawnedCount() < NP) this.spawnPumpkin();
      if (skipped || this.unclaimed().length === 0) {
        this.autoAssignPumpkins();
        this.startAct(2);
      } else {
        this.overtime = true;
        this.overtimeElapsed = 0;
        this.relocateT = 0;
        this.dur = null;
        this.addFeed('event', null, 'Nobody leaves until every pumpkin has a keeper.');
        this.announce({ kind: 'overtime' });
        this.log('[hunt] act 1 overtime');
        this.markDirty();
      }
    } else if (this.act === 2) {
      if (!this.hammer.holder) this.giveHammerRandom();
      if (this.hammer.itemId) this.removeItem(this.hammer.itemId);
      this.hammer.itemId = null;
      this.startAct(3);
    } else {
      this.endHunt();
    }
  }

  endHunt() {
    this.items.clear();
    this.sendItems(this.io.to('players'));
    this.events = [];
    this.act = 0;
    this.pitchIndex = 0;
    this.setPhase('PITCHES', DUR.pitch);
    this.announce({ kind: 'phase', phase: 'PITCHES' });
  }

  nextPitch() {
    this.pitchIndex++;
    if (this.pitchIndex >= NP) this.startVote();
    else {
      this.elapsed = 0;
      this.markDirty();
    }
  }

  startVote() {
    for (const p of this.players.values()) p.vote = null;
    this.setPhase('VOTE', DUR.vote);
    for (const p of this.players.values()) this.sendMe(p);
  }

  tally() {
    const weights = new Array(NP).fill(0);
    const counts = new Array(NP).fill(0);
    let total = 0;
    for (const p of this.players.values()) {
      if (!p.vote) continue;
      const w = 1 + p.souls;
      weights[p.vote - 1] += w;
      counts[p.vote - 1]++;
      total += w;
    }
    return { weights, counts, total };
  }

  doSmash() {
    const { weights, total } = this.tally();
    let target;
    if (total === 0) target = rint(NP) + 1;
    else {
      const best = Math.max(...weights);
      const tied = [];
      weights.forEach((w, i) => w === best && tied.push(i + 1));
      target = pick(tied); // ties broken with crypto-random
    }
    // Rehearsal knob for the win screen; ignored unless DEV_FAST is on too.
    if (FAST && process.env.DEV_FORCE_WIN === '1') target = this.secret;
    const pk = this.pumpkins[target - 1];
    this.smash = { target, holder: this.pub(pk.holder), hammer: this.pub(this.hammer.holder) };
    this.setPhase('SMASH', DUR.smash);
  }

  showResult() {
    const all = [...this.players.values()];
    for (const p of all) p.haunted = p.deaths + p.scares;
    const top = (field) => {
      const best = Math.max(0, ...all.map((p) => p[field]));
      if (best <= 0) return null;
      return { value: best, who: all.filter((p) => p[field] === best).slice(0, 3).map((p) => this.pub(p.key)) };
    };
    const smashed = this.smash.target;
    this.result = {
      smashed,
      winning: this.secret,
      win: smashed === this.secret,
      smashedHolder: this.pub(this.pumpkins[smashed - 1].holder),
      winningHolder: this.pub(this.pumpkins[this.secret - 1].holder),
      awards: {
        souls: top('souls'),
        haunted: top('haunted'),
        hammer: this.hammer.holder ? { who: [this.pub(this.hammer.holder)] } : null,
      },
    };
    this.log(`[result] smashed ${smashed}, winning ${this.secret} -> ${this.result.win ? 'WIN' : 'zombie'}`);
    this.setPhase('RESULT', null);
  }

  resetToLobby() {
    for (const [k, p] of this.players) if (!p.connected) this.players.delete(k);
    this.resetGameState();
    this.gameId++;
    for (const p of this.players.values()) {
      this.resetPlayer(p, false);
      this.sendMe(p);
    }
    this.sendItems(this.io.to('players'));
    this.setPhase('LOBBY', null);
  }

  // ---------- hunt mechanics ----------
  spawnedCount() {
    return this.pumpkins.filter((p) => p.spawned).length;
  }
  unclaimed() {
    return this.pumpkins.filter((p) => p.spawned && !p.holder);
  }
  spawnPumpkin() {
    const pk = this.pumpkins.find((p) => !p.spawned);
    if (!pk) return;
    const room = this.randRoom();
    const pos = this.hidePos(room, this.freeContainer(room));
    const it = this.addItem('p', room, pos.x, pos.y, { n: pk.n, s: pos.s, c: pos.c });
    pk.spawned = true;
    pk.itemId = it.id;
    this.addFeed('spawn', null, `Pumpkin ${pk.n} is hidden somewhere ${S.ROOMS[it.r].at}.`, { n: pk.n });
    this.announce({ kind: 'pumpkinSpawn', n: pk.n, room: it.r });
  }
  relocateUnclaimed() {
    const rooms = this.roomsWithEligible((p) => !p.pumpkin);
    for (const pk of this.unclaimed()) {
      const it = this.items.get(pk.itemId);
      if (!it) continue;
      const room = rooms.length ? pick(rooms) : this.randRoom();
      this.hideItem(it, room);
    }
    this.markDirty();
  }
  autoAssignPumpkins() {
    for (const pk of this.pumpkins) {
      if (pk.holder) continue;
      if (pk.itemId) this.removeItem(pk.itemId);
      pk.itemId = null;
      pk.spawned = true;
      let cands = this.connectedPlayers().filter((p) => !p.pumpkin && !p.hammer);
      if (!cands.length) cands = [...this.players.values()].filter((p) => !p.pumpkin && !p.hammer);
      if (!cands.length) {
        pk.house = true;
        this.addFeed('pumpkin', null, `Pumpkin ${pk.n} stays with the House.`, { n: pk.n });
        continue;
      }
      const p = pick(cands);
      pk.holder = p.key;
      p.pumpkin = pk.n;
      this.addFeed('pumpkin', p.key, `The House gave Pumpkin ${pk.n} to ${p.name}.`, { n: pk.n });
      this.sendMe(p);
    }
  }
  spawnHammer() {
    const rooms = this.roomsWithEligible((p) => !p.pumpkin);
    const room = rooms.length ? pick(rooms) : this.randRoom();
    const pos = this.hidePos(room, this.freeContainer(room));
    const it = this.addItem('h', room, pos.x, pos.y, { s: pos.s, c: pos.c });
    this.hammer.itemId = it.id;
    this.hammerRoomT = 0;
    this.markDirty();
  }
  giveHammerRandom() {
    let cands = this.connectedPlayers().filter((p) => !p.pumpkin);
    if (!cands.length) cands = [...this.players.values()].filter((p) => !p.pumpkin);
    if (!cands.length) cands = [...this.players.values()];
    if (!cands.length) return;
    const p = pick(cands);
    p.hammer = true;
    this.hammer.holder = p.key;
    this.hammer.found = false;
    this.addFeed('hammer', p.key, `The House gave the hammer to ${p.name}. Nobody asked.`);
    this.sendMe(p);
  }

  triggerEvent(type) {
    const room = this.randRoom();
    const add = (dur, r) => this.events.push({ type, room: r, until: this.huntClock + dur });
    if (type === 'bloodMoon') add(DUR.bloodMoon, null);
    else if (type === 'lockedDoors') add(DUR.lockedDoors, null);
    else if (type === 'ghostFlood') add(DUR.ghostFlood, room);
    else if (type === 'soulShower') {
      add(DUR.soulShowerBanner, room);
      for (let i = 0; i < 24; i++) this.spawnSoul(room, false);
    }
    const ev = S.EVENTS[type];
    const local = type === 'ghostFlood' || type === 'soulShower';
    this.addFeed('event', null, ev.line(S.ROOMS[room].at), { event: type });
    this.announce({ kind: 'event', type, room: local ? room : null });
    this.log(`[event] ${type}${local ? ' ' + S.ROOMS[room].name : ''}`);
  }

  huntTick(dt) {
    this.huntClock += dt;
    const before = this.events.length;
    this.events = this.events.filter((e) => e.until > this.huntClock);
    if (this.events.length !== before) this.markDirty();

    for (const ev of this.schedule) {
      if (!ev.done && ev.act === this.act && this.elapsed >= ev.at) {
        ev.done = true;
        this.triggerEvent(ev.type);
      }
    }

    if (this.act === 1) {
      const due = Math.min(NP, Math.floor(this.elapsed / DUR.pumpkinEvery) + 1);
      while (this.spawnedCount() < due) this.spawnPumpkin();
      if (this.overtime) {
        this.overtimeElapsed += dt;
        this.relocateT += dt;
        if (this.overtimeElapsed >= DUR.overtimeMax || this.connectedPlayers().every((p) => p.pumpkin)) {
          this.autoAssignPumpkins();
          this.startAct(2);
          return;
        }
        if (this.relocateT >= DUR.overtimeRelocate) {
          this.relocateT = 0;
          this.relocateUnclaimed();
        }
      }
    }

    // the hammer will not sit still: every so often it is somewhere else
    if (this.act === 2 && this.hammer.itemId) {
      const it = this.items.get(this.hammer.itemId);
      this.hammerRoomT += dt;
      if (it && this.hammerRoomT >= DUR.hammerRoom) {
        this.hammerRoomT = 0;
        const rooms = this.roomsWithEligible((p) => !p.pumpkin).filter((r) => r !== it.r);
        const others = this.openRooms().filter((r) => r !== it.r);
        this.hideItem(it, rooms.length ? pick(rooms) : pick(others));
        this.markDirty();
      }
    }

    const every = DUR.soulEvery[this.act];
    if (every) {
      this.soulT += dt;
      while (this.soulT >= every) {
        this.soulT -= every;
        this.spawnSoul(this.randRoom(), true);
      }
    }
  }

  tick() {
    const now = Date.now();
    const dt = Math.min(now - this.lastTick, 1000);
    this.lastTick = now;
    if (this.paused || this.phase === 'LOBBY' || this.phase === 'RESULT') return;
    this.elapsed += dt;
    if (this.phase === 'HUNT') this.huntTick(dt);
    if (this.dur != null && this.elapsed >= this.dur) this.timeout(false);
  }

  timeout(skipped) {
    switch (this.phase) {
      case 'RULES':
        return this.startAct(1);
      case 'HUNT':
        return this.endAct(skipped);
      case 'PITCHES':
        return this.nextPitch();
      case 'VOTE':
        return this.doSmash();
      case 'SMASH':
        return this.showResult();
    }
  }

  // ---------- state out ----------
  publicState(host) {
    const s = {
      phase: this.phase,
      act: this.act,
      gameId: this.gameId,
      paused: this.paused,
      overtime: this.overtime,
      remaining: this.dur != null ? Math.max(0, this.dur - this.elapsed) : null,
      dur: this.dur,
      elapsed: this.elapsed,
      fast: FAST,
      open: this.open,
      events: this.events.map((e) => ({ type: e.type, room: e.room, remaining: e.until - this.huntClock })),
      pumpkins: this.pumpkins.map((pk) => {
        const it = pk.itemId && !pk.holder ? this.items.get(pk.itemId) : null;
        return { n: pk.n, spawned: pk.spawned, room: it ? it.r : null, holder: this.pub(pk.holder), house: pk.house };
      }),
      hammer: {
        holder: this.pub(this.hammer.holder),
        room: this.hammer.itemId && this.items.get(this.hammer.itemId) ? this.items.get(this.hammer.itemId).r : null,
      },
      pitchIndex: this.pitchIndex,
      tally: ['VOTE', 'SMASH', 'RESULT'].includes(this.phase) ? this.tally() : null,
      smash: this.smash,
      result: this.phase === 'RESULT' ? this.result : null,
      playerCount: this.connectedPlayers().length,
      feed: this.feed.slice(host ? -40 : -4),
    };
    if (host) {
      const all = [...this.players.values()];
      s.players = all.map((p) => ({
        name: p.name,
        costume: p.costume,
        room: p.room,
        souls: p.souls,
        deaths: p.deaths + p.scares,
        pumpkin: p.pumpkin,
        hammer: p.hammer,
        connected: p.connected,
        voted: !!p.vote,
      }));
      s.leaderboard = all
        .filter((p) => p.souls > 0)
        .sort((a, b) => b.souls - a.souls)
        .slice(0, 5)
        .map((p) => ({ name: p.name, costume: p.costume, souls: p.souls }));
    }
    return s;
  }

  flush(force) {
    if (!this.dirty && !force) return;
    this.dirty = false;
    this.io.to('players').emit('state', this.publicState(false));
    this.io.to('hosts').emit('hstate', this.publicState(true));
  }

  meState(p) {
    return {
      name: p.name,
      costume: p.costume,
      room: p.room,
      souls: p.souls,
      deaths: p.deaths,
      pumpkin: p.pumpkin,
      hammer: p.hammer,
      vote: p.vote,
      weight: 1 + p.souls,
      gameId: this.gameId,
    };
  }
  sendMe(p) {
    if (p.connected && p.socketId) this.io.to(p.socketId).emit('me', this.meState(p));
  }

  // ---------- sockets ----------
  rateOk(socket, bucket, limit) {
    const now = Date.now();
    const d = socket.data;
    d[bucket] = (d[bucket] || []).filter((t) => now - t < 1000);
    if (d[bucket].length >= limit) return false;
    d[bucket].push(now);
    return true;
  }

  attachPlayer(socket) {
    const me = () => {
      const p = socket.data.key && this.players.get(socket.data.key);
      return p && p.socketId === socket.id ? p : null;
    };
    const on = (ev, fn) =>
      socket.on(ev, (data, ack) => {
        if (typeof ack !== 'function') ack = () => {};
        if (!this.rateOk(socket, 'ev', EVENTS_PER_SEC)) return ack({ ok: false, reason: 'slow-down' });
        try {
          fn(data || {}, ack);
        } catch (err) {
          this.log('[error]', ev, err);
          ack({ ok: false, reason: 'error' });
        }
      });

    on('join', (data, ack) => {
      const name = cleanName(data.name);
      if (!name) return ack({ ok: false, error: 'Enter a name' });
      const key = name.toLowerCase();
      const costume = S.COSTUMES.some((c) => c.id === data.costume) ? data.costume : pick(S.COSTUMES).id;
      let p = this.players.get(key);
      let rejoined = false;
      if (p) {
        if (p.connected && p.socketId !== socket.id && p.token !== data.token) {
          return ack({ ok: false, error: 'That name is already in the house. Pick another!' });
        }
        rejoined = true;
        if (p.connected && p.socketId && p.socketId !== socket.id) {
          const old = this.io.sockets.sockets.get(p.socketId);
          if (old) {
            old.data.key = null;
            old.emit('kicked');
            old.disconnect(true);
          }
        }
      } else {
        p = { key, name, costume, token: crypto.randomBytes(12).toString('hex') };
        this.resetPlayer(p, this.phase !== 'LOBBY');
        this.players.set(key, p);
        if (this.phase === 'LOBBY') this.log(`[join] ${name} (${costume})`);
      }
      p.socketId = socket.id;
      p.connected = true;
      if (this.phase === 'HUNT' && p.room == null) p.room = this.quietRoom(null);
      socket.data.key = key;
      socket.join('players');
      ack({ ok: true, token: p.token, rejoined, me: this.meState(p) });
      this.sendItems(socket);
      socket.emit('state', this.publicState(false));
      this.markDirty();
    });

    on('claim', (data, ack) => {
      const p = me();
      if (!p) return ack({ ok: false, reason: 'not-joined' });
      if (!this.rateOk(socket, 'claims', CLAIMS_PER_SEC)) return ack({ ok: false, reason: 'slow-down' });
      ack(this.claim(p, Number(data.id)));
    });

    on('door', (data, ack) => {
      const p = me();
      if (!p || this.phase !== 'HUNT' || this.paused) return ack({ ok: false });
      if (this.events.some((e) => e.type === 'lockedDoors')) return ack({ ok: false, reason: 'locked' });
      const now = Date.now();
      if (now - (p.lastDoor || 0) < 700) return ack({ ok: false, reason: 'slow-down' });
      p.lastDoor = now;
      // a door always leads somewhere quieter (tests on DEV_FAST may pick the room)
      const to = Number(data.to);
      p.room = FAST && Number.isInteger(to) && to >= 0 && to < this.open && to !== p.room ? to : this.quietRoom(p.room);
      p.pos = null;
      ack({ ok: true, room: p.room });
      this.sendMe(p);
      this.markDirty();
    });

    on('died', (data, ack) => {
      const p = me();
      if (!p || this.phase !== 'HUNT') return ack({ ok: false });
      const now = Date.now();
      if (now - (p.lastDeath || 0) < 4000) return ack({ ok: false, reason: 'slow-down' });
      p.lastDeath = now;
      p.deadUntil = now + 4500;
      p.deaths++;
      const drop = Math.floor(p.souls / 2);
      p.souls -= drop;
      const x = clamp01(data.x);
      const y = clamp01(data.y);
      if (drop > 0 && p.room != null) {
        // the souls fall and settle on the surface below
        const pieces = Math.min(drop, 12);
        const rest = settle(p.room, x, y);
        for (let i = 0; i < pieces; i++) {
          const v = Math.floor(drop / pieces) + (i < drop % pieces ? 1 : 0);
          const sx = Math.min(rest.sf.x2, Math.max(rest.sf.x1, rest.x + (i - (pieces - 1) / 2) * 0.018));
          this.spawnSoul(p.room, false, sx, rest.y, v, rest.s);
        }
      }
      const gi = Number.isInteger(data.ghost) && S.GHOSTS[data.ghost] ? data.ghost : p.room || 0;
      if (data.zombie) {
        const z = S.ZOMBIES[gi].name;
        this.addFeed('death', p.key, say([`${p.name} was dragged off by the ${z}.`, `The ${z} got ${p.name}.`]), { ghost: gi, zombie: true });
      } else this.addFeed('death', p.key, `${p.name} was taken by the ${S.GHOSTS[gi].name}.`, { ghost: gi });
      ack({ ok: true, dropped: drop });
      this.sendMe(p);
    });

    // one click opens a hiding place; whatever is inside is yours if you can carry it
    on('open', (data, ack) => {
      const p = me();
      if (!p || this.phase !== 'HUNT' || this.paused || p.room == null) return ack({ ok: false });
      const c = Number(data.c);
      if (!Number.isInteger(c) || !CONTAINERS[p.room][c]) return ack({ ok: false });
      if (!this.rateOk(socket, 'claims', CLAIMS_PER_SEC)) return ack({ ok: false, reason: 'slow-down' });
      ack(this.openContainer(p, c));
    });

    // a fright from one of the residents: you drop a soul
    on('scared', (data, ack) => {
      const p = me();
      const r = p && p.room != null && S.RESIDENTS[S.ROOMS[p.room].id];
      if (!p || !r || this.phase !== 'HUNT') return ack({ ok: false });
      const now = Date.now();
      if (now - (p.lastScare || 0) < 5000) return ack({ ok: false, reason: 'slow-down' });
      p.lastScare = now;
      p.scares++;
      let dropped = 0;
      if (p.souls > 0) {
        dropped = 1;
        p.souls--;
        const rest = settle(p.room, clamp01(data.x), clamp01(data.y));
        this.spawnSoul(p.room, false, rest.x, rest.y, 1, rest.s);
      }
      this.addFeed('scare', p.key, say([`${r.name} found ${p.name} ${S.ROOMS[p.room].at}.`, `${p.name} met ${r.name}.`, `${r.name} said hello to ${p.name}.`]));
      ack({ ok: true, dropped });
      this.sendMe(p);
    });

    // Ghostface rings; whoever answers gets a reward for their nerve
    on('phone', (data, ack) => {
      const p = me();
      if (!p || this.phase !== 'HUNT' || p.room == null || S.ROOMS[p.room].id !== 'hall') return ack({ ok: false });
      const now = Date.now();
      if (now - (p.lastPhone || 0) < T(20)) return ack({ ok: false, reason: 'slow-down' });
      p.lastPhone = now;
      p.souls += PHONE_SOULS;
      p.scares++;
      this.addFeed('scare', p.key, `${p.name} answered the telephone. Brave.`);
      ack({ ok: true, souls: PHONE_SOULS });
      this.sendMe(p);
    });

    on('respawn', (data, ack) => {
      const p = me();
      if (!p) return ack({ ok: false });
      p.deadUntil = 0;
      p.pos = null;
      if (this.phase === 'HUNT') p.room = this.quietRoom(null);
      ack({ ok: true, room: p.room });
      this.sendMe(p);
      this.markDirty();
    });

    on('vote', (data, ack) => {
      const p = me();
      const n = Number(data.n);
      if (!p || this.phase !== 'VOTE' || this.paused || !(n >= 1 && n <= NP && Number.isInteger(n))) return ack({ ok: false });
      p.vote = n;
      ack({ ok: true });
      this.sendMe(p);
      this.markDirty();
    });

    // where this player's lantern is (no ack; sent ~8 times a second while hunting)
    socket.on('pos', (data) => {
      const p = me();
      if (!p || this.phase !== 'HUNT' || !data || !this.rateOk(socket, 'pos', 20)) return;
      p.pos = { u: clamp01(data.u), v: clamp01(data.v), t: Date.now() };
    });

    socket.on('disconnect', () => {
      const p = socket.data.key && this.players.get(socket.data.key);
      if (p && p.socketId === socket.id) {
        p.connected = false;
        this.markDirty();
      }
    });
  }

  openContainer(p, c) {
    if (p.deadUntil > Date.now()) return { ok: false, reason: 'dead' };
    const it = [...this.items.values()].find((x) => x.r === p.room && x.c === c && (x.t === 'p' || x.t === 'h'));
    if (it) {
      const res = this.claim(p, it.id);
      if (res.ok) return { ok: true, found: it.t, n: it.n };
      return { ok: true, found: it.t, n: it.n, kept: false, reason: res.reason };
    }
    // nothing hidden here; sometimes a soul
    const key = p.room + ':' + c;
    const now = Date.now();
    if (now - (p.opened[key] || -1e12) > OPEN_AGAIN && Math.random() < SOUL_IN_DRAWER) {
      p.opened[key] = now;
      p.souls += 1;
      this.sendMe(p);
      this.markDirty();
      return { ok: true, found: 's', v: 1 };
    }
    p.opened[key] = p.opened[key] || now;
    return { ok: true, found: null };
  }

  claim(p, id) {
    if (this.phase !== 'HUNT' || this.paused) return { ok: false, reason: 'not-now' };
    if (p.deadUntil > Date.now()) return { ok: false, reason: 'dead' };
    const it = this.items.get(id);
    if (!it) return { ok: false, reason: 'gone' };
    if (it.r !== p.room) return { ok: false, reason: 'wrong-room' };

    if (it.t === 'p') {
      if (p.pumpkin) return { ok: false, reason: 'has-pumpkin' };
      if (p.hammer) return { ok: false, reason: 'has-hammer' };
      this.removeItem(id, p.name);
      const pk = this.pumpkins[it.n - 1];
      pk.holder = p.key;
      pk.itemId = null;
      p.pumpkin = it.n;
      this.addFeed('pumpkin', p.key, say([`Pumpkin ${it.n} has a keeper. It is ${p.name}.`, `${p.name} took Pumpkin ${it.n}.`, `${p.name} has Pumpkin ${it.n}. Nobody trusts ${p.name}.`]), { n: it.n });
      this.log(`[claim] ${p.name} -> pumpkin ${it.n}`);
      if (this.act === 1 && this.overtime && this.unclaimed().length === 0 && this.spawnedCount() === NP) {
        this.startAct(2);
      }
    } else if (it.t === 'h') {
      if (p.pumpkin) return { ok: false, reason: 'has-pumpkin' };
      if (p.hammer) return { ok: false, reason: 'has-hammer' };
      this.removeItem(id, p.name);
      this.hammer.itemId = null;
      this.hammer.holder = p.key;
      this.hammer.found = true;
      p.hammer = true;
      this.addFeed('hammer', p.key, say([`${p.name} found the hammer.`, `${p.name} has the hammer. Be nice to ${p.name}.`]));
      this.log(`[claim] ${p.name} -> hammer`);
      if (this.dur != null) this.dur = Math.min(this.dur, this.elapsed + DUR.hammerFoundTail);
      // the act is ending sooner, so make sure its random event still happens
      for (const ev of this.schedule) if (ev.act === 2 && !ev.done) ev.at = Math.min(ev.at, this.elapsed + T(3));
    } else {
      this.removeItem(id, p.name);
      p.souls += it.v || 1;
    }
    this.sendMe(p);
    this.markDirty();
    return { ok: true, t: it.t, n: it.n, v: it.v };
  }

  attachHost(socket) {
    socket.join('hosts');
    socket.emit('hstate', this.publicState(true));
    const on = (ev, fn) =>
      socket.on(ev, () => {
        if (!this.rateOk(socket, 'ev', 10)) return;
        fn();
        this.markDirty();
        this.flush(true);
      });
    on('host:start', () => {
      if (this.phase === 'LOBBY') this.startGame();
    });
    on('host:pause', () => {
      if (['RULES', 'HUNT', 'PITCHES', 'VOTE'].includes(this.phase)) {
        this.paused = !this.paused;
        this.log(`[host] ${this.paused ? 'paused' : 'resumed'}`);
      }
    });
    on('host:skip', () => {
      if (this.paused) this.paused = false;
      if (['RULES', 'HUNT', 'PITCHES', 'VOTE', 'SMASH'].includes(this.phase)) this.timeout(true);
    });
    on('host:next', () => {
      if (this.phase === 'HUNT') return; // acts are skipped with host:skip only
      if (this.paused) this.paused = false;
      if (['RULES', 'PITCHES', 'VOTE', 'SMASH'].includes(this.phase)) this.timeout(true);
    });
    on('host:reset', () => this.resetToLobby());
  }
}

module.exports = { Game, DUR, FAST };
