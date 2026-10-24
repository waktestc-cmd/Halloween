// Everyone who moves through the house: other players (in costume), the monsters and the ghosts.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LOOKS } from '/shared/config.js';
import { characters, findClip } from './models.js';
import { countTextures, bruteTextures, COUNT_UV, BRUTE_UV } from './textures.js';

/* ---------- players ----------
   The figure comes from models.json ("player"), or the three.js Soldier when none is listed. With
   several files listed, each player gets one of them. */
const soldier = () =>
  new GLTFLoader().loadAsync('/assets/models/Soldier.glb').then((g) => ({ scene: g.scene, animations: g.animations, scale: 1, spec: { turn: 180, tint: 'VanguardBodyMat', tintBoost: 2.2 } }));
const cast = characters('player');
// the figure for one player: one of the listed files, picked from their id so it stays the same
// the costume they picked on the join screen, or one picked from their id when there is none
async function figureFor(info) {
  const c = await cast;
  const i = Number.isInteger(info.costume) ? info.costume : hash(info.id || info.name);
  return (c.count && (await c.get(i))) || soldier();
}
const hash = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

function label(text) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d');
  g.font = '600 30px Georgia, serif';
  g.textAlign = 'center';
  g.fillStyle = 'rgba(0,0,0,0.55)';
  const w = Math.min(250, g.measureText(text).width + 24);
  g.fillRect(128 - w / 2, 8, w, 44);
  g.fillStyle = '#e8dcc0';
  g.fillText(text, 128, 41);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: true, transparent: true }));
  s.scale.set(1.1, 0.275, 1);
  return s;
}

export class Avatar {
  constructor(scene, info) {
    this.root = new THREE.Group();
    this.scene = scene;
    this.info = info;
    this.x = this.tx = info.x || 0;
    this.z = this.tz = info.z || 0;
    this.yaw = this.tyaw = 0;
    this.anim = 0;
    this.tag = label(info.name);
    this.tag.position.y = 2.05;
    this.root.add(this.tag);
    // a beam you can see when their flashlight is on
    const beam = new THREE.Mesh(
      new THREE.ConeGeometry(0.7, 5, 20, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffe2a8, transparent: true, opacity: 0.025, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    );
    beam.rotation.x = -Math.PI / 2;
    beam.position.set(0.2, 1.3, 2.6);
    this.beam = beam;
    this.root.add(beam);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe8b0 }));
    bulb.position.set(0.2, 1.3, 0.3);
    this.bulb = bulb;
    this.root.add(bulb);
    scene.add(this.root);
    figureFor(info).then((f) => this.dress(f)).catch((e) => console.warn('no figure', e));
  }
  dress(f) {
    if (!f || this.body || this.gone) return;
    const spec = f.spec;
    this.body = SkeletonUtils.clone(f.scene);
    const tint = new THREE.Color(LOOKS[this.info.look || 0]);
    const tintNames = [].concat(spec.tint || []);
    this.meshes = [];
    this.body.traverse((o) => {
      if (o.isMesh) {
        this.meshes.push(o);
        o.castShadow = true;
        if (tintNames.some((n) => (o.material.name || '').includes(n))) {
          o.material = o.material.clone();
          o.material.color.copy(tint).multiplyScalar(spec.tintBoost ?? 1);
        }
      }
    });
    this.body.scale.setScalar(f.scale);
    this.body.rotation.y = THREE.MathUtils.degToRad(spec.turn || 0);
    this.root.add(this.body);
    this.mixer = new THREE.AnimationMixer(this.body);
    const idle = findClip(f.animations, spec.idle || 'idle');
    const walk = findClip(f.animations, spec.walk || 'walk') || idle;
    const run = findClip(f.animations, spec.run || ['run', 'jog']) || walk;
    this.actions = [idle, walk, run].map((c) => (c ? this.mixer.clipAction(c) : null));
    for (const a of this.actions) {
      if (!a) continue;
      a.play();
      a.setEffectiveWeight(0);
    }
    this.actions[0]?.setEffectiveWeight(1);
    this.weights = [1, 0, 0];
  }
  set(x, z, yaw, anim, light, state) {
    this.tx = x;
    this.tz = z;
    this.tyaw = yaw;
    this.anim = anim;
    this.beam.visible = this.bulb.visible = !!light && state === 1;
    this.present = state === 1;
  }
  update(dt, far = 0) {
    const k = Math.min(1, dt * 8);
    this.x += (this.tx - this.x) * k;
    this.z += (this.tz - this.z) * k;
    let d = this.tyaw - this.yaw;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    this.yaw += d * k;
    this.root.position.set(this.x, 0, this.z);
    // the figure faces where the player looks: yaw 0 looks toward -z
    this.root.rotation.y = this.yaw + Math.PI;
    this.root.visible = this.present && this.inView !== false;
    if (this.mixer && this.root.visible) {
      for (let i = 0; i < 3; i++) {
        this.weights[i] += ((i === this.anim ? 1 : 0) - this.weights[i]) * Math.min(1, dt * 6);
        this.actions[i]?.setEffectiveWeight(this.weights[i]);
      }
      // only people near you cast shadows
      const shadow = far < 10;
      if (shadow !== this.shadow) {
        this.shadow = shadow;
        for (const m of this.meshes) m.castShadow = shadow;
      }
      // people far away move their legs less often: nobody can tell, and it saves time
      this.skip = (this.skip || 0) + dt;
      if (far < 12 || this.skip > 0.1) {
        this.mixer.update(this.skip);
        this.skip = 0;
      }
    }
  }
  remove() {
    this.gone = true;
    this.scene.remove(this.root);
  }
}

/* ---------- the monsters ----------
   The server says where each one is; here they glide or stomp toward that, and are drawn.
   update() returns how far it moved this frame, which drives footsteps and sounds.

   The Count and the Doctor's Monster are built here in code: tubes swept along curves (arms, fingers,
   claws, ears, hair), stacks of rings (coats), and spheres pushed into the shape of a head, hung on a
   few bones so they can move. Every part made of one material is merged into a single skinned mesh,
   so each of them costs two draw calls: skin and clothes, both painted in textures.js. */
const smooth01 = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const bell = (x, m, s) => Math.exp(-((x - m) ** 2) / (2 * s * s));
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const toV = (p) => (p.isVector3 ? p.clone() : V(...p));

// normals that stay smooth across the seams where a sphere or tube wraps round
function smoothNormals(geo) {
  geo.computeVertexNormals();
  const p = geo.attributes.position;
  const n = geo.attributes.normal;
  const same = new Map();
  for (let i = 0; i < p.count; i++) {
    const k = `${Math.round(p.getX(i) * 2e4)},${Math.round(p.getY(i) * 2e4)},${Math.round(p.getZ(i) * 2e4)}`;
    let e = same.get(k);
    if (!e) same.set(k, (e = { n: V(0, 0, 0), ids: [] }));
    e.n.x += n.getX(i);
    e.n.y += n.getY(i);
    e.n.z += n.getZ(i);
    e.ids.push(i);
  }
  for (const e of same.values()) {
    if (e.ids.length < 2) continue;
    e.n.normalize();
    for (const i of e.ids) n.setXYZ(i, e.n.x, e.n.y, e.n.z);
  }
  return geo;
}
function indexed(pos, uv, idx) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return smoothNormals(g);
}
// a tube along a smooth curve whose radius changes along it (radius(t), t from 0 to 1). flat < 1
// squashes it across `up`, so it can be a blade: an ear, a claw, a lock of hair.
function sweep(points, radius, { seg = 10, rad = 8, flat = 1, up = [0, 0, 1], caps = [true, true] } = {}) {
  const curve = new THREE.CatmullRomCurve3(points.map(toV));
  const U = V(...up).normalize();
  const S = V(0, 0, 0);
  const N = V(0, 0, 0);
  const pos = [];
  const uv = [];
  const idx = [];
  const ring = (t) => {
    const c = curve.getPointAt(t);
    const T = curve.getTangentAt(t);
    S.crossVectors(T, U);
    if (S.lengthSq() < 1e-8) S.crossVectors(T, V(1, 0, 0));
    S.normalize();
    N.crossVectors(S, T).normalize();
    return { c, T, r: typeof radius === 'function' ? radius(t) : radius };
  };
  const rings = [];
  for (let i = 0; i <= seg; i++) {
    const { c, r } = ring(i / seg);
    for (let j = 0; j <= rad; j++) {
      const a = (j / rad) * Math.PI * 2;
      const ca = Math.cos(a) * r;
      const sa = Math.sin(a) * r * flat;
      pos.push(c.x + S.x * ca + N.x * sa, c.y + S.y * ca + N.y * sa, c.z + S.z * ca + N.z * sa);
      uv.push(j / rad, i / seg);
    }
    rings.push(c);
  }
  for (let i = 0; i < seg; i++)
    for (let j = 0; j < rad; j++) {
      const a = i * (rad + 1) + j;
      const b = a + rad + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  // close the ends that have some thickness
  for (const [end, i] of [[0, 0], [1, seg]]) {
    if (!caps[end] || (typeof radius === 'function' ? radius(end) : radius) < 1e-4) continue;
    const c = rings[i];
    const k = pos.length / 3;
    pos.push(c.x, c.y, c.z);
    uv.push(0.5, end);
    for (let j = 0; j < rad; j++) {
      const a = i * (rad + 1) + j;
      if (end === 0) idx.push(k, a, a + 1);
      else idx.push(k, a + 1, a);
    }
  }
  return indexed(pos, uv, idx);
}
// rings stacked up the body: levels are [y, half-width, half-depth, z offset]. bump(a, y) widens a
// ring at angle a (0 is the front) for folds; arc leaves a gap at the front (a collar).
function loft(levels, { rad = 32, arc = [0, 1], bump = null, hem = null } = {}) {
  const pos = [];
  const uv = [];
  const idx = [];
  const y0 = levels[0][0];
  const y1 = levels[levels.length - 1][0];
  for (const [i, [y, rx, rz, cz = 0]] of levels.entries()) {
    for (let j = 0; j <= rad; j++) {
      const f = arc[0] + ((arc[1] - arc[0]) * j) / rad;
      const a = f * Math.PI * 2;
      const k = bump ? bump(a, y) : 1;
      pos.push(Math.sin(a) * rx * k, y + (i === 0 && hem ? hem(a) : 0), cz + Math.cos(a) * rz * k);
      uv.push(f, (y - y0) / (y1 - y0));
    }
  }
  for (let i = 0; i < levels.length - 1; i++)
    for (let j = 0; j < rad; j++) {
      const a = i * (rad + 1) + j;
      const b = a + rad + 1;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  return indexed(pos, uv, idx);
}
// the point on a loft's surface at angle a and height y
function loftAt(levels, a, y, bump) {
  let i = 0;
  while (i < levels.length - 2 && levels[i + 1][0] < y) i++;
  const [ya, ra, da, za = 0] = levels[i];
  const [yb, rb, db, zb = 0] = levels[i + 1];
  const t = Math.min(1, Math.max(0, (y - ya) / (yb - ya)));
  const k = bump ? bump(a, y) : 1;
  return V(Math.sin(a) * (ra + (rb - ra) * t) * k, y, za + (zb - za) * t + Math.cos(a) * (da + (db - da) * t) * k);
}
// a sphere pushed into shape: shape(direction) gives where that point of the sphere goes. Faces are
// painted on the sphere's own uv, so a feature painted at a direction lands where shape() put it.
function sculpt(shape, { w = 32, h = 24, phi = [0, Math.PI * 2], theta = [0, Math.PI] } = {}) {
  const g = new THREE.SphereGeometry(1, w, h, phi[0], phi[1], theta[0], theta[1]);
  const p = g.attributes.position;
  const d = V(0, 0, 0);
  for (let i = 0; i < p.count; i++) {
    d.fromBufferAttribute(p, i).normalize();
    const q = shape(d);
    p.setXYZ(i, q.x, q.y, q.z);
  }
  return smoothNormals(g);
}
const blob = (rx, ry, rz, w = 10, h = 7) => new THREE.SphereGeometry(1, w, h).scale(rx, ry, rz);
// skin weights that hand over from one bone to the next going up: stops are [[y, bone], ...]
const byY = (stops) => (v) => {
  if (v.y <= stops[0][0]) return [[stops[0][1], 1]];
  for (let i = 0; i < stops.length - 1; i++) {
    const [ya, a] = stops[i];
    const [yb, b] = stops[i + 1];
    if (v.y <= yb) {
      const t = smooth01(ya, yb, v.y);
      return [[a, 1 - t], [b, t]];
    }
  }
  return [[stops[stops.length - 1][1], 1]];
};

// a skeleton under construction, and the parts that hang on it
class Rig {
  constructor() {
    this.bones = [];
    this.parts = new Map(); // material -> geometries
  }
  // a bone at (x, y, z) in the figure's own space (it stands at the origin, facing +z)
  bone(x, y, z, parent = null) {
    const b = new THREE.Bone();
    b.userData.at = V(x, y, z);
    b.position.set(x, y, z);
    if (parent != null) {
      b.position.sub(this.bones[parent].userData.at);
      this.bones[parent].add(b);
    }
    this.bones.push(b);
    return this.bones.length - 1;
  }
  // geo: built in the figure's space (or moved there by `at`); skin: a bone, or v => [[bone, weight], ...];
  // region: which patch of the material's painted sheet it shows
  add(geo, mat, skin, region, at) {
    if (!geo.index) geo.setIndex([...Array(geo.attributes.position.count).keys()]);
    for (const n of Object.keys(geo.attributes)) if (n !== 'position' && n !== 'normal' && n !== 'uv') geo.deleteAttribute(n);
    if (at) geo.translate(...at);
    const n = geo.attributes.position.count;
    if (region) {
      const uv = geo.attributes.uv;
      const [u0, v0, u1, v1] = region;
      for (let i = 0; i < n; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
    }
    const si = new Uint16Array(n * 4);
    const sw = new Float32Array(n * 4);
    const v = V(0, 0, 0);
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(geo.attributes.position, i);
      const ws = typeof skin === 'number' ? [[skin, 1]] : skin(v).filter(([, w]) => w > 0.001);
      const sum = ws.reduce((s, [, w]) => s + w, 0) || 1;
      ws.slice(0, 4).forEach(([b, w], k) => {
        si[i * 4 + k] = b;
        sw[i * 4 + k] = w / sum;
      });
    }
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    if (!this.parts.has(mat)) this.parts.set(mat, []);
    this.parts.get(mat).push(geo);
  }
  // hang the bones and one skinned mesh per material on `parent` (which must be at the origin, unturned)
  build(parent, sphere) {
    parent.add(this.bones[0]);
    parent.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton(this.bones);
    this.meshes = [];
    for (const [mat, geos] of this.parts) {
      const m = new THREE.SkinnedMesh(mergeGeometries(geos), mat);
      for (const g of geos) g.dispose();
      m.castShadow = true;
      parent.add(m);
      m.bind(skeleton);
      // it moves about, so it is culled by a ball big enough for any pose
      m.boundingSphere = sphere.clone();
      this.meshes.push(m);
    }
    return this.bones;
  }
}
// turn a bone toward a pose, a little each frame
function ease(bone, x, y, z, k) {
  bone.rotation.x += (x - bone.rotation.x) * k;
  bone.rotation.y += (y - bone.rotation.y) * k;
  bone.rotation.z += (z - bone.rotation.z) * k;
}
/* A long, bony hand with four fingers and a thumb hanging from the wrist bone, palm toward the body.
   o: at (the wrist), palm [rx, ry, rz], lens (the four fingers), r0/r1 (finger thickness at the
   knuckle and the tip), knob (how much the knuckles stand out), curl, spread, claw (region or null). */
function hand(rig, mat, region, sx, wr, fi, o) {
  const [wx, wy, wz] = o.at;
  const [prx, pry, prz] = o.palm;
  rig.add(blob(prx, pry, prz), mat, wr, region, [wx, wy - pry * 0.8, wz]);
  const ky = wy - pry * 1.55;
  const c = -sx; // toward the palm
  const r = (t) => o.r0 + (o.r1 - o.r0) * t + o.knob * (bell(t, 0.02, 0.08) + bell(t, 0.37, 0.07) + 0.8 * bell(t, 0.7, 0.065));
  const finger = (k, dirs, L, skin, root) => {
    const pts = [k, ...dirs.map(([dx, dy, dz]) => k.clone().add(V(c * dx * L, dy * L, dz * L)))];
    rig.add(sweep(pts, (t) => r(t) * (root ?? 1), { seg: 7, rad: 6, flat: 0.85, up: [1, 0, 0], caps: [false, !o.claw] }), mat, skin, region);
    if (!o.claw) return;
    const tip = pts[pts.length - 1];
    const T = tip.clone().sub(pts[pts.length - 2]).normalize();
    const cl = [tip.clone().sub(T.clone().multiplyScalar(0.006)), tip.clone().add(T.clone().multiplyScalar(0.016)).add(V(c * 0.004, 0, 0)), tip.clone().add(T.clone().multiplyScalar(0.032)).add(V(c * 0.014, 0, 0))];
    rig.add(sweep(cl, (t) => o.r1 * 0.95 * (1 - t) ** 1.1, { seg: 4, rad: 5, flat: 0.55, up: [1, 0, 0], caps: [true, false] }), mat, typeof skin === 'number' ? skin : fi, o.claw);
  };
  for (let f = 0; f < 4; f++) {
    const z = wz + o.spread * (1.5 - f);
    const k = V(wx + c * prx * 0.15, ky, z);
    const fz = (z - wz) / (o.spread * 1.5);
    finger(k, [[o.curl * 0.12, -0.36, fz * 0.04], [o.curl * 0.42, -0.7, fz * 0.08], [o.curl, -1, fz * 0.1]], o.lens[f], byY([[ky - 0.014, fi], [ky + 0.01, wr]]));
  }
  // the thumb, on the front edge of the palm
  const tk = V(wx + c * prx * 0.5, wy - pry * 0.75, wz + prz * 0.85);
  finger(tk, [[0.08, -0.38, 0.14], [0.3, -0.72, 0.2], [0.5, -0.95, 0.2]], o.lens[0] * 0.72, wr, 1.12);
}

class Monster {
  constructor(scene, kind) {
    this.kind = kind;
    this.root = new THREE.Group();
    this.x = this.tx = 0;
    this.z = this.tz = 0;
    this.yaw = this.tyaw = 0;
    this.state = 'patrol';
    this.t = Math.random() * 10;
    scene.add(this.root);
  }
  set(x, z, yaw, state) {
    this.tx = x;
    this.tz = z;
    this.tyaw = yaw;
    this.state = state;
  }
  get hunting() {
    return this.state === 'chase' || this.state === 'finale';
  }
  remove() {
    this.gone = true;
    this.root.parent?.remove(this.root);
  }
  // move toward where the server says; returns how far it went
  follow(dt) {
    this.t += dt;
    const k = Math.min(1, dt * 7);
    const moved = Math.hypot(this.tx - this.x, this.tz - this.z) * k;
    this.x += (this.tx - this.x) * k;
    this.z += (this.tz - this.z) * k;
    let d = this.tyaw - this.yaw;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    this.yaw += d * k;
    this.speed = (this.speed || 0) + ((dt > 0 ? moved / dt : 0) - (this.speed || 0)) * Math.min(1, dt * 4);
    this.root.position.set(this.x, 0, this.z);
    this.root.rotation.y = this.yaw;
    return moved;
  }
}

/* The Count, after the 1922 Nosferatu: very tall, thin and hunched in a long black coat buttoned
   twice down the front, with a high stiff collar. A bald, domed head, pointed bat's ears, deep dark
   sockets with eyes that glow, a hooked nose and two rat's teeth. Long arms, bony fingers with swollen
   knuckles and long claws, held up before him as he glides. He hides his face from your flashlight. */
let countMats;
function countMaterials() {
  if (!countMats) {
    const t = countTextures();
    countMats = {
      skin: new THREE.MeshStandardMaterial({ map: t.skin, color: 0xa0a0a0, emissiveMap: t.glow, emissive: 0xffffff, emissiveIntensity: 1, roughness: 0.7 }),
      cloth: new THREE.MeshStandardMaterial({ map: t.cloth, color: 0x909090, roughness: 0.95, side: THREE.DoubleSide }),
    };
  }
  return countMats;
}
// his head, around its centre, facing +z: a tall dome swept back, deep sockets, sunken temples and
// cheeks, a narrow pointed jaw and a muzzle like a rat's
function countHead(d) {
  const { x, y, z } = d;
  const p = V(x * 0.098, y * 0.13, z * 0.112);
  if (y > 0) {
    p.y += 0.045 * y * y;
    p.z -= 0.03 * y * y;
  }
  p.z -= 0.022 * bell(y, 0.3, 0.35) * Math.max(0, -z);
  if (y < -0.15) p.x *= 1 - 0.5 * ((-y - 0.15) / 0.85);
  const near = (cx, cy, cz, s) => Math.exp(-((x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2) / (2 * s * s));
  let r = 0.013 * near(0, -0.5, 0.86, 0.15) + 0.004 * near(0, -0.92, 0.38, 0.12);
  for (const sx of [-1, 1]) {
    r -= 0.02 * near(sx * 0.33, 0.06, 0.94, 0.12);
    r += 0.01 * near(sx * 0.3, 0.25, 0.92, 0.1);
    r -= 0.014 * near(sx * 0.62, -0.35, 0.68, 0.17);
    r -= 0.009 * near(sx * 0.85, 0.25, 0.45, 0.17);
    r += 0.006 * near(sx * 0.5, -0.08, 0.85, 0.09);
  }
  const l = p.length();
  return p.multiplyScalar((l + r) / l);
}
const dirOf = (x, y, z) => V(x, y, z).normalize();
export class Vampire extends Monster {
  constructor(scene) {
    super(scene, 'vampire');
    const { skin, cloth } = countMaterials();
    const U = COUNT_UV;
    const rig = new Rig();
    const root = rig.bone(0, 0, 0);
    const spine = rig.bone(0, 0.95, 0, root);
    const chest = rig.bone(0, 1.38, -0.01, spine);
    const head = rig.bone(0, 1.72, 0.03, chest);
    const skirt = rig.bone(0, 0.95, 0, root);
    this.arm = {};
    for (const sx of [1, -1]) {
      const sh = rig.bone(sx * 0.17, 1.6, 0, chest);
      const el = rig.bone(sx * 0.185, 1.25, 0, sh);
      const wr = rig.bone(sx * 0.195, 0.935, 0, el);
      const fi = rig.bone(sx * 0.195, 0.855, 0, wr);
      this.arm[sx] = { sh, el, wr, fi };
    }
    // the coat, falling in folds to the floor; the back rounded by his hunch
    const coatLv = [
      [0.03, 0.31, 0.27, 0.015], [0.3, 0.275, 0.235, 0.005], [0.6, 0.24, 0.195, -0.005], [0.92, 0.205, 0.155, -0.01],
      [1.15, 0.205, 0.15, -0.015], [1.35, 0.21, 0.155, -0.025], [1.5, 0.205, 0.16, -0.04], [1.6, 0.19, 0.15, -0.035],
      [1.67, 0.13, 0.11, -0.01], [1.72, 0.065, 0.065, 0.02],
    ];
    const folds = (a, y) => {
      const front = Math.min(a, Math.PI * 2 - a);
      return 1 + 0.05 * Math.sin(a * 7 + 1.3) * smooth01(1.1, 0.2, y) + 0.025 * Math.sin(a * 13 + 0.4) * smooth01(0.8, 0.1, y) + 0.03 * bell(front, 0, 0.1) * smooth01(1.66, 1.5, y);
    };
    rig.add(loft(coatLv, { rad: 34, bump: folds }), cloth, byY([[0.75, skirt], [1.0, spine], [1.3, spine], [1.45, chest]]), U.coat);
    // two rows of buttons
    for (const a of [0.24, Math.PI * 2 - 0.24])
      for (let i = 0; i < 6; i++) {
        const y = 1.02 + i * 0.095;
        const p = loftAt(coatLv, a, y, folds);
        const b = blob(0.011, 0.011, 0.005, 8, 5);
        b.rotateY(a);
        rig.add(b, cloth, byY([[1.3, spine], [1.45, chest]]), U.button, [p.x * 1.02, p.y, p.z * 1.02]);
      }
    // the high, stiff collar standing up behind his head
    rig.add(loft([[1.6, 0.14, 0.12, -0.02], [1.7, 0.1, 0.095, 0], [1.82, 0.118, 0.112, 0.008], [1.92, 0.14, 0.13, 0]], { rad: 22, arc: [0.13, 0.87] }), cloth, chest, U.collar);
    // the pointed toes of his shoes, just showing under the hem
    for (const sx of [1, -1]) rig.add(sweep([[sx * 0.075, 0.035, 0.08], [sx * 0.08, 0.03, 0.22], [sx * 0.072, 0.022, 0.335]], (t) => 0.038 * (1 - t) + 0.006, { seg: 6, rad: 8, flat: 0.55, up: [0, 1, 0] }), cloth, root, U.shoe);
    // neck and head
    const C = V(0, 1.86, 0.065);
    rig.add(sweep([[0, 1.62, 0.0], [0, 1.72, 0.025], [0, 1.8, 0.05]], 0.036, { seg: 4, rad: 10, caps: [false, false] }), skin, byY([[1.69, chest], [1.75, head]]), U.skin);
    rig.add(sculpt(countHead, { w: 30, h: 22 }), skin, head, U.head, C.toArray());
    const at = (x, y, z) => countHead(dirOf(x, y, z)).add(C);
    for (const sx of [-1, 1]) {
      // eyes deep in their sockets
      const d = dirOf(sx * 0.33, 0.06, 0.94);
      const e = at(sx * 0.33, 0.06, 0.94).sub(d.multiplyScalar(0.004));
      rig.add(blob(0.0118, 0.0118, 0.0118, 10, 8), skin, head, U.eye, e.toArray());
      // the ears: long, pointed, bat-like, swept up and back
      const b = at(sx, -0.05, -0.08);
      rig.add(
        sweep([b.clone().add(V(-sx * 0.008, -0.035, 0.012)), b.clone().add(V(sx * 0.022, 0.015, -0.015)), b.clone().add(V(sx * 0.055, 0.075, -0.04)), b.clone().add(V(sx * 0.085, 0.145, -0.07))], (t) => 0.044 * (1 - t) ** 0.8 + 0.0015, { seg: 10, rad: 8, flat: 0.22, up: [sx, 0, 0.9] }),
        skin, head, U.ear,
      );
      // two long front teeth, like a rat's
      const m = at(0, -0.5, 0.86);
      rig.add(sweep([[m.x + sx * 0.0068, m.y + 0.006, m.z - 0.004], [m.x + sx * 0.0066, m.y - 0.012, m.z + 0.004], [m.x + sx * 0.006, m.y - 0.027, m.z + 0.007]], (t) => 0.0048 - 0.0018 * t, { seg: 4, rad: 6, flat: 0.55, up: [0, 0, 1] }), skin, head, U.tooth);
    }
    // a long hooked nose
    const n0 = at(0, 0.08, 1).sub(V(0, 0, 0.012));
    const n1 = at(0, -0.3, 0.95);
    rig.add(sweep([n0, V(0, (n0.y + n1.y) / 2, n1.z + 0.012), V(0, n1.y - 0.004, n1.z + 0.027), V(0, n1.y - 0.016, n1.z + 0.016)], (t) => 0.0075 + 0.0045 * bell(t, 0.78, 0.18), { seg: 9, rad: 8, flat: 0.75, up: [1, 0, 0], caps: [false, true] }), skin, head, U.skin);
    // long sleeves, bending at the elbow, and the long hands
    for (const sx of [1, -1]) {
      const { sh, el, wr, fi } = this.arm[sx];
      rig.add(sweep([[sx * 0.168, 1.655, 0], [sx * 0.177, 1.43, 0], [sx * 0.185, 1.25, 0], [sx * 0.19, 1.08, 0], [sx * 0.195, 0.955, 0]], (t) => 0.056 - 0.014 * t + 0.012 * bell(t, 1, 0.07), { seg: 14, rad: 10, caps: [true, false] }), cloth, byY([[1.19, el], [1.31, sh]]), U.sleeve);
      hand(rig, skin, U.skin, sx, wr, fi, { at: [sx * 0.195, 0.955, 0.004], palm: [0.017, 0.047, 0.036], lens: [0.135, 0.152, 0.143, 0.115], r0: 0.0072, r1: 0.0046, knob: 0.0017, curl: 0.038, spread: 0.0175, claw: U.nail });
    }
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.b = rig.build(this.body, new THREE.Sphere(V(0, 1.1, 0.1), 1.3));
    this.bone = { spine, chest, head, skirt };
    this.mat = skin;
  }
  update(dt) {
    const moved = this.follow(dt);
    const { b, bone, arm } = this;
    const s = this.state;
    const t = this.t;
    const hunting = this.hunting;
    const flinch = s === 'flinch';
    const looking = s === 'investigate' || s === 'search';
    const k = this.posed ? Math.min(1, dt * (flinch ? 10 : hunting ? 6 : 3.5)) : 1;
    this.posed = true;
    // he glides, bobbing a little, swaying more when he hunts
    const sway = Math.sin(t * (hunting ? 6 : 2.2));
    this.root.position.y = 0.012 + Math.abs(sway) * 0.022;
    this.root.rotation.z = sway * 0.02;
    if (flinch) {
      // turns his face away and shields it with his arms
      ease(b[bone.spine], -0.2, 0, 0, k);
      ease(b[bone.chest], -0.05, 0.3, 0, k);
      ease(b[bone.head], 0.55, 0.65, 0.25, k);
    } else if (hunting) {
      ease(b[bone.spine], 0.3, 0, 0, k);
      ease(b[bone.chest], 0.12, Math.sin(t * 3) * 0.06, 0, k);
      ease(b[bone.head], -0.42, Math.sin(t * 2.3) * 0.12, 0.12, k);
    } else if (s === 'gloat') {
      ease(b[bone.spine], 0.06, 0, 0, k);
      ease(b[bone.chest], 0.08, 0, 0, k);
      ease(b[bone.head], -0.12, 0, 0.28, k);
    } else {
      ease(b[bone.spine], looking ? 0.22 : 0.14, 0, 0, k);
      ease(b[bone.chest], 0.2, 0, 0, k);
      ease(b[bone.head], -0.18, looking ? Math.sin(t * 1.4) * 0.7 : Math.sin(t * 0.45) * 0.28, 0.06, k);
    }
    for (const sx of [1, -1]) {
      const { sh, el, wr, fi } = arm[sx];
      const i = sx > 0 ? 0 : 1;
      if (flinch) {
        // forearms crossed before his face
        ease(b[sh], -1.85 - i * 0.12, 0, -sx * 0.2, k);
        ease(b[el], -0.25, 0, -sx * (1.55 + i * 0.1), k);
        ease(b[wr], 0.35, 0, 0, k);
        ease(b[fi], 0, 0, -sx * 0.9, k);
      } else if (hunting) {
        // reaching for you, claws raised, spread and grasping
        ease(b[sh], -1.7 + Math.sin(t * 9 + i * 2) * 0.08, 0, sx * 0.2, k);
        ease(b[el], -0.3, 0, 0, k);
        ease(b[wr], -0.55, 0, 0, k);
        ease(b[fi], 0, 0, -sx * (0.25 + Math.sin(t * 11 + i) * 0.35), k);
      } else if (s === 'gloat') {
        ease(b[sh], -0.75, 0, sx * 0.45, k);
        ease(b[el], -1.1, 0, 0, k);
        ease(b[wr], 0.5, 0, 0, k);
        ease(b[fi], 0, 0, -sx * (0.3 + Math.sin(t * 5 + i) * 0.2), k);
      } else {
        // hands raised before his chest, the long fingers hanging down
        ease(b[sh], -0.4 + Math.sin(t * 1.1 + i) * 0.03, 0, -sx * 0.16, k);
        ease(b[el], -1.5, 0, 0, k);
        ease(b[wr], 1.05, 0, 0, k);
        ease(b[fi], 0, 0, -sx * (0.45 + Math.sin(t * 1.7 + i) * 0.06), k);
      }
    }
    // the coat trails behind as he moves
    ease(b[bone.skirt], -Math.min(0.18, (this.speed || 0) * 0.07) + Math.sin(t * 1.9) * 0.012, 0, Math.sin(t * 1.3) * 0.015, Math.min(1, dt * 3));
    // eyes flare when he hunts and dim when the light drives him back
    this.mat.emissiveIntensity = flinch ? 0.3 : hunting ? 2.6 + Math.sin(t * 23) * 0.3 : 1.7;
    return moved;
  }
}

/* The Doctor's Monster: a stitched-together giant, 2.35 m, in a dark coat too small for him. Sallow
   skin from more than one body, sewn at the brow, cheek, neck and wrists; a heavy brow over watery
   eyes, one of them milky; long black matted hair; huge hands. Slow heavy steps you hear coming; arms
   out in front when he has seen you. The same body, smaller, stands in for a zombie with no model. */
let bruteMats;
function bruteMaterials() {
  if (!bruteMats) {
    const t = bruteTextures();
    bruteMats = {
      skin: new THREE.MeshStandardMaterial({ map: t.skin, color: 0xa8a8a8, emissiveMap: t.glow, emissive: 0xffffff, emissiveIntensity: 1, roughness: 0.85 }),
      cloth: new THREE.MeshStandardMaterial({ map: t.cloth, roughness: 1, side: THREE.DoubleSide }),
    };
  }
  return bruteMats;
}
function bruteHead(d) {
  const { x, y, z } = d;
  const p = V(x * 0.138, y * 0.175, z * 0.155);
  // a heavy square jaw
  if (y < -0.2) {
    const k = smooth01(-0.2, -0.75, y);
    p.x *= 1 + 0.12 * k * Math.min(1, Math.abs(z) * 1.6);
    if (z > 0) p.z += 0.014 * k;
  }
  p.y += 0.014 * Math.max(0, y) * Math.max(0, z); // a high forehead
  const near = (cx, cy, cz, s) => Math.exp(-((x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2) / (2 * s * s));
  let r = 0.026 * near(0, 0.25, 0.96, 0.2) + 0.006 * near(0, -0.55, 0.83, 0.12);
  for (const sx of [-1, 1]) {
    r += 0.018 * near(sx * 0.36, 0.25, 0.9, 0.11); // brow ridge
    r -= 0.03 * near(sx * 0.36, 0.08 - (sx > 0 ? 0.03 : 0), 0.92, 0.11); // sockets, one lower
    r += 0.012 * near(sx * 0.55, -0.12, 0.8, 0.12); // cheekbones
    r -= 0.008 * near(sx * 0.9, 0.3, 0.3, 0.2); // flat temples
  }
  const l = p.length();
  return p.multiplyScalar((l + r) / l);
}
function stitchedBody() {
  const { skin, cloth } = bruteMaterials();
  const U = BRUTE_UV;
  const rig = new Rig();
  const B = {};
  B.root = rig.bone(0, 0, 0);
  B.hips = rig.bone(0, 1.02, 0, B.root);
  B.spine = rig.bone(0, 1.32, 0, B.hips);
  B.chest = rig.bone(0, 1.66, -0.02, B.spine);
  B.head = rig.bone(0, 2.0, 0.03, B.chest);
  B.arm = {};
  B.leg = {};
  for (const sx of [1, -1]) {
    const sh = rig.bone(sx * 0.42, 1.86, -0.02, B.chest);
    const el = rig.bone(sx * 0.46, 1.45, 0, sh);
    const wr = rig.bone(sx * 0.49, 1.07, 0.02, el);
    const fi = rig.bone(sx * 0.495, 0.94, 0.03, wr);
    B.arm[sx] = { sh, el, wr, fi };
    const th = rig.bone(sx * 0.17, 1.0, 0, B.hips);
    const kn = rig.bone(sx * 0.18, 0.55, 0.02, th);
    const an = rig.bone(sx * 0.185, 0.11, 0, kn);
    B.leg[sx] = { th, kn, an };
  }
  // the coat: broad across a hunched back, short, its hem torn
  const coatLv = [
    [0.72, 0.37, 0.28, 0], [0.9, 0.35, 0.26, 0], [1.1, 0.345, 0.25, 0.01], [1.3, 0.37, 0.26, 0], [1.5, 0.41, 0.28, -0.02],
    [1.68, 0.44, 0.3, -0.05], [1.82, 0.445, 0.28, -0.07], [1.92, 0.34, 0.22, -0.06], [1.98, 0.2, 0.16, -0.03], [2.01, 0.13, 0.13, -0.01],
  ];
  const folds = (a, y) => 1 + 0.035 * Math.sin(a * 6 + 0.7) * smooth01(1.3, 0.75, y) + 0.02 * Math.sin(a * 11) * smooth01(1.1, 0.72, y);
  const torn = (a) => Math.max(0, Math.sin(a * 5 + 1) * Math.sin(a * 13)) * 0.09;
  rig.add(loft(coatLv, { rad: 36, bump: folds, hem: torn }), cloth, byY([[1.08, B.hips], [1.25, B.spine], [1.45, B.spine], [1.62, B.chest]]), U.coat);
  // a turned-up collar at the back, odd buttons straining (one is missing)
  rig.add(loft([[1.93, 0.21, 0.17, -0.045], [2.07, 0.17, 0.15, -0.035]], { rad: 14, arc: [0.3, 0.7] }), cloth, B.chest, U.lapel);
  for (const [y, s] of [[1.27, 0.022], [1.58, 0.017]]) {
    const p = loftAt(coatLv, 0, y, folds);
    rig.add(blob(s, s, 0.008, 8, 5), cloth, byY([[1.45, B.spine], [1.62, B.chest]]), U.button, [p.x, p.y, p.z + 0.004]);
  }
  // a thick neck, sewn on all the way round
  rig.add(sweep([[0, 1.88, -0.01], [0, 2.0, 0.02], [0, 2.1, 0.05]], 0.098, { seg: 4, rad: 12, caps: [false, false] }), skin, byY([[1.97, B.chest], [2.04, B.head]]), U.neck);
  // the head, big and square-jawed, with long black matted hair
  const C = V(0, 2.17, 0.075);
  rig.add(sculpt(bruteHead, { w: 28, h: 20 }), skin, B.head, U.head, C.toArray());
  const at = (x, y, z) => bruteHead(dirOf(x, y, z)).add(C);
  const hairShape = (d) => bruteHead(d).multiplyScalar(1.07);
  rig.add(sculpt(hairShape, { w: 22, h: 6, theta: [0, Math.PI * 0.36] }), cloth, B.head, U.hair, C.toArray());
  rig.add(sculpt(hairShape, { w: 18, h: 8, phi: [Math.PI * 0.95, Math.PI * 1.1], theta: [Math.PI * 0.3, Math.PI * 0.45] }), cloth, B.head, U.hair, C.toArray());
  for (let i = 0; i < 11; i++) {
    // locks falling to the shoulders, round the sides and back
    const a = -1.25 + (i / 10) * 2.5 + Math.PI; // around the back, from one side to the other
    const dx = Math.sin(a);
    const dz = Math.cos(a);
    const s = at(dx, 0.45, dz).add(V(dx * 0.014, 0, dz * 0.014));
    const len = 0.26 + ((i * 7) % 5) * 0.03;
    rig.add(sweep([s, s.clone().add(V(dx * 0.03, -len * 0.4, dz * 0.03)), s.clone().add(V(dx * 0.045, -len * 0.75, dz * 0.04 - 0.01)), s.clone().add(V(dx * 0.05, -len, dz * 0.03 - 0.02))], (t) => 0.034 * (1 - t * 0.6), { seg: 5, rad: 4, flat: 0.3, up: [dx, 0, dz] }), cloth, byY([[1.95, B.chest], [2.05, B.head]]), U.hair);
  }
  for (const sx of [-1, 1]) {
    const d = dirOf(sx * 0.36, 0.08 - (sx > 0 ? 0.03 : 0), 0.92);
    const e = at(d.x, d.y, d.z).sub(d.clone().multiplyScalar(0.006));
    rig.add(blob(sx > 0 ? 0.0155 : 0.0142, 0.0142, 0.0142, 10, 8), skin, B.head, sx > 0 ? U.eye2 : U.eye, e.toArray());
    const eb = at(sx, 0.0, -0.05);
    rig.add(sweep([eb.clone().add(V(-sx * 0.01, -0.02, 0.01)), eb.clone().add(V(sx * 0.012, 0.01, -0.01)), eb.clone().add(V(sx * 0.008, 0.045, -0.025))], (t) => 0.032 - 0.014 * t, { seg: 4, rad: 6, flat: 0.32, up: [sx, 0, 0.2] }), skin, B.head, U.ear);
  }
  // a broad nose, broken long ago
  const n0 = at(0, 0.1, 1).sub(V(0, 0, 0.012));
  const n1 = at(0, -0.3, 0.95);
  rig.add(sweep([n0, V(0.003, (n0.y + n1.y) / 2, n1.z + 0.01), V(0.008, n1.y, n1.z + 0.02), V(0.008, n1.y - 0.012, n1.z + 0.008)], (t) => 0.014 + 0.006 * bell(t, 0.75, 0.2), { seg: 7, rad: 8, flat: 0.7, up: [0, 0, 1], caps: [false, true] }), skin, B.head, U.hand);
  for (const sx of [1, -1]) {
    const { sh, el, wr, fi } = B.arm[sx];
    // sleeves too short for him: bare forearms, sewn on at the wrist
    rig.add(sweep([[sx * 0.41, 1.94, -0.02], [sx * 0.435, 1.7, -0.01], [sx * 0.46, 1.45, 0], [sx * 0.475, 1.27, 0.012], [sx * 0.48, 1.2, 0.014]], (t) => 0.115 - 0.03 * t + 0.008 * bell(t, 1, 0.08), { seg: 10, rad: 10, caps: [true, false] }), cloth, byY([[1.4, el], [1.52, sh]]), U.sleeve);
    rig.add(sweep([[sx * 0.472, 1.28, 0.012], [sx * 0.485, 1.15, 0.016], [sx * 0.49, 1.04, 0.02]], (t) => 0.066 - 0.012 * t, { seg: 4, rad: 9, caps: [false, false] }), skin, byY([[1.06, wr], [1.11, el]]), U.arm);
    hand(rig, skin, U.hand, sx, wr, fi, { at: [sx * 0.492, 1.06, 0.03], palm: [0.032, 0.058, 0.056], lens: [0.105, 0.118, 0.11, 0.09], r0: 0.0165, r1: 0.0125, knob: 0.0028, curl: 0.05, spread: 0.026, claw: null });
    // legs in ragged trousers, and heavy boots
    const { th, kn, an } = B.leg[sx];
    rig.add(sweep([[sx * 0.17, 1.1, 0], [sx * 0.175, 0.8, 0], [sx * 0.18, 0.55, 0.02], [sx * 0.183, 0.3, 0.005], [sx * 0.185, 0.17, 0]], (t) => 0.14 - 0.035 * t + 0.008 * bell(t, 1, 0.06), { seg: 12, rad: 10, caps: [false, false] }), cloth, byY([[0.15, an], [0.2, kn], [0.5, kn], [0.6, th], [0.98, th], [1.06, B.hips]]), U.trousers);
    rig.add(sweep([[sx * 0.185, 0.27, -0.005], [sx * 0.185, 0.12, 0]], 0.088, { seg: 2, rad: 10, caps: [false, false] }), cloth, an, U.boot);
    rig.add(sweep([[sx * 0.185, 0.085, -0.085], [sx * 0.185, 0.085, 0.05], [sx * 0.186, 0.07, 0.185]], (t) => 0.078 - 0.02 * t, { seg: 6, rad: 10, flat: 0.72, up: [0, 1, 0] }), cloth, an, U.boot);
    rig.add(new THREE.BoxGeometry(0.17, 0.04, 0.36), cloth, an, U.boot, [sx * 0.185, 0.02, 0.05]);
  }
  const body = new THREE.Group();
  const bones = rig.build(body, new THREE.Sphere(V(0, 1.2, 0), 1.45));
  return { body, bones, B, mat: skin };
}
// one frame of the stitched body's walk: w = { walking, phase, hunting, asleep, t, k, lurch }
function stitchedPose({ bones: b, B }, w) {
  const { k, t } = w;
  const sw = w.walking ? Math.sin(w.phase) : 0;
  for (const sx of [1, -1]) {
    const { th, kn, an } = B.leg[sx];
    const fwd = sx > 0 ? sw : -sw; // this leg's swing: forward when positive
    const lift = w.walking ? Math.max(0, Math.cos(w.phase + (sx > 0 ? 0 : Math.PI))) : 0;
    ease(b[th], w.asleep ? 0 : -fwd * 0.42 - lift * 0.12, 0, sx * 0.02, k);
    ease(b[kn], w.asleep ? 0 : 0.06 + lift * 0.65, 0, 0, k);
    ease(b[an], w.asleep ? 0 : -lift * 0.25 + fwd * 0.12, 0, 0, k);
  }
  // heavy: he drops onto each step and rolls his shoulders
  b[B.hips].position.y = 1.02 + (w.walking ? -Math.abs(Math.sin(w.phase)) * 0.05 + 0.02 : 0);
  ease(b[B.hips], 0, w.walking ? sw * 0.07 : 0, w.walking ? sw * 0.05 : 0, k);
  const hunch = w.asleep ? 0 : w.hunting ? 0.24 : 0.13;
  ease(b[B.spine], hunch * 0.5, 0, w.lurch ? Math.sin(t * 1.3) * 0.08 : 0, k);
  ease(b[B.chest], hunch * 0.5 + (w.asleep ? 0 : Math.sin(t * 1.2) * 0.02), w.walking ? -sw * 0.12 : 0, 0, k);
  ease(b[B.head], w.asleep ? 0 : w.hunting ? -0.28 : 0.06, w.asleep ? 0 : Math.sin(t * 0.4) * 0.25, w.lurch ? 0.3 + Math.sin(t * 0.9) * 0.08 : 0, k);
  for (const sx of [1, -1]) {
    const { sh, el, wr, fi } = B.arm[sx];
    const i = sx > 0 ? 0 : 1;
    if (w.asleep) {
      ease(b[sh], 0, 0, sx * 0.04, k);
      ease(b[el], 0, 0, 0, k);
      ease(b[wr], 0, 0, 0, k);
      ease(b[fi], 0, 0, -sx * 0.2, k);
    } else if (w.hunting || w.lurch) {
      // reaching for you, the huge hands opening and closing
      const reach = w.hunting ? 1.55 : 1.15;
      ease(b[sh], -reach + Math.sin(t * 4 + i * 1.7) * 0.09, 0, -sx * 0.06, k);
      ease(b[el], -0.18 - (w.lurch ? 0.2 : 0), 0, 0, k);
      ease(b[wr], -0.15 + (w.lurch ? 0.5 : 0), 0, 0, k);
      ease(b[fi], 0, 0, -sx * (0.35 + Math.sin(t * 3 + i) * 0.3), k);
    } else {
      ease(b[sh], (sx > 0 ? -sw : sw) * 0.4 + 0.04, 0, sx * 0.11, k);
      ease(b[el], -0.28 - Math.max(0, sx > 0 ? -sw : sw) * 0.2, 0, 0, k);
      ease(b[wr], 0.05, 0, 0, k);
      ease(b[fi], 0, 0, -sx * 0.45, k);
    }
  }
}
export class Creature extends Monster {
  constructor(scene) {
    super(scene, 'creature');
    this.fig = stitchedBody();
    this.body = this.fig.body;
    this.root.add(this.body);
    this.stride = 0;
  }
  update(dt) {
    const moved = this.follow(dt);
    const hunting = this.hunting;
    // a slow, heavy walk: the stride follows how far he really went
    this.stride += moved * 2.3;
    const walking = this.speed > 0.2;
    const asleep = this.state === 'asleep';
    stitchedPose(this.fig, { walking: walking && !asleep, phase: this.stride, hunting, asleep, t: this.t, k: this.posed ? Math.min(1, dt * 6) : 1 });
    this.posed = true;
    this.fig.mat.emissiveIntensity = hunting ? 1.6 : 1;
    // asleep on the slab until the power comes back; then he sits up and climbs off
    this.lie = this.lie ?? (asleep ? 1 : 0);
    this.lie += ((asleep ? 1 : 0) - this.lie) * Math.min(1, dt * 1.5);
    if (this.lie > 0.01) {
      this.body.rotation.x = (-Math.PI / 2) * this.lie;
      this.body.position.y = 1.2 * this.lie;
      this.body.position.z = 1.17 * this.lie;
    } else {
      this.body.rotation.x = 0;
      this.body.position.set(0, 0, 0);
    }
    // each time a foot lands
    const step = Math.floor(this.stride / Math.PI);
    this.footfall = walking && step !== this.lastStep;
    this.lastStep = step;
    return moved;
  }
}

/* The zombies: the animated zombie figures from models.json ("zombie"), greyed, darkened and grimed,
   with pale glowing eyes, shuffling with a lurch and reaching out when they hunt. A smaller stitched
   body stands in when there is no model. */
const zombieCast = characters('zombie');
// the cartoon colours turned to a corpse's: grey skin, filthy dark rags, old blood gone brown
const ZOMBIE_TONE = { Skin: 0x5c6458, Clothes: 0x2b2830, DarkClothes: 0x151318, Pants: 0x3a3329, Guts: 0x3a2724, Brain: 0x4a3d3f, Bones: 0x6a6456, Face: 0x050404, Hair: 0x18130f };
const zombieLooks = new Map();
// darker blotches and streaks over a material, painted in its own space so they move with the body
function grime(mat, amount, freq) {
  mat.onBeforeCompile = (s) => {
    s.uniforms.uGrime = { value: amount };
    s.uniforms.uFreq = { value: freq };
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vGrime;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvGrime = position;');
    s.fragmentShader = s.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vGrime;
uniform float uGrime;
uniform float uFreq;
float gHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float gNoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(gHash(i), gHash(i + vec3(1, 0, 0)), f.x), mix(gHash(i + vec3(0, 1, 0)), gHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(gHash(i + vec3(0, 0, 1)), gHash(i + vec3(1, 0, 1)), f.x), mix(gHash(i + vec3(0, 1, 1)), gHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec3 q = vGrime * uFreq;
  float n = gNoise(q) * 0.55 + gNoise(q * 2.7) * 0.3 + gNoise(q * 8.0) * 0.15;
  float streak = gNoise(vec3(q.x * 5.0, q.y * 0.5, q.z * 5.0));
  diffuseColor.rgb *= mix(1.0, (0.45 + 0.8 * n) * (0.7 + 0.4 * streak), uGrime);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.035, 0.03, 0.02), uGrime * 0.6 * smoothstep(0.55, 0.75, n));
}`,
      );
  };
  mat.customProgramCacheKey = () => 'grime';
}
function zombieMaterial(m, freq) {
  if (!zombieLooks.has(m)) {
    const z = m.clone();
    if (ZOMBIE_TONE[m.name] != null) z.color.setHex(ZOMBIE_TONE[m.name]);
    z.roughness = 0.95;
    z.metalness = 0;
    if (m.name !== 'Face') grime(z, m.name === 'Skin' ? 0.55 : 0.8, freq);
    // the eyes (the only features painted in this material) glow a sickly pale green
    else z.emissive.setHex(0xb8d090);
    zombieLooks.set(m, z);
  }
  return zombieLooks.get(m);
}
const _q = new THREE.Quaternion();
const _pq = new THREE.Quaternion();
const _ax = new THREE.Vector3();
export class Zombie extends Monster {
  constructor(scene, id = '') {
    super(scene, 'zombie');
    this.limp = (hash(id) % 2) * 2 - 1;
    this.hunt = 0;
    zombieCast
      .then((c) => (c.count ? c.get(hash(id)) : null))
      .then((f) => (f ? this.dress(f) : this.standIn()))
      .catch((e) => (console.warn('zombie stand-in', e), this.standIn()));
  }
  standIn() {
    if (this.gone || this.body) return;
    this.fig = stitchedBody();
    this.body = this.fig.body;
    this.body.scale.setScalar(0.78);
    this.root.add(this.body);
    this.stride = 0;
  }
  dress(f) {
    if (this.gone || this.body) return;
    const spec = f.spec;
    this.body = SkeletonUtils.clone(f.scene);
    this.body.scale.setScalar(f.scale);
    this.body.rotation.y = THREE.MathUtils.degToRad(spec.turn || 0);
    this.body.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.geometry.computeBoundingBox();
      const size = o.geometry.boundingBox.getSize(_ax);
      o.material = zombieMaterial(o.material, 7 / Math.max(size.x, size.y, size.z, 0.01));
    });
    this.root.add(this.body);
    this.mixer = new THREE.AnimationMixer(this.body);
    this.actions = [findClip(f.animations, 'idle'), findClip(f.animations, 'walk'), findClip(f.animations, 'run')].map((c) => c && this.mixer.clipAction(c));
    for (const a of this.actions) a && (a.play(), a.setEffectiveWeight(0));
    this.weights = [1, 0, 0];
    // three.js drops the dots from bone names: 'UpperArm.L' is 'UpperArmL'
    const bone = (n) => this.body.getObjectByName(n) || this.body.getObjectByName(n.replace('.', ''));
    this.arms = ['UpperArm.L', 'UpperArm.R'].map(bone).filter(Boolean);
    this.torso = bone('Torso');
    this.headBone = bone('Head');
  }
  // turn a bone about one of the zombie's own axes (x: sideways, z: forward), after the animation has set it
  bend(bone, ax, ay, az, angle) {
    if (!bone) return;
    // the mixer only writes a bone when its animated value changes: when it left this one alone,
    // take off last frame's bend before bending again, or the bends pile up
    const st = (bone.userData.bend ||= { base: new THREE.Quaternion(), out: new THREE.Quaternion(0, 0, 0, 0) });
    if (bone.quaternion.equals(st.out)) bone.quaternion.copy(st.base);
    st.base.copy(bone.quaternion);
    bone.parent.getWorldQuaternion(_pq);
    _ax.set(ax, ay, az).applyQuaternion(this.root.quaternion).applyQuaternion(_pq.invert());
    bone.quaternion.premultiply(_q.setFromAxisAngle(_ax.normalize(), angle));
    st.out.copy(bone.quaternion);
  }
  update(dt) {
    const moved = this.follow(dt);
    const t = this.t;
    this.hunt += ((this.hunting ? 1 : 0) - this.hunt) * Math.min(1, dt * 3);
    // a lurching, limping shuffle
    const pace = this.speed > 0.2 ? (this.hunting ? 5 : 3.2) : 1.2;
    this.root.rotation.z = Math.sin(t * pace * 0.5) * 0.06 + this.limp * 0.04;
    this.root.position.y = this.speed > 0.2 ? -Math.max(0, Math.sin(t * pace)) * 0.04 : 0;
    if (this.fig) {
      this.stride += moved * 2.8;
      stitchedPose(this.fig, { walking: this.speed > 0.2, phase: this.stride, hunting: this.hunting, asleep: false, lurch: true, t, k: Math.min(1, dt * 6) });
      return moved;
    }
    if (this.mixer) {
      const want = this.speed < 0.2 ? 0 : this.hunting ? 2 : 1;
      for (let i = 0; i < 3; i++) {
        this.weights[i] += ((i === want ? 1 : 0) - this.weights[i]) * Math.min(1, dt * 5);
        this.actions[i]?.setEffectiveWeight(this.weights[i]);
      }
      if (this.actions[1]) this.actions[1].timeScale = 0.55;
      if (this.actions[2]) this.actions[2].timeScale = 0.62;
      this.mixer.update(dt);
      // head lolling to one side, shoulders hunched, arms coming up as it closes in
      this.bend(this.torso, 1, 0, 0, 0.16 + this.hunt * 0.06);
      this.bend(this.headBone, 0, 0, 1, this.limp * (0.3 + Math.sin(t * 0.8) * 0.08));
      this.arms.forEach((a, i) => this.bend(a, 1, 0, 0, -(0.2 + this.hunt * 1.3) + Math.sin(t * 2.5 + i * 2) * 0.1 * this.hunt));
    }
    return moved;
  }
}

export function makeMonster(scene, kind, id) {
  if (kind === 'creature') return new Creature(scene);
  if (kind === 'zombie') return new Zombie(scene, id);
  return new Vampire(scene);
}

/* ---------- the ghosts ("boo") ----------
   A sheet that floats with an empty face; it glows faintly so you see it coming. */
export class Ghost {
  constructor(scene) {
    this.mat = new THREE.MeshStandardMaterial({ color: 0xdfe6ee, emissive: 0x7088a8, emissiveIntensity: 0.4, transparent: true, opacity: 0.62, roughness: 0.7, side: THREE.DoubleSide, depthWrite: false });
    // a sheet over a head, falling to a ragged hem that never touches the floor
    const pts = [];
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      const y = 1.6 - t * 1.6;
      const r = t < 0.22 ? Math.sin((t / 0.22) * Math.PI * 0.5) * 0.26 : 0.26 + (t - 0.22) * 0.32;
      pts.push(new THREE.Vector2(Math.max(0.001, r), y));
    }
    this.geo = new THREE.LatheGeometry(pts.reverse(), 36);
    // tear the hem into uneven strips
    const pa = this.geo.attributes.position;
    for (let i = 0; i < pa.count; i++) {
      const y = pa.getY(i);
      if (y < 0.35) {
        const a = Math.atan2(pa.getZ(i), pa.getX(i));
        const tear = Math.max(0, Math.sin(a * 7) * Math.sin(a * 3 + 1)) * 0.3 * (1 - y / 0.35);
        pa.setY(i, y + tear);
      }
    }
    this.geo.computeVertexNormals();
    this.base = this.geo.attributes.position.array.slice();
    this.root = new THREE.Group();
    this.sheet = new THREE.Mesh(this.geo, this.mat);
    this.root.add(this.sheet);
    const hole = new THREE.MeshBasicMaterial({ color: 0x020203, transparent: true, opacity: 0.92 });
    for (const x of [-0.085, 0.085]) {
      const e = new THREE.Mesh(new THREE.CircleGeometry(0.05, 16), hole);
      e.scale.set(0.8, 1.9, 1);
      e.position.set(x, 1.4, 0.245);
      e.rotation.y = x * 2.2;
      this.root.add(e);
    }
    this.mouth = new THREE.Mesh(new THREE.CircleGeometry(0.045, 16), hole);
    this.mouth.scale.set(0.9, 1.6, 1);
    this.mouth.position.set(0, 1.22, 0.262);
    this.root.add(this.mouth);
    this.x = this.tx = 0;
    this.z = this.tz = 0;
    this.alive = true;
    this.fade = 1;
    this.t = Math.random() * 10;
    scene.add(this.root);
  }
  remove() {
    this.root.parent?.remove(this.root);
  }
  set(x, z, alive, chasing) {
    if (alive && !this.alive) {
      this.x = x;
      this.z = z;
    }
    this.tx = x;
    this.tz = z;
    this.alive = !!alive;
    this.chasing = !!chasing;
  }
  update(dt, camX, camZ) {
    this.t += dt;
    const k = Math.min(1, dt * 6);
    this.x += (this.tx - this.x) * k;
    this.z += (this.tz - this.z) * k;
    this.fade += ((this.alive ? 1 : 0) - this.fade) * Math.min(1, dt * 4);
    this.root.visible = this.fade > 0.02;
    this.root.position.set(this.x, 0.3 + Math.sin(this.t * 1.6) * 0.1, this.z);
    // it always turns to face you, a little late
    const want = Math.atan2(camX - this.x, camZ - this.z);
    let d = want - this.root.rotation.y;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    this.root.rotation.y += d * Math.min(1, dt * 2.5);
    this.root.rotation.z = Math.sin(this.t * 1.1) * 0.06;
    this.mat.opacity = (this.chasing ? 0.75 : 0.55 + Math.sin(this.t * 2.3) * 0.08) * this.fade;
    this.mat.emissiveIntensity = this.chasing ? 0.7 + Math.sin(this.t * 14) * 0.2 : 0.4;
    this.mouth.scale.set(0.9, this.chasing ? 2.6 + Math.sin(this.t * 7) * 0.5 : 1.6, 1);
    const pos = this.geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = this.base[i * 3 + 1];
      const x = this.base[i * 3];
      const z = this.base[i * 3 + 2];
      const a = Math.atan2(z, x);
      const low = Math.max(0, 0.9 - y) / 0.9;
      const w = 1 + low * 0.14 * Math.sin(a * 5 + this.t * 3.5) - low * 0.1 * (this.chasing ? 1 : 0);
      pos.setX(i, x * w);
      pos.setZ(i, z * w + low * low * (this.chasing ? -0.25 : -0.08));
      pos.setY(i, y + low * 0.05 * Math.sin(a * 6 + this.t * 4 + 1));
    }
    pos.needsUpdate = true;
  }
}

/* ---------- an item someone dropped ----------
   It glows softly gold so it can be found again in the dark. */
let glintMap;
function glintTex() {
  if (!glintMap) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,240,200,1)');
    grd.addColorStop(0.2, 'rgba(255,200,110,0.6)');
    grd.addColorStop(0.55, 'rgba(255,170,60,0.18)');
    grd.addColorStop(1, 'rgba(255,150,40,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    glintMap = new THREE.CanvasTexture(c);
    glintMap.colorSpace = THREE.SRGBColorSpace;
  }
  return glintMap;
}
export function looseItem(scene, item) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: item === 'fuse' ? 0xc0c0b0 : 0xb08a3a, metalness: 0.8, roughness: 0.3, emissive: 0x403010, emissiveIntensity: 0.6 });
  const m = item === 'fuse' ? new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.16, 10), mat) : new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.015, 6, 14), mat);
  m.rotation.z = Math.PI / 2;
  m.position.y = 0.06;
  g.add(m);
  const glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: glintTex(), color: 0xffd080, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  glint.scale.set(0.7, 0.7, 1);
  glint.position.y = 0.1;
  g.add(glint);
  scene.add(g);
  return g;
}

// fetch the figures while people wait in the lobby: the costumes in the house, and the zombies
export function warmCast(costumes = []) {
  cast.then((c) => c.count && new Set(costumes).forEach((i) => c.get(Number.isInteger(i) ? i : 0)));
}
export function warmZombies() {
  zombieCast.then((c) => { for (let i = 0; i < c.count; i++) c.get(i); });
}
