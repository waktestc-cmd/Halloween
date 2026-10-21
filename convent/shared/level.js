// Monster Manor: one floor of rooms around a gallery corridor and an open graveyard.
// Shared by the server (AI, line of sight, item placement) and the browser (3D build, map).
// The house is a grid of 2 m tiles. x grows east, z grows south; tile (c, r) has its centre at
// ((c + 0.5) * TILE, (r + 0.5) * TILE).

export const TILE = 2;
export const WALL_H = 3.4;
export const W = 33;
export const H = 25;

export const ROOMS = {
  d: { name: 'Guest bedrooms', c0: 1, r0: 1, c1: 7, r1: 4 },
  w: { name: 'Laundry', c0: 9, r0: 1, c1: 13, r1: 4 },
  s: { name: 'Schoolroom', c0: 15, r0: 1, c1: 21, r1: 4 },
  l: { name: 'Library', c0: 23, r0: 1, c1: 31, r1: 4 },
  k: { name: 'Kitchen', c0: 1, r0: 6, c1: 3, r1: 9 },
  i: { name: 'Surgery', c0: 29, r0: 6, c1: 31, r1: 9 },
  n: { name: 'Dining hall', c0: 1, r0: 11, c1: 3, r1: 17 },
  o: { name: "Count's study", c0: 29, r0: 11, c1: 31, r1: 17 },
  p: { name: 'Crypt', c0: 1, r0: 19, c1: 9, r1: 22 },
  e: { name: 'Entrance hall', c0: 11, r0: 19, c1: 17, r1: 22 },
  t: { name: 'Storeroom', c0: 19, r0: 19, c1: 25, r1: 22 },
  x: { name: 'Laboratory', c0: 27, r0: 19, c1: 31, r1: 22 },
  g: { name: 'Graveyard', c0: 8, r0: 9, c1: 24, r1: 14, outdoor: true },
};
const CORRIDOR = [
  [5, 6, 27, 7],
  [5, 16, 27, 17],
  [5, 8, 6, 15],
  [26, 8, 27, 15],
];
ROOMS.c = { name: 'Gallery', c0: 5, r0: 6, c1: 27, r1: 17 };

// doors: tile, and which rooms they join. 'front' is the way out.
export const DOORS = [
  { id: 'd', c: 5, r: 5 },
  { id: 'w', c: 11, r: 5 },
  { id: 's', c: 18, r: 5 },
  { id: 'l', c: 25, r: 5 },
  { id: 'k', c: 4, r: 7 },
  { id: 'kn', c: 2, r: 10 },
  { id: 'i', c: 28, r: 7 },
  { id: 'n', c: 4, r: 13 },
  { id: 'o', c: 28, r: 13 },
  { id: 'p', c: 6, r: 18 },
  { id: 'e', c: 14, r: 18 },
  { id: 't', c: 22, r: 18 },
  { id: 'x', c: 27, r: 18 },
  { id: 'gw', c: 7, r: 12, arch: true },
  { id: 'ge', c: 25, r: 12, arch: true },
  { id: 'front', c: 14, r: 23, front: true },
];

// grid characters: '#' wall, '+' door, a room letter for floor, ' ' outside
export const GRID = (() => {
  const g = Array.from({ length: H }, () => Array(W).fill('#'));
  for (const c of g[H - 1].keys()) g[H - 1][c] = ' ';
  for (const [k, rm] of Object.entries(ROOMS)) {
    if (k === 'c') continue;
    for (let r = rm.r0; r <= rm.r1; r++) for (let c = rm.c0; c <= rm.c1; c++) g[r][c] = k;
  }
  for (const [c0, r0, c1, r1] of CORRIDOR) for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) g[r][c] = 'c';
  for (const d of DOORS) g[d.r][d.c] = '+';
  return g;
})();

export const at = (c, r) => (r < 0 || c < 0 || r >= H || c >= W ? '#' : GRID[r][c]);
export const tileOf = (x, z) => [Math.floor(x / TILE), Math.floor(z / TILE)];
export const centre = (c, r) => [(c + 0.5) * TILE, (r + 0.5) * TILE];
export function roomAt(x, z) {
  const [c, r] = tileOf(x, z);
  const ch = at(c, r);
  if (ch === '+') {
    const d = DOORS.find((d) => d.c === c && d.r === r);
    return d && d.front ? 'e' : 'c';
  }
  return ROOMS[ch] ? ch : null;
}
// door orientation: 'x' when the door panel spans east-west (walls to its left and right)
export function doorAxis(d) {
  return at(d.c - 1, d.r) === '#' && at(d.c + 1, d.r) === '#' ? 'x' : 'z';
}

/* ---------- furniture ----------
   Each prop: type, room, and either wall (N/S/E/W, flush against it, at tile u along it) or a free
   position in tiles. Sizes are in metres (w across its front, d deep, h tall). */
export const PROP_TYPES = {
  bed: { w: 1.1, d: 2.1, h: 0.62, hide: 'Hide under the bed', solid: true },
  wardrobe: { w: 1.4, d: 0.7, h: 2.2, hide: 'Hide in the wardrobe', solid: true },
  dresser: { w: 1.3, d: 0.55, h: 0.95, box: 'Search the drawers', solid: true },
  table: { w: 1.9, d: 1.0, h: 0.78, solid: true },
  longtable: { w: 1.1, d: 5.2, h: 0.78, solid: true },
  shelf: { w: 1.9, d: 0.45, h: 2.3, box: 'Search the bookshelf', solid: true },
  desk: { w: 1.5, d: 0.75, h: 0.8, box: 'Search the desk', solid: true },
  cabinet: { w: 1.0, d: 0.5, h: 1.8, box: 'Open the cabinet', solid: true },
  stove: { w: 1.4, d: 0.75, h: 0.95, box: 'Open the oven', solid: true },
  sink: { w: 1.5, d: 0.6, h: 0.9, box: 'Look under the sink', solid: true },
  crate: { w: 0.9, d: 0.9, h: 0.85, box: 'Open the crate', solid: true },
  barrel: { w: 0.8, d: 0.8, h: 1.0, solid: true },
  pew: { w: 3.0, d: 0.6, h: 0.95, solid: true },
  altar: { w: 2.2, d: 0.9, h: 1.0, solid: true },
  boiler: { w: 1.8, d: 1.8, h: 2.6, solid: true },
  basket: { w: 0.8, d: 0.6, h: 0.6, box: 'Dig through the laundry', solid: true },
  tub: { w: 1.7, d: 0.8, h: 0.6, solid: true },
  curtain: { w: 1.2, d: 2.2, h: 2.1, hide: 'Hide behind the curtain', solid: true },
  chalkboard: { w: 3.2, d: 0.1, h: 1.4, wallH: 0.9, solid: false },
  bench: { w: 1.8, d: 0.5, h: 0.5, solid: true },
  well: { w: 1.8, d: 1.8, h: 1.0, solid: true },
  grave: { w: 0.7, d: 0.25, h: 0.9, solid: true },
  tree: { w: 0.7, d: 0.7, h: 4.5, solid: true },
  fusebox: { w: 0.7, d: 0.25, h: 0.9, wallH: 1.1, special: 'fusebox', solid: false },
  officedesk: { w: 1.8, d: 0.9, h: 0.8, special: 'desk', solid: true },
  painting: { w: 1.2, d: 0.06, h: 0.9, wallH: 1.5, solid: false },
  candles: { w: 0.5, d: 0.5, h: 1.3, solid: false },
  clock: { w: 0.6, d: 0.4, h: 2.15, solid: true },
  slab: { w: 1.0, d: 2.2, h: 0.85, solid: true },
  coil: { w: 0.6, d: 0.6, h: 2.0, solid: true, spark: true },
  // decoration only
  coffin: { w: 0.8, d: 2.0, h: 0.55, solid: true },
  crypt: { w: 2.4, d: 1.6, h: 2.6, solid: true },
  pumpkin: { w: 0.55, d: 0.55, h: 0.5, solid: true, glow: true },
  urn: { w: 0.5, d: 0.5, h: 0.9, solid: true },
  shovel: { w: 0.9, d: 0.7, h: 0.9, solid: false },
  fence: { w: 1.2, d: 0.15, h: 1.1, solid: false },
  rug: { w: 1.8, d: 2.6, h: 0.02, solid: false },
  coatrack: { w: 0.5, d: 0.5, h: 1.8, solid: true },
};

const P = (type, room, opts) => ({ type, room, ...opts });
const PROP_LIST = [
  // the guest bedrooms: where everyone wakes up
  P('bed', 'd', { wall: 'N', u: 1 }), P('bed', 'd', { wall: 'N', u: 2.6 }), P('bed', 'd', { wall: 'N', u: 4.2 }), P('bed', 'd', { wall: 'N', u: 5.8 }),
  P('bed', 'd', { wall: 'S', u: 1 }), P('bed', 'd', { wall: 'S', u: 2.6 }), P('bed', 'd', { wall: 'S', u: 7 }),
  P('wardrobe', 'd', { wall: 'E', u: 2.5 }), P('dresser', 'd', { wall: 'W', u: 2.5 }), P('painting', 'd', { wall: 'N', u: 7 }),
  // laundry
  P('tub', 'w', { wall: 'N', u: 10 }), P('tub', 'w', { wall: 'N', u: 12.5 }), P('basket', 'w', { wall: 'S', u: 9.5 }), P('basket', 'w', { wall: 'S', u: 13 }),
  P('wardrobe', 'w', { wall: 'W', u: 2.5 }), P('cabinet', 'w', { wall: 'E', u: 2 }),
  // schoolroom
  P('chalkboard', 's', { wall: 'N', u: 18 }), P('desk', 's', { at: [18, 1.6], face: 'S' }),
  P('table', 's', { at: [16.5, 3] }), P('table', 's', { at: [19.5, 3] }), P('table', 's', { at: [16.5, 4.2] }), P('table', 's', { at: [19.5, 4.2] }),
  P('cabinet', 's', { wall: 'E', u: 3 }), P('shelf', 's', { wall: 'W', u: 3 }),
  // library: tall shelves make aisles to slip through
  P('shelf', 'l', { wall: 'N', u: 24 }), P('shelf', 'l', { wall: 'N', u: 27 }), P('shelf', 'l', { wall: 'N', u: 30 }),
  P('shelf', 'l', { at: [26, 3], face: 'S' }), P('shelf', 'l', { at: [29, 3], face: 'S' }),
  P('desk', 'l', { at: [24, 3.2], face: 'E' }), P('wardrobe', 'l', { wall: 'E', u: 3 }),
  // kitchen
  P('stove', 'k', { wall: 'N', u: 1.5 }), P('sink', 'k', { wall: 'W', u: 8.5 }), P('cabinet', 'k', { wall: 'E', u: 9.1 }),
  P('table', 'k', { at: [2, 8], face: 'E' }), P('barrel', 'k', { at: [3.2, 6.2] }),
  // dining hall
  P('longtable', 'n', { at: [2, 14] }), P('cabinet', 'n', { wall: 'W', u: 11.5 }), P('dresser', 'n', { wall: 'W', u: 16.5 }), P('painting', 'n', { wall: 'W', u: 14 }),
  // surgery
  P('bed', 'i', { wall: 'E', u: 6.5 }), P('curtain', 'i', { wall: 'E', u: 8.5 }), P('cabinet', 'i', { wall: 'N', u: 29.5 }), P('cabinet', 'i', { wall: 'N', u: 31 }),
  P('desk', 'i', { wall: 'S', u: 30.5 }),
  // the Count's study
  P('officedesk', 'o', { at: [30, 13.2], face: 'W' }), P('shelf', 'o', { wall: 'E', u: 11.8 }), P('cabinet', 'o', { wall: 'E', u: 16.5 }),
  P('wardrobe', 'o', { wall: 'S', u: 30 }), P('painting', 'o', { wall: 'E', u: 14 }),
  // the crypt, where the Count sleeps: a stone tomb, rows of coffins, candles
  P('altar', 'p', { at: [2.0, 20.75], face: 'E' }), P('candles', 'p', { at: [1.4, 19.5] }), P('candles', 'p', { at: [1.4, 22] }),
  P('coffin', 'p', { at: [4.4, 20], face: 'E' }), P('coffin', 'p', { at: [4.4, 21.6], face: 'E' }),
  P('coffin', 'p', { at: [6.4, 20], face: 'E' }), P('coffin', 'p', { at: [6.4, 21.6], face: 'E' }),
  P('coffin', 'p', { at: [8.4, 20], face: 'E' }), P('coffin', 'p', { at: [8.4, 21.6], face: 'E' }),
  P('cabinet', 'p', { wall: 'E', u: 19.3 }),
  // entrance hall
  P('bench', 'e', { wall: 'W', u: 20.5 }), P('bench', 'e', { wall: 'E', u: 20.5 }), P('painting', 'e', { wall: 'N', u: 11.5 }),
  P('cabinet', 'e', { wall: 'E', u: 22.1 }), P('candles', 'e', { at: [11.2, 22.2] }),
  // storeroom
  P('crate', 't', { at: [19.3, 19.3] }), P('crate', 't', { at: [20.3, 19.3] }), P('crate', 't', { at: [19.3, 20.4] }), P('barrel', 't', { at: [25.15, 19.3] }),
  P('crate', 't', { at: [23.6, 22.2] }), P('crate', 't', { at: [24.7, 22.2] }), P('shelf', 't', { wall: 'S', u: 21 }), P('wardrobe', 't', { wall: 'E', u: 20.8 }),
  // the laboratory: the generator, the Doctor's slab, two crackling coils
  P('boiler', 'x', { at: [30.3, 20.5] }), P('slab', 'x', { at: [28.6, 21] }),
  P('coil', 'x', { at: [29.2, 19.4] }), P('coil', 'x', { at: [31.2, 19.4] }), P('crate', 'x', { at: [27.4, 22.2] }), P('cabinet', 'x', { wall: 'N', u: 28 }), P('barrel', 'x', { at: [31.15, 22.2] }),
  // the graveyard: gravestones and a well in the rain
  P('well', 'g', { at: [16, 11.5] }), P('tree', 'g', { at: [10, 10] }), P('tree', 'g', { at: [22.5, 13.5] }),
  P('grave', 'g', { at: [11, 13.2] }), P('grave', 'g', { at: [12.2, 13.2] }), P('grave', 'g', { at: [13.4, 13.2] }),
  P('grave', 'g', { at: [19.5, 9.8] }), P('grave', 'g', { at: [20.7, 9.8] }), P('bench', 'g', { at: [16, 13.8] }),
  // the gallery around the graveyard
  P('fusebox', 'c', { wall: 'N', u: 16, wallOf: 6 }),
  P('painting', 'c', { wall: 'N', u: 9, wallOf: 6 }), P('painting', 'c', { wall: 'S', u: 21, wallOf: 17 }),
  P('bench', 'c', { at: [12, 17.3], face: 'N' }),
  // a few candles left burning around the house (added last so the ids above stay the same)
  P('candles', 'd', { at: [7.2, 1.6] }), P('candles', 'n', { at: [3.2, 11.3] }), P('candles', 'l', { at: [23.2, 1.2] }),
  P('candles', 'o', { at: [29.2, 11.2] }), P('candles', 'i', { at: [29.2, 8.2] }),
  P('clock', 'e', { wall: 'N', u: 16.5 }),
  // more of the graveyard, and pumpkins someone carved for tonight
  P('coffin', 'g', { wall: 'S', u: 9.6 }), P('crypt', 'g', { wall: 'N', u: 23.5 }), P('urn', 'g', { at: [14.6, 13.2] }),
  P('shovel', 'g', { at: [18.4, 9.5] }), P('fence', 'g', { wall: 'N', u: 19.4 }), P('fence', 'g', { wall: 'N', u: 20.7 }),
  P('pumpkin', 'g', { at: [15, 13.9] }), P('pumpkin', 'g', { at: [17.1, 13.9] }),
  P('pumpkin', 'e', { at: [12.6, 22.3] }), P('pumpkin', 'e', { at: [15.4, 22.3] }),
  P('rug', 'd', { at: [4, 2.8] }), P('rug', 'o', { at: [29.6, 14.5] }), P('coatrack', 'e', { at: [11.3, 19.3] }),
];

// resolve every prop to a centre (x, z), a facing angle and an axis-aligned footprint
const FACE = { N: Math.PI, S: 0, E: Math.PI / 2, W: -Math.PI / 2 }; // rotation.y so the front faces that way
export const PROPS = PROP_LIST.map((p, id) => {
  const T = PROP_TYPES[p.type];
  const rm = ROOMS[p.room];
  let x;
  let z;
  let face = p.face || 'S';
  if (p.wall) {
    const gap = 0.04;
    // wallOf lets a corridor prop pick which corridor stretch it sits in
    if (p.wall === 'N') { z = (p.wallOf ?? rm.r0) * TILE + T.d / 2 + gap; x = (p.u + 0.5) * TILE; face = 'S'; }
    if (p.wall === 'S') { z = ((p.wallOf ?? rm.r1) + 1) * TILE - T.d / 2 - gap; x = (p.u + 0.5) * TILE; face = 'N'; }
    if (p.wall === 'W') { x = rm.c0 * TILE + T.d / 2 + gap; z = (p.u + 0.5) * TILE; face = 'E'; }
    if (p.wall === 'E') { x = (rm.c1 + 1) * TILE - T.d / 2 - gap; z = (p.u + 0.5) * TILE; face = 'W'; }
  } else {
    x = (p.at[0] + 0.5) * TILE;
    z = (p.at[1] + 0.5) * TILE;
  }
  const across = face === 'N' || face === 'S';
  const hw = (across ? T.w : T.d) / 2;
  const hd = (across ? T.d : T.w) / 2;
  return { id, type: p.type, room: p.room, x, z, face, rot: FACE[face], hw, hd, ...T };
});

export const SPAWN = { room: 'd', x: 4.5 * TILE, z: 2.9 * TILE, yaw: Math.PI };
export const FUSEBOX = PROPS.find((p) => p.special === 'fusebox');
export const OFFICE_DESK = PROPS.find((p) => p.special === 'desk');
export const FRONT = DOORS.find((d) => d.front);
// you are out once you are past the front door
export const ESCAPE_Z = (FRONT.r + 0.9) * TILE;

// where things can be hidden: every searchable prop
export const BOXES = PROPS.filter((p) => p.box);
export const HIDES = PROPS.filter((p) => p.hide);

/* ---------- walking ---------- */
// a tile you can stand in (doors are judged separately, by whether they are open)
export const floorTile = (c, r) => {
  const ch = at(c, r);
  return ch !== '#' && ch !== ' ';
};
// tiles blocked for the monsters' route finding because furniture fills them
export const BLOCKED = (() => {
  const b = new Set();
  for (const p of PROPS) {
    if (!p.solid || p.type === 'grave' || p.type === 'candles' || p.type === 'chalkboard' || p.type === 'pumpkin' || p.type === 'urn') continue;
    const [c, r] = tileOf(p.x, p.z);
    // only a prop that covers most of the tile blocks it
    if (p.hw * 2 * p.hd * 2 >= TILE * TILE * 0.3) b.add(c + ',' + r);
  }
  return b;
})();

// line of sight across the grid: walls and closed doors block it
export function clearLine(x0, z0, x1, z1, doorOpen) {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  const steps = Math.ceil(len / (TILE * 0.25));
  for (let i = 1; i < steps; i++) {
    const x = x0 + (dx * i) / steps;
    const z = z0 + (dz * i) / steps;
    const [c, r] = tileOf(x, z);
    const ch = at(c, r);
    if (ch === '#' || ch === ' ') return false;
    if (ch === '+') {
      const d = DOORS.find((d) => d.c === c && d.r === r);
      if (d && !d.arch && !doorOpen(d.id)) return false;
    }
  }
  return true;
}
