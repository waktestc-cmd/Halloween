// Plays the rules through with fake players against a real server (DEV=1, GRACE=0):
// a nun catches you three times and you are out; the puzzle chain opens the front door.
import { spawn } from 'child_process';
import { io } from 'socket.io-client';
import assert from 'assert';
import * as L from '../shared/level.js';
import * as C from '../shared/config.js';

const PORT = 3300 + Math.floor(Math.random() * 500);
const URL = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const srv = spawn('node', ['server.js'], { env: { ...process.env, DEV: '1', GRACE: '0', PORT: String(PORT) }, stdio: 'ignore' });
// the next ev whose message passes ok
const until = (s, ev, ok, ms = 8000) => new Promise((res, rej) => {
  const t = setTimeout(() => (s.off(ev, f), rej(new Error('timeout waiting for ' + ev))), ms);
  const f = (m) => ok(m) && (clearTimeout(t), s.off(ev, f), res(m));
  s.on(ev, f);
});
const once = (s, ev, ms = 8000) => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('timeout waiting for ' + ev)), ms);
  s.once(ev, (m) => (clearTimeout(t), res(m)));
});
function player(name, costume) {
  const s = io(URL, { transports: ['websocket'], forceNew: true });
  s.emit('join', { name, look: 1, costume });
  return s;
}
let failed = false;
try {
  // wait until the server answers (it can take a moment to start)
  for (let i = 0; i < 50; i++) {
    const up = await fetch(URL + '/healthz').then((r) => r.ok, () => false);
    if (up) break;
    await sleep(200);
  }
  const host = io(URL, { transports: ['websocket'], auth: { role: 'host', key: 'spooky' }, forceNew: true });
  await once(host, 'welcome');
  // listen for both welcomes before waiting on either, or the second can arrive unheard
  const both = until(host, 'roster', (r) => r.some((p) => p.name === 'Alice') && r.some((p) => p.name === 'Bob'));
  const a = player('Alice', 7);
  const b = player('Bob');
  const [aWelcome] = await Promise.all([once(a, 'welcome'), once(b, 'welcome')]);
  // the costume picked on the join screen reaches everyone, in the roster
  const roster = await both;
  assert.equal(roster.find((p) => p.name === 'Alice').costume, 7, 'Alice is the witch');
  assert.ok(Number.isInteger(roster.find((p) => p.name === 'Bob').costume), 'Bob, who picked none, still gets a costume');
  console.log('ok: the costume reaches the roster');
  host.emit('start');
  await once(a, 'start');
  b.emit('dev:freeze', true);

  // 1. caught three times
  let lives = 3;
  for (let i = 1; i <= 3; i++) {
    a.emit('dev:where');
    const w = await once(a, 'dev:where');
    const n = w.monsters.find((m) => m.state !== 'asleep');
    // stand right in front of it, light on
    a.emit('dev:tp', { x: n.x + Math.sin(n.yaw) * 0.6, z: n.z + Math.cos(n.yaw) * 0.6 });
    await sleep(50);
    b.emit('dev:freeze', false);
    const hit = await once(a, 'hit', 6000);
    b.emit('dev:freeze', true);
    lives--;
    assert.equal(hit.lives, lives, 'lives go down by one');
    assert.ok(['vampire', 'creature', 'zombie'].includes(hit.by), 'caught by a monster');
    if (lives > 0) {
      const [c, r] = L.tileOf(hit.x, hit.z);
      assert.equal(L.at(c, r), 'd', 'you wake up in the guest bedrooms');
      // still reporting the old spot does not count; showing up in the dormitory does
      a.emit('state', { x: hit.x + 20, z: hit.z + 20, yaw: 0 });
      a.emit('state', { x: hit.x, z: hit.z, yaw: 0 });
      await sleep(5200); // the safe moment after waking
    }
  }
  a.emit('dev:where');
  await once(a, 'dev:where');
  console.log('ok: three catches and you are out');

  // the flashlight's charge survives a refresh: the same browser comes back with it
  a.emit('state', { x: 1, z: 1, battery: 0.3 });
  await sleep(60);
  const a2 = io(URL, { transports: ['websocket'], forceNew: true });
  a2.emit('join', { name: 'Alice', look: 1, token: aWelcome.token });
  assert.equal((await once(a2, 'welcome')).me.battery, 0.3, 'the battery level comes back after a refresh');
  console.log('ok: a refresh keeps the flashlight battery');

  // 2. the Count shrinks back from Bob's flashlight
  b.emit('dev:where');
  const v = (await once(b, 'dev:where')).monsters.find((m) => m.kind === 'vampire');
  const [vc, vr] = L.tileOf(v.x, v.z);
  const spot = [[3, 0], [-3, 0], [0, 3], [0, -3]].map(([dc, dr]) => [vc + dc, vr + dr]).find(([c, r]) => L.floorTile(c, r) && L.clearLine(...L.centre(c, r), v.x, v.z, () => true));
  const [bx, bz] = L.centre(...spot);
  b.emit('dev:tp', { x: bx, z: bz });
  await sleep(60);
  b.emit('state', { x: bx, z: bz, yaw: Math.atan2(-(v.x - bx), -(v.z - bz)), light: true, moving: false });
  b.emit('dev:freeze', false);
  await sleep(300);
  b.emit('dev:freeze', true);
  b.emit('dev:where');
  assert.ok((await once(b, 'dev:where')).monsters.find((m) => m.kind === 'vampire').stunned, 'the Count flinches from the light');
  console.log('ok: the Count flinches from a flashlight');

  // Q: Bob's flash dazzles the zombie in front of him and vanishes the ghost there, not the Count behind
  const fl = { x: 20, z: 14 }; // the north gallery corridor, facing east along it
  const where = async () => (b.emit('dev:where'), once(b, 'dev:where'));
  for (let i = 0; i < 30 && (await where()).monsters.find((m) => m.kind === 'vampire').stunned; i++) await sleep(150);
  const ws = await where();
  const zombie = ws.monsters.find((m) => m.kind === 'zombie');
  const count = ws.monsters.find((m) => m.kind === 'vampire');
  b.emit('dev:place', { id: zombie.id, x: fl.x + 3, z: fl.z });
  b.emit('dev:place', { id: count.id, x: fl.x - 3, z: fl.z });
  b.emit('dev:place', { id: ws.ghosts[0].id, x: fl.x + 4, z: fl.z + 0.5 });
  for (const g of ws.ghosts.slice(1)) b.emit('dev:place', { id: g.id, x: 6, z: 42 }); // the others well away, in the crypt
  b.emit('dev:tp', fl);
  await sleep(60);
  b.emit('state', { ...fl, yaw: -Math.PI / 2, battery: 1 });
  b.emit('flash', { yaw: -Math.PI / 2 });
  const flashed = await once(b, 'flashed');
  assert.equal(flashed.monsters, 1, 'one monster dazzled');
  assert.equal(flashed.ghosts, 1, 'one ghost vanished');
  assert.ok(Math.abs(flashed.battery - 0.75) < 0.01, 'the flash costs a quarter of the battery');
  const wf = await where();
  assert.ok(wf.monsters.find((m) => m.id === zombie.id).stunned, 'the zombie in front is dazzled');
  assert.ok(!wf.monsters.find((m) => m.id === count.id).stunned, 'the Count behind is not');
  assert.ok(!wf.ghosts.find((g) => g.id === ws.ghosts[0].id).alive, 'the ghost in front vanishes');
  // straight away again: not ready yet
  b.emit('flash', { yaw: -Math.PI / 2 });
  assert.ok((await once(b, 'flash-no')).wait > 5, 'the flash needs time to recharge');
  // later, but with too little battery: no
  b.emit('dev:time', { t: wf.t + 11 });
  b.emit('state', { ...fl, yaw: -Math.PI / 2, battery: 0.1 });
  b.emit('flash', { yaw: -Math.PI / 2 });
  assert.ok((await once(b, 'flash-no')).battery < 0.25, 'the flash needs a quarter of the battery');
  b.emit('state', { ...fl, yaw: -Math.PI / 2, battery: 1 });
  b.emit('flash', { yaw: -Math.PI / 2 });
  await once(b, 'flashed');
  console.log('ok: the flash dazzles what is in front, banishes ghosts, costs battery and recharges');

  // 3. the puzzle chain, carried out by Bob
  b.emit('dev:freeze', true);
  b.emit('dev:where');
  let w = await once(b, 'dev:where');
  const [fx, fz] = L.centre(L.FRONT.c, L.FRONT.r);
  // no iron key anywhere before the desk is open, and the front door will not take one yet
  assert.ok(!w.boxes.some(([, it]) => /^key/.test(it)), 'no iron key is hidden before the desk');
  b.emit('dev:give', { item: 'key1' });
  await once(b, 'me');
  b.emit('dev:tp', { x: fx, z: fz - 1.5 });
  await sleep(60);
  b.emit('use', { what: 'front' });
  assert.match(await once(b, 'toast'), /won't budge/, 'the front door refuses a key before the desk');
  b.emit('dev:give', { item: null });
  await once(b, 'me');
  console.log('ok: no iron keys before the desk, and the padlocks refuse one');
  assert.equal(w.monsters.find((m) => m.kind === 'creature').state, 'asleep', "the Doctor's Monster sleeps until the power is back");
  const box = (item) => L.PROPS[w.boxes.find(([, it]) => it === item)[0]];
  const take = async (item) => {
    const p = box(item);
    b.emit('dev:tp', { x: p.x, z: p.z });
    await sleep(60);
    b.emit('search', { prop: p.id });
    const f = await once(b, 'found');
    assert.equal(f.item, item, 'found ' + item);
  };
  const stage = () => once(b, 'stage');
  await take('fuse');
  // G: Bob, in the gallery facing east along it, puts the fuse down in front of him
  const [bx0, bz0] = [12, 14];
  b.emit('dev:tp', { x: bx0, z: bz0 });
  await sleep(60);
  b.emit('dev:where');
  const here = (await once(b, 'dev:where')).loose.length;
  const dropped = until(b, 'feed', (f) => /^Bob dropped the fuse in the /.test(f.text));
  const emptied = until(b, 'me', (m) => m.carrying === null);
  b.emit('drop', { yaw: -Math.PI / 2 });
  await Promise.all([dropped, emptied]);
  b.emit('dev:where');
  const lying = (await once(b, 'dev:where')).loose;
  assert.equal(lying.length, here + 1, 'the fuse lies on the floor');
  const it = lying.find((l) => l.item === 'fuse');
  const [ic, ir] = L.tileOf(it.x, it.z);
  assert.ok(L.floorTile(ic, ir) && L.at(ic, ir) !== '+', 'it lies on a floor tile, not in a doorway');
  assert.ok(Math.abs(it.x - (bx0 + 0.8)) < 0.05 && Math.abs(it.z - bz0) < 0.05, 'about 0.8 m in front of Bob');
  // Carol arrives late and picks it up; when she leaves, it falls to the floor again for Bob
  const c = player('Carol');
  await once(c, 'welcome');
  c.emit('dev:tp', { x: it.x + 0.5, z: it.z });
  await sleep(60);
  c.emit('pickup', { id: it.id });
  assert.equal((await until(c, 'me', (m) => m.carrying != null)).carrying, 'fuse', 'someone else picks the fuse up');
  const left = until(b, 'feed', (f) => /^Carol dropped the fuse/.test(f.text));
  c.disconnect();
  await left;
  b.emit('dev:where');
  const again = (await once(b, 'dev:where')).loose.find((l) => l.item === 'fuse');
  b.emit('dev:tp', { x: again.x, z: again.z + 0.5 });
  await sleep(60);
  b.emit('pickup', { id: again.id });
  assert.equal((await until(b, 'me', (m) => m.carrying != null)).carrying, 'fuse', 'Bob picks the fuse up again');
  console.log('ok: G drops what you carry, and someone else can pick it up');

  // candy: scattered on clear floor (never the guest bedrooms or a doorway); walking onto one picks it up
  b.emit('dev:where');
  const sweets = (await once(b, 'dev:where')).candy;
  assert.ok(sweets.length >= 30, 'plenty of candy at the start');
  for (const c of sweets) {
    const [cc, cr] = L.tileOf(c.x, c.z);
    assert.ok(L.floorTile(cc, cr) && !['d', '+'].includes(L.at(cc, cr)), 'candy lies on floor outside the bedrooms and doorways');
  }
  const sweet = sweets[0];
  const gone = until(host, 'candy-', (id) => id === sweet.id);
  const yum = until(b, 'yum', (m) => m.id === sweet.id);
  b.emit('dev:tp', { x: sweet.x + 2, z: sweet.z });
  await sleep(60);
  b.emit('state', { x: sweet.x + 0.4, z: sweet.z, yaw: 0, moving: true });
  const ate = await yum;
  assert.ok(ate.candy >= 1, 'the candy count goes up');
  await gone;
  b.emit('dev:where');
  assert.ok(!(await once(b, 'dev:where')).candy.some((c) => c.id === sweet.id), 'the candy is gone from the floor');
  console.log('ok: walking onto candy picks it up');
  b.emit('dev:tp', { x: L.FUSEBOX.x, z: L.FUSEBOX.z + 0.8 });
  await sleep(60);
  b.emit('use', { what: 'fusebox' });
  assert.equal((await stage()).stage, 'desk');
  b.emit('dev:where');
  assert.notEqual((await once(b, 'dev:where')).monsters.find((m) => m.kind === 'creature').state, 'asleep', 'the power wakes him');
  await take('brass');
  b.emit('dev:tp', { x: L.OFFICE_DESK.x - 1.2, z: L.OFFICE_DESK.z });
  await sleep(60);
  b.emit('use', { what: 'desk' });
  const st = await stage();
  assert.equal(st.stage, 'keys');
  assert.equal(st.keyRooms.length, 3);
  // the keys appear now, one in each room the note names
  b.emit('dev:where');
  w = await once(b, 'dev:where');
  const keyBoxes = w.boxes.filter(([, it]) => /^key/.test(it));
  assert.equal(keyBoxes.length, 3, 'three iron keys after the desk');
  assert.deepEqual(keyBoxes.map(([id]) => L.PROPS[id].room).sort(), [...st.keyRooms].sort(), 'the keys are in exactly the rooms on the note');
  assert.equal(new Set(st.keyRooms).size, 3, 'three different rooms');
  for (const k of ['key1', 'key2', 'key3']) {
    assert.ok(st.keyRooms.includes(box(k).room), 'the note names the room of ' + k);
    await take(k);
    b.emit('dev:tp', { x: fx, z: fz - 1.5 });
    await sleep(60);
    b.emit('use', { what: 'front' });
    await stage();
  }
  // dawn comes while the door is open: the escape still gets its two minutes
  let ended = false;
  host.once('end', () => (ended = true));
  b.emit('dev:time', { t: C.DURATION.night + 5 });
  await sleep(400);
  assert.ok(!ended, 'dawn does not end the game during the escape');
  b.emit('dev:where');
  await once(b, 'dev:where');
  console.log('ok: dawn waits while the front door is open');
  // out through the door
  const end = once(host, 'end', 8000);
  b.emit('dev:tp', { x: fx, z: fz - 1 });
  await sleep(60);
  b.emit('state', { x: fx, z: L.ESCAPE_Z + 0.2, yaw: 0, moving: true });
  const r = await end;
  assert.equal(r.escaped, 1);
  assert.equal(r.list.find((p) => p.name === 'Bob').state, 'escaped');
  assert.equal(r.list.find((p) => p.name === 'Alice').state, 'dead');
  console.log('ok: fuse (the Monster wakes), desk, three padlocks, escape');
} catch (e) {
  failed = true;
  console.error('FAIL', e);
} finally {
  srv.kill();
  process.exit(failed ? 1 : 0);
}
