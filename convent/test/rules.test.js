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
const once = (s, ev, ms = 8000) => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('timeout waiting for ' + ev)), ms);
  s.once(ev, (m) => (clearTimeout(t), res(m)));
});
function player(name) {
  const s = io(URL, { transports: ['websocket'], forceNew: true });
  s.emit('join', { name, look: 1 });
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
  const a = player('Alice');
  const b = player('Bob');
  await Promise.all([once(a, 'welcome'), once(b, 'welcome')]);
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
