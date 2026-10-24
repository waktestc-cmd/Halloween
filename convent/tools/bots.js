// Fake players for testing: they join, wander the house along the corridors, open things, and
// sometimes run. Usage: node tools/bots.js 20 --url http://localhost:3000
// --testers names them all "tester", so they never run out of lives (for a long load test)
import { io } from 'socket.io-client';
import * as L from '../shared/level.js';

const n = Number(process.argv[2]) || 10;
const url = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : 'http://localhost:3000';
const testers = process.argv.includes('--testers');
const NAMES = ['Margaret', 'Raj', 'Linda', 'Tom', 'Priya', 'George', 'Helen', 'Sam', 'Ada', 'Frank', 'Joan', 'Ken', 'Rosa', 'Bill', 'Mei', 'Carl', 'Dot', 'Ivan', 'Nell', 'Omar', 'Pat', 'Ruth', 'Stan', 'Vera', 'Walt'];
const tiles = [];
for (let r = 0; r < L.H; r++) for (let c = 0; c < L.W; c++) if (L.floorTile(c, r) && L.at(c, r) !== '+' && !L.BLOCKED.has(c + ',' + r)) tiles.push([c, r]);
const key = (c, r) => c + ',' + r;
function route(from, to) {
  const prev = new Map([[key(...from), null]]);
  const q = [from];
  while (q.length) {
    const [c, r] = q.shift();
    if (c === to[0] && r === to[1]) break;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc;
      const nr = r + dr;
      if (prev.has(key(nc, nr)) || !L.floorTile(nc, nr) || L.BLOCKED.has(key(nc, nr))) continue;
      const d = L.DOORS.find((d) => d.c === nc && d.r === nr);
      if (d && d.front) continue;
      prev.set(key(nc, nr), [c, r]);
      q.push([nc, nr]);
    }
  }
  const path = [];
  for (let p = to; p && prev.has(key(...p)); p = prev.get(key(...p))) path.unshift(L.centre(...p));
  return path;
}

for (let i = 0; i < n; i++) {
  const s = io(url, { transports: ['websocket'] });
  const me = { x: L.SPAWN.x, z: L.SPAWN.z, yaw: 0, path: [], run: false, doors: {} };
  s.on('connect', () => s.emit('join', { name: testers ? 'tester' : NAMES[i % NAMES.length] + (i >= NAMES.length ? ' ' + i : ''), look: i % 8 }));
  s.on('welcome', (m) => m.me && Object.assign(me, { x: m.me.x, z: m.me.z }));
  s.on('start', () => (me.path = []));
  s.on('placed', (m) => Object.assign(me, { x: m.x, z: m.z, path: [] }));
  s.on('me', (m) => {
    if (m.state !== 'alive') me.dead = true;
  });
  s.on('hit', (m) => Object.assign(me, { x: m.x, z: m.z, path: [] }));
  s.on('doors', (d) => (me.doors = d));
  setInterval(() => {
    if (me.dead) return;
    if (!me.path.length) {
      const goal = tiles[Math.floor(Math.random() * tiles.length)];
      me.path = route(L.tileOf(me.x, me.z), goal);
      me.run = Math.random() < 0.2;
      if (!me.path.length) return;
    }
    const [tx, tz] = me.path[0];
    const dx = tx - me.x;
    const dz = tz - me.z;
    const d = Math.hypot(dx, dz);
    const step = (me.run ? 5 : 3) * 0.1;
    if (d < step) {
      me.x = tx;
      me.z = tz;
      me.path.shift();
      // open a closed door on the way
      const [c, r] = L.tileOf(tx, tz);
      for (const dd of L.DOORS) if (Math.abs(dd.c - c) + Math.abs(dd.r - r) === 1 && !me.doors[dd.id] && !dd.arch && !dd.front) s.emit('door', { id: dd.id });
    } else {
      me.x += (dx / d) * step;
      me.z += (dz / d) * step;
      me.yaw = Math.atan2(-dx, -dz);
    }
    s.emit('state', { x: me.x, z: me.z, yaw: me.yaw, run: me.run, moving: true, light: true });
    if (Math.random() < 0.01) {
      const b = L.BOXES.find((b) => Math.hypot(b.x - me.x, b.z - me.z) < 2.5);
      if (b) s.emit('search', { prop: b.id });
    }
  }, 100);
}
console.log(`${n} bots joining ${url}`);
