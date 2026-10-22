// Builds the manor in three.js from the shared level: floors, walls, ceilings, doors,
// furniture, the rainy courtyard, and the lamps that come on when the power is fixed.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as L from '/shared/level.js';
import { makeMaterials, paintings, skyTextures } from './textures.js';

const { TILE, WALL_H } = L;
const DOOR_H = 2.45;
const _size = new THREE.Vector2();
const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();

export function buildWorld(renderer) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020203);
  scene.fog = new THREE.FogExp2(0x020203, 0.07);
  const M = makeMaterials(renderer.capabilities.getMaxAnisotropy());
  const solids = []; // axis-aligned boxes you bump into: {x0, z0, x1, z1}
  const targets = []; // meshes you can point at: userData.act says what pointing at them does
  // still things far off in the fog are not drawn at all (see cullFar)
  const far = [];
  const doorFar = [];

  /* ---------- floors, ceilings, walls as a few merged meshes ---------- */
  const parts = new Map();
  const add = (mat, geo) => {
    if (!parts.has(mat)) parts.set(mat, []);
    parts.get(mat).push(geo);
  };
  const floorMat = (ch) => ({ k: M.tiles, w: M.tiles, c: M.stone, p: M.stone, e: M.stone, x: M.stone, t: M.stone, g: M.ground })[ch] || M.wood;
  const wallMat = (ch, out) => (ch === 'g' ? M.brick : out ? M.brick : ch === 'c' || ch === 'x' || ch === 't' || ch === 'p' ? M.wallCold : M.wall);

  for (let r = 0; r < L.H; r++)
    for (let c = 0; c < L.W; c++) {
      const ch = L.at(c, r);
      if (ch === '#' || ch === ' ') continue;
      const [cx, cz] = L.centre(c, r);
      const door = ch === '+' ? L.DOORS.find((d) => d.c === c && d.r === r) : null;
      // the room this tile belongs to, for doors judge by a neighbour
      let room = ch;
      if (door) room = door.front ? 'e' : L.at(c, r - 1) !== '#' && L.at(c, r - 1) !== '+' ? L.at(c, r - 1) : L.at(c - 1, r);
      const outdoor = room === 'g';
      const f = new THREE.PlaneGeometry(TILE, TILE);
      f.rotateX(-Math.PI / 2);
      f.translate(cx, 0, cz);
      add(door ? M.stone : floorMat(room), f);
      if (!outdoor) {
        const top = door ? DOOR_H : WALL_H;
        const cg = new THREE.PlaneGeometry(TILE, TILE);
        cg.rotateX(Math.PI / 2);
        cg.translate(cx, top, cz);
        add(M.ceiling, cg);
      }
      // a wall face on each side that borders solid stone, and a lintel above each doorway
      for (const [dc, dr, ry] of [[0, -1, 0], [0, 1, Math.PI], [-1, 0, Math.PI / 2], [1, 0, -Math.PI / 2]]) {
        const nb = L.at(c + dc, r + dr);
        let y0 = 0;
        let y1 = door ? DOOR_H : WALL_H;
        if (nb === '+' && !door) y0 = DOOR_H;
        else if (nb !== '#' && nb !== ' ') continue;
        const g = new THREE.PlaneGeometry(TILE, y1 - y0);
        g.translate(0, (y0 + y1) / 2, -TILE / 2);
        g.rotateY(ry);
        g.translate(cx, 0, cz);
        // keep the wallpaper the same size on short pieces of wall
        const uv = g.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setY(i, (y0 + uv.getY(i) * (y1 - y0)) / WALL_H);
        add(wallMat(outdoor ? 'g' : room, false), g);
      }
    }
  for (const [mat, geos] of parts) {
    const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
    mesh.receiveShadow = true;
    mesh.castShadow = mat !== M.ground && mat !== M.ceiling;
    scene.add(mesh);
  }
  // wall tiles are solid
  for (let r = 0; r < L.H; r++)
    for (let c = 0; c < L.W; c++) {
      const ch = L.at(c, r);
      if (ch === '#') solids.push({ x0: c * TILE, z0: r * TILE, x1: (c + 1) * TILE, z1: (r + 1) * TILE, wall: true });
    }
  // nobody walks off the bottom edge until the front door is open (handled by the front door solid)

  /* ---------- doors ---------- */
  const doors = new Map();
  // each leaf is one mesh: the panels and the knob are told apart by a tint painted on their corners
  const doorMat = M.door.clone();
  doorMat.vertexColors = true;
  const tint = (mesh, hex) => {
    const c = new THREE.Color(hex);
    const n = mesh.geometry.attributes.position.count;
    mesh.geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3).map((_, i) => [c.r, c.g, c.b][i % 3]), 3));
    mesh.material = doorMat;
    return mesh;
  };
  for (const d of L.DOORS) {
    if (d.arch) continue;
    const [cx, cz] = L.centre(d.c, d.r);
    const axis = L.doorAxis(d);
    const group = new THREE.Group();
    group.position.set(cx, 0, cz);
    if (axis === 'z') group.rotation.y = Math.PI / 2;
    scene.add(group);
    const leaves = [];
    const leafW = TILE / 2 + 0.01; // the two leaves overlap a hair so there is no gap to look through
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * (TILE / 2 - 0.01), 0, 0);
      group.add(pivot);
      const leaf = tint(new THREE.Mesh(new THREE.BoxGeometry(leafW, DOOR_H - 0.04, d.front ? 0.14 : 0.08), M.door), 0xffffff);
      leaf.position.set(-side * (leafW / 2), DOOR_H / 2, 0);
      leaf.castShadow = leaf.receiveShadow = true;
      pivot.add(leaf);
      // panels and a handle
      for (const py of [0.6, 1.6]) {
        const panel = tint(new THREE.Mesh(new THREE.BoxGeometry(leafW * 0.7, 0.7, 0.02), M.door), 0x6a5a50);
        panel.position.set(-side * (leafW / 2), py, d.front ? 0.08 : 0.05);
        pivot.add(panel);
        const back = panel.clone();
        back.position.z *= -1;
        pivot.add(back);
      }
      const knob = tint(new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), M.door), 0xf0c060);
      knob.position.set(-side * (leafW - 0.12), 1.05, 0.08);
      pivot.add(knob);
      const knob2 = knob.clone();
      knob2.position.z = -0.08;
      pivot.add(knob2);
      // one mesh per material for the whole leaf
      const act = { kind: d.front ? 'front' : 'door', id: d.id };
      for (const m of mergeLocal(pivot)) {
        m.castShadow = m.receiveShadow = true;
        m.userData.act = act;
        targets.push(m);
      }
      leaves.push({ pivot, side });
    }
    // the front door carries a chain and three padlocks
    const locks = [];
    if (d.front) {
      for (let i = 0; i < 3; i++) {
        const lock = new THREE.Group();
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.18, 0.07), M.iron);
        const shackle = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.014, 6, 12, Math.PI), M.iron);
        shackle.position.y = 0.09;
        lock.add(body, shackle);
        lock.position.set(-0.25 + i * 0.25, 0.95 + (i % 2) * 0.12, -0.12);
        group.add(lock);
        locks.push(lock);
      }
      const chain = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.02, 6, 24), M.iron);
      chain.scale.set(1, 0.25, 1);
      chain.rotation.x = Math.PI / 2;
      chain.position.set(0, 1.0, -0.1);
      group.add(chain);
      locks.push(chain);
    }
    const box = axis === 'x' ? { x0: cx - TILE / 2, x1: cx + TILE / 2, z0: cz - 0.1, z1: cz + 0.1 } : { x0: cx - 0.1, x1: cx + 0.1, z0: cz - TILE / 2, z1: cz + TILE / 2 };
    const solid = { ...box, door: d.id, on: true };
    solids.push(solid);
    doors.set(d.id, { d, leaves, open: 0, want: 0, solid, locks, axis });
    group.userData.sphere = new THREE.Sphere(new THREE.Vector3(cx, 1.2, cz), 1.8);
    doorFar.push(group);
  }

  /* ---------- furniture ----------
     Furniture never moves, so it is drawn as a few merged meshes per room rather than hundreds of
     small ones. What you can use (search, hide, the fuse box) gets a plain invisible box to point at.
     A model from /assets/models replaces the simple built shape when one is listed for that type. */
  const props = new Map();
  const propRoot = new THREE.Group();
  scene.add(propRoot);
  const hitMat = new THREE.MeshBasicMaterial();
  for (const p of L.PROPS) {
    if (p.solid) solids.push({ x0: p.x - p.hw, x1: p.x + p.hw, z0: p.z - p.hd, z1: p.z + p.hd, prop: p.id, low: p.h < 0.7 });
    if (!p.box && !p.hide && !p.special) continue;
    const hit = new THREE.Mesh(new THREE.BoxGeometry(p.w, p.h, p.d), hitMat);
    hit.position.set(p.x, (p.wallH || 0) + p.h / 2, p.z);
    hit.rotation.y = p.rot;
    hit.visible = false;
    hit.updateMatrixWorld();
    hit.userData.act = { kind: p.special || (p.box ? 'search' : 'hide'), prop: p.id };
    targets.push(hit);
  }
  function placeProps(model) {
    propRoot.clear();
    const groups = [];
    for (const p of L.PROPS) {
      const g = (model && model(p)) || makeProp(p, M);
      g.position.set(p.x, p.wallH || 0, p.z);
      g.rotation.y = p.rot;
      g.userData.room = p.room;
      g.userData.shadow = p.type !== 'painting' && p.type !== 'chalkboard' && p.type !== 'cobweb' && p.type !== 'archweb';
      if (p.glow) g.traverse((o) => o.isMesh && (o.material = lantern(o.material)));
      groups.push(g);
      props.set(p.id, g);
    }
    far.length = 0;
    for (const m of bake(groups)) {
      propRoot.add(m);
      far.push(m);
    }
    far.push(...doorFar);
  }
  // a carved pumpkin's colours, lit from within by its candle
  const lanterns = new Map();
  function lantern(mat) {
    if (mat === M.pumpkin) return mat;
    if (!lanterns.has(mat)) {
      const m = mat.clone();
      m.emissive = new THREE.Color(0xffb468);
      m.emissiveMap = mat.map || null;
      m.emissiveIntensity = 0.22;
      lanterns.set(mat, m);
    }
    return lanterns.get(mat);
  }
  placeProps(null);

  /* ---------- light ---------- */
  const hemi = new THREE.HemisphereLight(0x6a6a88, 0x1a120a, 0.03);
  scene.add(hemi);
  // moonlight in the courtyard, and lightning
  const moon = new THREE.DirectionalLight(0x8090c0, 0.0);
  moon.position.set(33, 30, 10);
  moon.target.position.set(33, 0, 24);
  scene.add(moon, moon.target);
  const courtyard = L.ROOMS.g;
  const yard = { x0: courtyard.c0 * TILE, x1: (courtyard.c1 + 1) * TILE, z0: courtyard.r0 * TILE, z1: (courtyard.r1 + 1) * TILE };
  const moonGlow = new THREE.PointLight(0x7080b0, 0, 30, 1.2);
  moonGlow.position.set((yard.x0 + yard.x1) / 2, 7, (yard.z0 + yard.z1) / 2);
  scene.add(moonGlow);

  // Every lamp and candle in the house is a light source, but only the few nearest you really shine:
  // a small pool of lights moves to them. Many lights at once is what makes laptops slow.
  const sources = [];
  // lamps along the gallery: dark until the fuse is fixed
  const lampSpots = [[8, 6.5], [18, 6.5], [26.5, 9.5], [24, 16.5], [14, 16.5], [5.5, 13.5]];
  const bulbMat = new THREE.MeshStandardMaterial({ color: 0x302820, emissive: 0xffb060, emissiveIntensity: 0 });
  const fixtures = [];
  for (const [c, r] of lampSpots) {
    const [x, z] = [(c + 0.5) * TILE, (r + 0.5) * TILE];
    const fixture = new THREE.Group();
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.6), M.iron);
    cord.position.y = WALL_H - 0.3;
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.2, 12, 1, true), M.iron);
    shade.position.y = WALL_H - 0.65;
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), bulbMat);
    bulb.position.y = WALL_H - 0.72;
    fixture.add(cord, shade, bulb);
    fixture.position.set(x, 0, z);
    fixture.userData = { room: 'c', shadow: false };
    fixtures.push(fixture);
    sources.push({ x, y: WALL_H - 0.85, z, color: 0xffa860, base: 5.5, range: 11, decay: 1.6, power: true, phase: Math.random() * 10 });
  }
  for (const m of bake(fixtures)) scene.add(m);
  // candles burn whatever happens to the power: the chapel, the hall, and a few left on furniture
  const flames = [];
  const candleAt = (x, y, z, base = 1.6, range = 6, weak = false) => {
    sources.push({ x, y, z, color: weak ? 0xffb868 : 0xff9040, base, range, decay: 1.8, candle: true, weak, phase: Math.random() * 10 });
    flames.push([x, y, z, weak ? 0.75 : 0.9]);
  };
  for (const p of L.PROPS.filter((p) => p.type === 'altar' || p.type === 'candles')) candleAt(p.x, p.type === 'altar' ? 1.4 : 1.3, p.z, p.type === 'altar' ? 1.6 : 1.2);
  // a candle inside each carved pumpkin
  for (const p of L.PROPS.filter((p) => p.glow)) candleAt(p.x, (p.wallH || 0) + 0.3, p.z, 0.7, 4, true);
  // the laboratory's coils crackle blue once the power is back
  const sparks = [];
  for (const p of L.PROPS.filter((p) => p.spark)) {
    sources.push({ x: p.x, y: p.h + 0.2, z: p.z, color: 0x88aaff, base: 3, range: 8, decay: 1.6, power: true, spark: true, phase: Math.random() * 10 });
    sparks.push([p.x, p.h + 0.15, p.z]);
  }
  const POOL = 4;
  const pool = [];
  for (let i = 0; i < POOL; i++) {
    const light = new THREE.PointLight(0xffa860, 0, 10, 1.6);
    scene.add(light);
    pool.push({ light, src: null, fade: 0 });
  }
  // a soft glow around each flame you can see from afar
  const glowTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,200,120,1)');
    grd.addColorStop(0.25, 'rgba(255,150,60,0.35)');
    grd.addColorStop(1, 'rgba(255,120,40,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  // every flame's glow is one point of a single Points: one draw call however many candles burn
  const glowGeo = new THREE.BufferGeometry();
  glowGeo.setAttribute('position', new THREE.Float32BufferAttribute(flames.flatMap(([x, y, z]) => [x, y, z]), 3));
  glowGeo.setAttribute('size', new THREE.Float32BufferAttribute(flames.map((f) => f[3] || 0.9), 1));
  glowGeo.setAttribute('phase', new THREE.Float32BufferAttribute(flames.map((_, i) => i * 2.3), 1));
  const glowMat = new THREE.ShaderMaterial({
    uniforms: { map: { value: glowTex }, opacity: { value: 0.55 }, time: { value: 0 }, halfH: { value: 360 }, fogDensity: { value: 0.05 } },
    vertexShader: `attribute float size; attribute float phase; uniform float time; uniform float halfH; uniform float fogDensity; varying float vFade;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float d = max(0.05, -mv.z);
        gl_PointSize = size * (0.8 + 0.12 * sin(time * 11.0 + phase)) * projectionMatrix[1][1] * halfH / d;
        vFade = exp(-pow(fogDensity * d, 2.0));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform sampler2D map; uniform float opacity; varying float vFade;
      void main() {
        gl_FragColor = texture2D(map, gl_PointCoord) * opacity * vFade;
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });
  const glows = new THREE.Points(glowGeo, glowMat);
  glows.frustumCulled = false;
  glows.onBeforeRender = (r) => {
    glowMat.uniforms.halfH.value = r.getDrawingBufferSize(_size).y / 2;
    glowMat.uniforms.fogDensity.value = scene.fog.density;
  };
  scene.add(glows);
  const sparkMat = new THREE.SpriteMaterial({ map: glowTex, color: 0x99bbff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 });
  const sparkGlows = sparks.map(([x, y, z]) => {
    const s = new THREE.Sprite(sparkMat);
    s.position.set(x, y, z);
    scene.add(s);
    return s;
  });
  const lampGlowMat = new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 });
  const lampGlows = sources.filter((s) => s.power).map((s) => {
    const g = new THREE.Sprite(lampGlowMat);
    g.position.set(s.x, s.y + 0.12, s.z);
    g.scale.setScalar(1.4);
    scene.add(g);
    return g;
  });

  /* ---------- rain ---------- */
  let drops = 1400;
  const rainGeo = new THREE.BufferGeometry();
  const rp = new Float32Array(drops * 6);
  for (let i = 0; i < drops; i++) {
    const x = yard.x0 + Math.random() * (yard.x1 - yard.x0);
    const z = yard.z0 + Math.random() * (yard.z1 - yard.z0);
    const y = Math.random() * 9;
    rp.set([x, y, z, x + 0.03, y - 0.45, z], i * 6);
  }
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rp, 3));
  const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: 0x8090a8, transparent: true, opacity: 0.35 }));
  scene.add(rain);

  /* ---------- the night over the graveyard ----------
     A full moon with a faint halo low over the north wall, a dark violet sky with a few stars, and
     the moonlight there tinted blue-violet. All of it is drawn only when you are in or near the
     courtyard; from inside the house the ceilings would hide it anyway. */
  const SKY = skyTextures();
  const night = new THREE.Group();
  const centre = new THREE.Vector3((yard.x0 + yard.x1) / 2, 0, (yard.z0 + yard.z1) / 2);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(70, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ map: SKY.sky, side: THREE.BackSide, fog: false, depthWrite: false }));
  dome.position.copy(centre);
  dome.renderOrder = -10;
  const moonAt = new THREE.Vector3(centre.x - 4, 22, yard.z0 - 30);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: SKY.halo, color: 0x9a90e0, blending: THREE.AdditiveBlending, fog: false, depthWrite: false, transparent: true, opacity: 0.55 }));
  halo.position.copy(moonAt);
  halo.scale.setScalar(24);
  halo.renderOrder = -9;
  const moonDisc = new THREE.Sprite(new THREE.SpriteMaterial({ map: SKY.moon, color: 0xf2eeff, fog: false, depthWrite: false, transparent: true }));
  moonDisc.position.copy(moonAt);
  moonDisc.scale.setScalar(7.5);
  moonDisc.renderOrder = -8;
  night.add(dome, halo, moonDisc);
  scene.add(night);
  // the moonlight comes from the moon, violet-blue
  moon.color.setHex(0x8f86d8);
  moon.position.copy(moonAt);
  moon.target.position.copy(centre);
  moonGlow.color.setHex(0x7a70c8);

  /* ---------- bats ----------
     One instanced mesh for all of them: a flock wheeling over the graveyard and a few flitting
     along the gallery under the ceiling. The wings flap in the vertex shader. */
  const FLOCK = 9;
  const GALLERY_BATS = 5;
  const batMat = new THREE.MeshStandardMaterial({ color: 0x1a1520, roughness: 0.9, side: THREE.DoubleSide });
  batMat.onBeforeCompile = (sh) => {
    sh.uniforms.uFlap = batFlap;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uFlap;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      {
        float wing = smoothstep(0.02, 0.2, abs(transformed.x));
        float f = sin(uFlap * (17.0 + mod(float(gl_InstanceID), 3.0)) + float(gl_InstanceID) * 1.7);
        transformed.y += abs(transformed.x) * f * 1.1;
        transformed.x *= 1.0 - 0.2 * wing * abs(f);
      }`);
  };
  const batFlap = { value: 0 };
  const bats = new THREE.InstancedMesh(batGeometry(), batMat, FLOCK + GALLERY_BATS);
  bats.frustumCulled = false;
  bats.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(bats);
  const batInfo = [...Array(FLOCK + GALLERY_BATS)].map((_, i) => ({ phase: i * 2.39, speed: 0.55 + ((i * 37) % 10) / 25, r: 5 + ((i * 13) % 7), h: 6 + ((i * 7) % 5) }));
  function flyBats(t, eye) {
    batFlap.value = t;
    for (const [i, b] of batInfo.entries()) {
      let x;
      let y;
      let z;
      let dx;
      let dz;
      if (i < FLOCK) {
        // wheeling over the graveyard
        const a = t * b.speed + b.phase;
        const r = b.r + Math.sin(t * 0.7 + i) * 1.5;
        x = centre.x + Math.cos(a) * r * 1.6;
        z = centre.z + Math.sin(a) * r * 0.8;
        y = b.h + Math.sin(t * 1.3 + i) * 1.2;
        dx = -Math.sin(a) * 1.6;
        dz = Math.cos(a) * 0.8;
      } else {
        // darting back and forth along the gallery, close under the ceiling
        const k = i - FLOCK;
        const span = [[12, 54, 13.4], [12, 54, 14.8], [12, 54, 33.6], [10.8, 13.2, 20], [52.8, 55.2, 22]][k];
        const a = t * (0.32 + k * 0.05) + b.phase;
        if (k < 3) {
          x = (span[0] + span[1]) / 2 + Math.sin(a) * (span[1] - span[0]) / 2;
          z = span[2] + Math.sin(t * 2.3 + k) * 0.5;
          dx = Math.cos(a);
          dz = Math.cos(t * 2.3 + k) * 0.05;
        } else {
          x = (span[0] + span[1]) / 2 + Math.sin(t * 1.9 + k) * 0.8;
          z = span[2] + Math.sin(a) * 6;
          dx = Math.cos(t * 1.9 + k) * 0.1;
          dz = Math.cos(a);
        }
        y = WALL_H - 0.45 + Math.sin(t * 3.1 + k * 2) * 0.12;
      }
      _p.set(x, y, z);
      _e.set(Math.sin(t * 2 + i) * 0.25, Math.atan2(dx, dz), Math.sin(t * 1.7 + i) * 0.3);
      _q.setFromEuler(_e);
      _s.setScalar(i < FLOCK ? 1.5 : 1.1);
      bats.setMatrixAt(i, _m.compose(_p, _q, _s));
    }
    bats.instanceMatrix.needsUpdate = true;
  }

  let cullAt = 0;
  let power = false;
  let flash = 0;
  let dip = 0;
  let nextFlash = 6 + Math.random() * 10;
  const world = {
    scene,
    M,
    solids,
    placeProps,
    targets,
    doors,
    props,
    yard,
    get power() {
      return power;
    },
    setPower(on) {
      power = on;
    },
    setDoor(id, open) {
      const dd = doors.get(id);
      if (!dd) return;
      dd.want = open ? 1 : 0;
      dd.solid.on = !open;
    },
    lessRain() {
      drops = Math.floor(drops / 3);
      rainGeo.setDrawRange(0, drops * 2);
    },
    setPadlocks(n) {
      const dd = doors.get('front');
      if (!dd) return;
      dd.locks.forEach((l, i) => (l.visible = i < 3 ? i >= n : n < 3));
    },
    onThunder: null,
    // a moment where the lamps stutter and nearly go out
    dip(sec) {
      dip = Math.max(dip, sec);
    },
    update(dt, t, brightness, eye) {
      if (eye) {
        night.visible = eye.x > yard.x0 - 4 && eye.x < yard.x1 + 4 && eye.z > yard.z0 - 4 && eye.z < yard.z1 + 4;
        // a few times a second: hide still things lost in the fog (how far depends on the brightness setting)
        if ((cullAt = (cullAt + 1) % 8) === 0) cullFar(far, eye, 1.7 / scene.fog.density);
      }
      flyBats(t, eye);
      // doors swing
      for (const dd of doors.values()) {
        dd.open += (dd.want - dd.open) * Math.min(1, dt * 5);
        for (const { pivot, side } of dd.leaves) pivot.rotation.y = side * dd.open * 1.75;
      }
      // rain falls
      const a = rainGeo.attributes.position.array;
      for (let i = 0; i < drops; i++) {
        let y = a[i * 6 + 1] - dt * 11;
        if (y < 0) y += 9;
        a[i * 6 + 1] = y;
        a[i * 6 + 4] = y - 0.45;
      }
      rainGeo.attributes.position.needsUpdate = true;
      // lightning now and then
      nextFlash -= dt;
      if (nextFlash <= 0) {
        flash = 1;
        nextFlash = 9 + Math.random() * 18;
        world.onThunder && world.onThunder();
      }
      flash = Math.max(0, flash - dt * 2.8);
      const strobe = flash > 0 ? flash * (0.6 + 0.4 * Math.sin(t * 60)) : 0;
      // the portraits change while the lightning lasts
      const wrong = flash > 0.15 || dip > 0;
      for (const pm of paintings) pm.map = wrong ? pm.userData.haunted : pm.userData.calm;
      moon.intensity = 0.05 * brightness + strobe * 2.2;
      moonGlow.intensity = 6 + 8 * brightness + strobe * 40;
      hemi.intensity = 0.05 + 0.3 * brightness + strobe * 0.2;
      // lamps flicker, and now and then the power dips
      dip = Math.max(0, dip - dt);
      const dipK = dip > 0 ? (Math.sin(t * 37) * Math.sin(t * 11) > 0.3 ? 0.35 : 0.03) : 1;
      for (const s of sources) {
        if (s.spark) s.now = power ? s.base * (Math.random() < 0.25 ? 1.6 : 0.3 + Math.random() * 0.4) * dipK : 0;
        else if (s.power) {
          const f = 0.85 + 0.15 * Math.sin(t * 13 + s.phase) * Math.sin(t * 3.1 + s.phase * 2);
          const blink = Math.sin(t * 0.7 + s.phase) > 0.985 ? 0.2 : 1;
          s.now = power ? s.base * f * blink * dipK : 0;
        } else s.now = s.base * (0.8 + 0.2 * Math.sin(t * 9 + s.phase) * Math.sin(t * 5.3 + s.phase));
      }
      bulbMat.emissiveIntensity = power ? 3 * dipK : 0;
      lampGlowMat.opacity = power ? 0.5 * dipK : 0;
      glowMat.uniforms.opacity.value = 0.45 + 0.1 * Math.sin(t * 7.7);
      glowMat.uniforms.time.value = t;
      // the nearest burning sources get the real lights
      if (eye) {
        const lit = sources.filter((s) => s.now > 0.01);
        // a pumpkin's candle counts as further off than it is, and only two of them get a real light
        for (const s of lit) s.d = ((s.x - eye.x) ** 2 + (s.z - eye.z) ** 2) * (s.weak ? 3 : 1);
        lit.sort((a, b) => a.d - b.d);
        const want = [];
        let weak = 0;
        for (const s of lit) {
          if (want.length >= POOL) break;
          if (s.weak && weak >= 2) continue;
          weak += s.weak ? 1 : 0;
          want.push(s);
        }
        for (const slot of pool) if (slot.src && !want.includes(slot.src)) slot.src = null;
        for (const s of want) {
          if (pool.some((slot) => slot.src === s)) continue;
          const slot = pool.find((q) => !q.src);
          slot.src = s;
          slot.fade = 0;
          slot.light.position.set(s.x, s.y, s.z);
          slot.light.color.setHex(s.color);
          slot.light.distance = s.range;
          slot.light.decay = s.decay;
        }
        for (const slot of pool) {
          slot.fade = Math.min(1, slot.fade + dt * 3);
          slot.light.intensity = slot.src ? slot.src.now * slot.fade : 0;
        }
      }
      sparkMat.opacity = power ? (Math.random() < 0.3 ? 0.9 : 0.25) * dipK : 0;
      for (const g of sparkGlows) g.scale.setScalar(0.6 + Math.random() * 0.8);
    },
  };
  return world;
}

// merge a group's own child meshes by material, keeping them in the group (for things that move)
function mergeLocal(group) {
  const sets = new Map();
  for (const o of [...group.children]) {
    if (!o.isMesh) continue;
    o.updateMatrix();
    const geo = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(o.matrix);
    if (!sets.has(o.material)) sets.set(o.material, []);
    sets.get(o.material).push(geo);
    group.remove(o);
  }
  const out = [];
  for (const [mat, geos] of sets) {
    const m = new THREE.Mesh(mergeGeometries(geos), mat);
    group.add(m);
    out.push(m);
  }
  return out;
}

// hide what is further off than the fog lets you see (each thing's userData.sphere, in world space)
function cullFar(list, eye, dist) {
  for (const o of list) {
    const sp = o.userData.sphere;
    if (sp) o.visible = sp.center.distanceTo(eye) - sp.radius < dist;
  }
}

// a bat facing +z: a small body, two scalloped wings, two ears; about 0.3 m across
function batGeometry() {
  const pos = [];
  const tri = (a, b, c) => pos.push(...a, ...b, ...c);
  for (const sx of [1, -1]) {
    // the wing: a fan from the shoulder to the wrist, the tip and the scalloped trailing edge
    const rim = [[0.02, 0, 0.03], [0.1, 0.015, 0.05], [0.2, 0, 0.0], [0.15, 0, -0.035], [0.12, 0, -0.02], [0.08, 0, -0.055], [0.05, 0, -0.035], [0.02, 0, -0.045]];
    const root = [sx * 0.015, 0, -0.005];
    for (let i = 0; i < rim.length - 1; i++) tri(root, [sx * rim[i][0], rim[i][1], rim[i][2]], [sx * rim[i + 1][0], rim[i + 1][1], rim[i + 1][2]]);
    tri([sx * 0.008, 0.018, 0.045], [sx * 0.02, 0.045, 0.05], [sx * 0.018, 0.015, 0.035]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const body = new THREE.OctahedronGeometry(1, 1).scale(0.02, 0.018, 0.055);
  body.deleteAttribute('uv');
  body.deleteAttribute('normal');
  const out = mergeGeometries([g, body]);
  out.computeVertexNormals();
  return out;
}

/* ---------- merging still things into a few meshes ----------
   One mesh per room and material: far fewer draw calls, and rooms out of view are still skipped. */
function bake(groups) {
  const sets = new Map();
  for (const g of groups) {
    g.updateMatrixWorld(true);
    g.traverse((o) => {
      if (!o.isMesh || o.isSkinnedMesh || Array.isArray(o.material)) return;
      let geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      const keep = ['position', 'normal', 'uv'];
      if (o.material.vertexColors && geo.attributes.color) keep.push('color');
      for (const n of Object.keys(geo.attributes)) if (!keep.includes(n)) geo.deleteAttribute(n);
      if (!geo.attributes.normal) geo.computeVertexNormals();
      if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
      // models can store their numbers packed; unpack so everything merges
      for (const n of keep) {
        const a = geo.attributes[n];
        if (!(a.array instanceof Float32Array) || a.normalized || a.isInterleavedBufferAttribute) {
          const f = new Float32Array(a.count * a.itemSize);
          for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) f[i * a.itemSize + k] = a.getComponent(i, k);
          geo.setAttribute(n, new THREE.BufferAttribute(f, a.itemSize));
        }
      }
      geo.morphAttributes = {};
      geo.applyMatrix4(o.matrixWorld);
      const shadow = g.userData.shadow;
      const k = g.userData.room + '|' + o.material.uuid + '|' + shadow + '|' + keep.length;
      if (!sets.has(k)) sets.set(k, { mat: o.material, shadow, geos: [] });
      sets.get(k).geos.push(geo);
    });
  }
  const out = [];
  for (const { mat, shadow, geos } of sets.values()) {
    const m = new THREE.Mesh(mergeGeometries(geos), mat);
    m.castShadow = shadow;
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    m.geometry.computeBoundingSphere();
    m.userData.sphere = m.geometry.boundingSphere;
    out.push(m);
    for (const g of geos) g.dispose();
  }
  return out;
}

/* ---------- furniture made of boxes ----------
   Built facing +z (its front), width along x, depth along z, standing on y = 0. */
function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y + h / 2, z);
  return m;
}
function makeProp(p, M) {
  const g = new THREE.Group();
  const { w, d, h } = p;
  const legs = (mat, inset = 0.06, lh = h - 0.06, t = 0.07) => {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(t, lh, t, mat, sx * (w / 2 - inset), 0, sz * (d / 2 - inset)));
  };
  switch (p.type) {
    case 'bed': {
      g.add(box(w, 0.08, d, M.iron, 0, 0.32, 0));
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.05, 0.36, 0.05, M.iron, sx * (w / 2 - 0.03), 0, sz * (d / 2 - 0.03)));
      g.add(box(w - 0.05, 0.16, d - 0.05, M.linen, 0, 0.4, 0));
      g.add(box(w - 0.02, 0.06, d * 0.62, M.blanket, 0, 0.55, d * 0.17));
      g.add(box(w * 0.7, 0.1, 0.35, M.linen, 0, 0.56, -d / 2 + 0.25));
      g.add(box(w, 0.9, 0.05, M.iron, 0, 0.3, -d / 2));
      g.add(box(w, 0.5, 0.05, M.iron, 0, 0.3, d / 2));
      break;
    }
    case 'wardrobe': {
      g.add(box(w, h, d, M.darkWood));
      g.add(box(w + 0.08, 0.08, d + 0.06, M.oldWood, 0, h - 0.02, 0));
      g.add(box(0.02, h - 0.2, 0.02, M.iron, 0, 0.1, d / 2 + 0.005));
      for (const sx of [-1, 1]) {
        g.add(box(w / 2 - 0.12, h - 0.4, 0.02, M.oldWood, sx * (w / 4), 0.2, d / 2 + 0.005));
        g.add(box(0.03, 0.12, 0.03, M.brass, sx * 0.08, 1.1, d / 2 + 0.02));
      }
      break;
    }
    case 'dresser':
    case 'desk':
    case 'officedesk': {
      g.add(box(w, 0.05, d, M.oldWood, 0, h - 0.05, 0));
      if (p.type === 'dresser') {
        g.add(box(w - 0.04, h - 0.05, d - 0.04, M.darkWood));
        for (let i = 0; i < 3; i++) {
          g.add(box(w - 0.12, 0.22, 0.02, M.oldWood, 0, 0.1 + i * 0.27, d / 2 - 0.01));
          g.add(box(0.12, 0.03, 0.03, M.brass, 0, 0.2 + i * 0.27, d / 2 + 0.01));
        }
      } else {
        legs(M.darkWood);
        g.add(box(w * 0.4, h * 0.55, d - 0.06, M.darkWood, w * 0.28, h * 0.4, 0));
        for (let i = 0; i < 2; i++) g.add(box(0.1, 0.03, 0.03, M.brass, w * 0.28, h * 0.55 + i * 0.18, d / 2 - 0.01));
        if (p.type === 'officedesk') {
          // a lamp and papers
          g.add(box(0.5, 0.01, 0.35, M.linen, -0.3, h, 0));
          g.add(box(0.06, 0.4, 0.06, M.brass, -w / 2 + 0.2, h, -d / 2 + 0.2));
          const lockPlate = box(0.08, 0.08, 0.02, M.brass, w * 0.28, h * 0.72, d / 2 + 0.005);
          g.add(lockPlate);
        }
      }
      break;
    }
    case 'table': {
      g.add(box(w, 0.06, d, M.oldWood, 0, h - 0.06, 0));
      legs(M.darkWood);
      break;
    }
    case 'longtable': {
      g.add(box(w, 0.07, d, M.oldWood, 0, h - 0.07, 0));
      legs(M.darkWood, 0.1);
      for (let i = 0; i < 6; i++) {
        const z = -d / 2 + 0.5 + i * ((d - 1) / 5);
        for (const sx of [-1, 1]) {
          const ch = new THREE.Group();
          ch.add(box(0.42, 0.04, 0.42, M.darkWood, 0, 0.44, 0));
          ch.add(box(0.42, 0.5, 0.04, M.darkWood, 0, 0.46, 0.2));
          for (const a of [-1, 1]) for (const b of [-1, 1]) ch.add(box(0.04, 0.44, 0.04, M.darkWood, a * 0.18, 0, b * 0.18));
          ch.position.set(sx * (w / 2 + 0.35), 0, z);
          ch.rotation.y = sx > 0 ? Math.PI / 2 : -Math.PI / 2;
          g.add(ch);
        }
        g.add(box(0.2, 0.02, 0.2, M.porcelain, 0, h, z));
      }
      break;
    }
    case 'shelf': {
      g.add(box(w, h, 0.04, M.darkWood, 0, 0, -d / 2 + 0.02));
      for (const sx of [-1, 1]) g.add(box(0.05, h, d, M.darkWood, sx * (w / 2 - 0.025), 0, 0));
      for (let i = 0; i < 5; i++) {
        const y = 0.05 + i * ((h - 0.1) / 4.6);
        g.add(box(w - 0.1, 0.03, d - 0.04, M.oldWood, 0, y, 0));
        if (i < 5) {
          let x = -w / 2 + 0.1;
          let k = i * 7;
          while (x < w / 2 - 0.15) {
            const bw = 0.04 + ((k * 37) % 7) * 0.012;
            const bh = 0.24 + ((k * 13) % 5) * 0.03;
            if ((k * 7) % 11 !== 0) g.add(box(bw, bh, d - 0.12, M.book[k % M.book.length], x + bw / 2, y + 0.03, 0.02));
            x += bw + 0.005;
            k++;
          }
        }
      }
      break;
    }
    case 'cabinet': {
      g.add(box(w, h, d, M.darkWood));
      g.add(box(w - 0.1, h * 0.55, 0.02, M.oldWood, 0, h * 0.4, d / 2));
      g.add(box(0.04, 0.12, 0.03, M.brass, w * 0.3, h * 0.6, d / 2 + 0.02));
      for (let i = 0; i < 2; i++) g.add(box(w - 0.1, 0.18, 0.02, M.oldWood, 0, 0.05 + i * 0.22, d / 2));
      break;
    }
    case 'stove': {
      g.add(box(w, h, d, M.iron));
      g.add(box(w - 0.2, 0.4, 0.02, M.rust, 0, 0.2, d / 2 + 0.005));
      g.add(box(0.6, 0.02, 0.03, M.brass, 0, 0.62, d / 2 + 0.02));
      g.add(box(0.2, 1.6, 0.2, M.iron, w / 2 - 0.2, h, -d / 2 + 0.15));
      for (const sx of [-0.3, 0.3]) {
        const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.14, 0.2, 14), M.rust);
        pot.position.set(sx, h + 0.1, 0);
        g.add(pot);
      }
      break;
    }
    case 'sink': {
      g.add(box(w, h - 0.15, d, M.darkWood));
      g.add(box(w, 0.15, d, M.porcelain, 0, h - 0.15, 0));
      g.add(box(0.05, 0.3, 0.05, M.brass, 0, h, -d / 2 + 0.08));
      break;
    }
    case 'crate': {
      g.add(box(w, h, d, M.oldWood));
      for (const y of [0.1, h - 0.15]) g.add(box(w + 0.02, 0.08, d + 0.02, M.darkWood, 0, y, 0));
      break;
    }
    case 'barrel': {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(w / 2 - 0.04, w / 2 - 0.08, h, 16), M.oldWood);
      b.position.y = h / 2;
      g.add(b);
      for (const y of [0.15, h - 0.15]) {
        const hoop = new THREE.Mesh(new THREE.TorusGeometry(w / 2 - 0.05, 0.015, 6, 20), M.iron);
        hoop.rotation.x = Math.PI / 2;
        hoop.position.y = y;
        g.add(hoop);
      }
      break;
    }
    case 'pew': {
      g.add(box(w, 0.06, 0.45, M.oldWood, 0, 0.45, 0.05));
      g.add(box(w, 0.5, 0.05, M.oldWood, 0, 0.5, -0.2));
      for (const sx of [-1, 1]) g.add(box(0.06, 0.95, d, M.darkWood, sx * (w / 2 - 0.03), 0, 0));
      break;
    }
    case 'altar': {
      g.add(box(w, h, d, M.stoneProp));
      g.add(box(w + 0.1, 0.02, d + 0.1, M.altarCloth, 0, h, 0));
      g.add(box(w * 0.6, 0.6, 0.02, M.altarCloth, 0, h - 0.6, d / 2 + 0.05));
      for (const sx of [-0.7, 0.7]) addCandle(g, M, sx, h, 0, 0.35);
      break;
    }
    case 'candles': {
      g.add(box(0.06, 1.1, 0.06, M.brass, 0, 0, 0));
      g.add(box(0.3, 0.03, 0.3, M.brass, 0, 0, 0));
      for (const [x, z] of [[0, 0], [0.12, 0.05], [-0.1, 0.06]]) addCandle(g, M, x, 1.1, z, 0.12 + Math.abs(x));
      break;
    }
    case 'boiler': {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 2.2, 20), M.rust);
      b.position.y = 1.1;
      g.add(b);
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.4, 10), M.iron);
      pipe.position.set(0, 2.8, 0);
      g.add(pipe);
      const gauge = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.04, 14), M.brass);
      gauge.rotation.x = Math.PI / 2;
      gauge.position.set(0, 1.4, 0.86);
      g.add(gauge);
      break;
    }
    case 'basket': {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(w / 2, w / 2 - 0.08, h, 14), M.oldWood);
      b.position.y = h / 2;
      g.add(b);
      g.add(box(w - 0.1, 0.15, d - 0.05, M.linen, 0, h - 0.05, 0));
      break;
    }
    case 'tub': {
      g.add(box(w, h, d, M.porcelain));
      g.add(box(w - 0.12, 0.05, d - 0.12, M.chalk, 0, h - 0.04, 0));
      break;
    }
    case 'curtain': {
      g.add(box(0.03, h, 0.03, M.iron, -w / 2, 0, d / 2));
      g.add(box(0.03, 0.03, d, M.iron, -w / 2, h, 0));
      const cloth = new THREE.Mesh(new THREE.PlaneGeometry(d, h - 0.2, 16, 1), M.curtain);
      const pos = cloth.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin(pos.getX(i) * 9) * 0.05);
      cloth.rotation.y = Math.PI / 2;
      cloth.position.set(-w / 2, h / 2 + 0.05, 0);
      g.add(cloth);
      g.add(box(w - 0.2, 0.5, d - 0.2, M.linen, 0.1, 0, 0));
      break;
    }
    case 'chalkboard': {
      g.add(box(w, h, 0.05, M.chalk, 0, 0, 0));
      g.add(box(w + 0.1, 0.06, 0.1, M.darkWood, 0, -0.03, 0.04));
      break;
    }
    case 'bench': {
      g.add(box(w, 0.06, d, M.oldWood, 0, h - 0.06, 0));
      legs(M.darkWood, 0.1, h - 0.06, 0.06);
      break;
    }
    case 'well': {
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, h, 20, 1, true), M.stoneProp);
      ring.position.y = h / 2;
      g.add(ring);
      const water = new THREE.Mesh(new THREE.CircleGeometry(0.85, 20), M.chalk);
      water.rotation.x = -Math.PI / 2;
      water.position.y = 0.3;
      g.add(water);
      for (const sx of [-0.85, 0.85]) g.add(box(0.1, 1.6, 0.1, M.darkWood, sx, h, 0));
      g.add(box(1.9, 0.1, 0.1, M.darkWood, 0, h + 1.5, 0));
      break;
    }
    case 'grave': {
      const s = box(w, h, d, M.stoneProp);
      s.rotation.z = (p.id % 3) * 0.06 - 0.06;
      g.add(s);
      const top = new THREE.Mesh(new THREE.CylinderGeometry(w / 2, w / 2, d, 16, 1, false, 0, Math.PI), M.stoneProp);
      top.rotation.x = Math.PI / 2;
      top.rotation.y = Math.PI / 2;
      top.position.y = h;
      top.rotation.order = 'YXZ';
      g.add(top);
      break;
    }
    case 'tree': {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.32, h, 8), M.bark);
      trunk.position.y = h / 2;
      g.add(trunk);
      for (let i = 0; i < 6; i++) {
        const br = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.08, 1.8, 5), M.bark);
        br.position.set(Math.cos(i * 1.7) * 0.5, h * 0.6 + i * 0.3, Math.sin(i * 1.7) * 0.5);
        br.rotation.set(Math.sin(i * 2.1) * 0.9, i, Math.cos(i * 1.3) * 0.9);
        g.add(br);
      }
      break;
    }
    case 'fusebox': {
      g.add(box(w, h, d, M.iron));
      g.add(box(w - 0.1, h - 0.1, 0.02, M.rust, 0, 0.05, d / 2));
      g.add(box(0.1, 0.1, 0.04, M.brass, 0, h * 0.5, d / 2 + 0.02));
      // the cable to the ceiling
      g.add(box(0.04, 3.4 - 1.1 - h, 0.04, M.iron, w * 0.3, h, 0));
      break;
    }
    case 'painting': {
      const pm = paintings[p.id % paintings.length];
      const pic = new THREE.Mesh(new THREE.PlaneGeometry(w, h), pm);
      pic.position.set(0, h / 2, d / 2 + 0.01);
      g.add(pic);
      g.add(box(w, h, 0.03, M.darkWood));
      break;
    }
    case 'clock': {
      // a tall case clock that ticks in the hall
      g.add(box(w, 0.5, d, M.darkWood));
      g.add(box(w * 0.8, h - 0.95, d * 0.85, M.darkWood, 0, 0.5, 0));
      g.add(box(w, 0.45, d, M.darkWood, 0, h - 0.45, 0));
      g.add(box(w * 0.5, h - 1.25, 0.02, M.chalk, 0, 0.65, d * 0.43));
      const face = new THREE.Mesh(new THREE.CircleGeometry(0.2, 20), M.porcelain);
      face.position.set(0, h - 0.23, d / 2 + 0.01);
      g.add(face);
      for (const [len, a] of [[0.15, 0.6], [0.11, 2.4]]) {
        const hand = box(0.015, len, 0.01, M.iron, 0, 0, 0);
        hand.geometry.translate(0, -len / 2, 0);
        hand.position.set(0, h - 0.23, d / 2 + 0.02);
        hand.rotation.z = a;
        g.add(hand);
      }
      g.add(box(0.12, 0.12, 0.02, M.brass, 0, 0.9, d * 0.43 + 0.02));
      break;
    }
    case 'slab': {
      // the Doctor's operating table, with leather straps
      g.add(box(w, 0.12, d, M.iron, 0, h - 0.12, 0));
      g.add(box(w - 0.1, 0.06, d - 0.1, M.linen, 0, h, 0));
      for (const z of [-0.6, 0, 0.6]) g.add(box(w + 0.04, 0.03, 0.1, M.leather, 0, h + 0.03, z));
      legs(M.iron, 0.12, h - 0.12, 0.08);
      break;
    }
    case 'coil': {
      // a tall coil of copper on a stone base, with a ball on top
      g.add(box(w, 0.3, d, M.stoneProp));
      const core = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, h - 0.6, 10), M.iron);
      core.position.y = 0.3 + (h - 0.6) / 2;
      g.add(core);
      for (let i = 0; i < 9; i++) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16 - i * 0.008, 0.025, 6, 16), M.copper);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 0.45 + i * 0.12;
        g.add(ring);
      }
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 10), M.copper);
      ball.position.y = h - 0.15;
      g.add(ball);
      break;
    }
    case 'cobweb': {
      // a web across the top corner behind and to the left (for face S: the north-west corner),
      // sagging a little, sometimes with a spider on it or one hanging below on its thread
      const x0 = -w / 2;
      const z0 = -d / 2;
      g.add(new THREE.Mesh(web([x0 + w * 0.95, h, z0], [x0, h, z0 + d * 0.95], [x0, h - h * 0.95, z0], [0.04, 0.04, -0.04]), M.cobweb));
      g.add(new THREE.Mesh(web([x0 + w * 0.6, h, z0], [x0, h, z0 + d * 0.55], [x0, h - h * 0.6, z0], [0.06, 0.03, -0.06]), M.cobweb));
      if (p.id % 3 === 0) addSpider(g, M, x0 + 0.24, h - 0.22, z0 + 0.24, 1);
      else if (p.id % 3 === 1) {
        const drop = 0.5 + (p.id % 5) * 0.08;
        g.add(box(0.004, drop, 0.004, M.cobweb, x0 + 0.35, h - drop, z0 + 0.35));
        addSpider(g, M, x0 + 0.35, h - drop - 0.02, z0 + 0.35, 0);
      }
      break;
    }
    case 'archweb': {
      // webs in both top corners of an archway, in its plane
      for (const sx of [-1, 1]) g.add(new THREE.Mesh(web([sx * (w / 2 - 0.75), h, 0], [sx * (w / 2), h - h, 0], [sx * (w / 2), h, 0], [0, 0, 0.03]), M.cobweb));
      if (p.id % 2) addSpider(g, M, w / 2 - 0.18, h - 0.16, 0.01, 2);
      break;
    }
    // plain stand-ins for the decorations, used only when their models are missing
    case 'jack':
    case 'tablejack':
    case 'pumpkin': {
      const b = new THREE.Mesh(new THREE.SphereGeometry(w / 2, 14, 10), M.pumpkin);
      b.scale.y = h / w;
      b.position.y = h / 2;
      g.add(b);
      break;
    }
    case 'rug':
      g.add(box(w, 0.01, d, M.blanket, 0, 0.005, 0));
      break;
    case 'fence':
      for (let i = 0; i < 5; i++) g.add(box(0.04, h, 0.04, M.iron, -w / 2 + 0.1 + i * ((w - 0.2) / 4), 0, 0));
      g.add(box(w, 0.04, 0.04, M.iron, 0, h * 0.8, 0));
      break;
    case 'coffin':
    case 'crypt':
    case 'urn':
      g.add(box(w, h, d, p.type === 'coffin' ? M.darkWood : M.stoneProp));
      break;
    default:
      g.add(box(w, h, d, M.oldWood));
  }
  return g;
}
// a triangle of web: a, b along the ceiling (or lintel), c down the corner; sag pushes the middle out
function web(a, b, c, sag) {
  const n = 4;
  const pos = [];
  const uv = [];
  const P = (i, j) => {
    // barycentric point i/n of the way from c to a, j/n from c to b
    const u = i / n;
    const v = j / n;
    const k = u * v * (1 - u - v) * 6;
    return [c[0] + (a[0] - c[0]) * u + (b[0] - c[0]) * v + sag[0] * k, c[1] + (a[1] - c[1]) * u + (b[1] - c[1]) * v + sag[1] * k, c[2] + (a[2] - c[2]) * u + (b[2] - c[2]) * v + sag[2] * k];
  };
  // the sheet's corners: c at the bottom middle of the painted web, a top right, b top left
  const T = (i, j) => [0.5 + (i / n) * 0.5 - (j / n) * 0.5, (i + j) / n];
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n - i; j++) {
      const quad = [[i, j], [i + 1, j], [i, j + 1]];
      for (const [x, y] of quad) (pos.push(...P(x, y)), uv.push(...T(x, y)));
      if (i + j < n - 1) for (const [x, y] of [[i + 1, j], [i + 1, j + 1], [i, j + 1]]) (pos.push(...P(x, y)), uv.push(...T(x, y)));
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}
// a spider: two round parts and eight bent legs. on: 0 hanging, 1 on a corner web, 2 on an upright web
function addSpider(g, M, x, y, z, on) {
  const s = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), M.spider);
  body.scale.set(1, 0.8, 1.25);
  body.position.z = -0.04;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 5), M.spider);
  head.position.z = 0.015;
  s.add(body, head);
  for (const sx of [-1, 1])
    for (let i = 0; i < 4; i++) {
      const a = (i - 1.5) * 0.45;
      const upper = box(0.006, 0.006, 0.06, M.spider, 0, 0, 0);
      upper.geometry.translate(0, 0, 0.03);
      upper.position.set(sx * 0.012, 0.005, 0.0);
      upper.rotation.set(-0.5, sx * (Math.PI / 2 - a), 0, 'YXZ');
      const lower = box(0.005, 0.005, 0.07, M.spider, 0, 0, 0);
      lower.geometry.translate(0, 0, 0.035);
      lower.position.set(sx * (0.012 + Math.cos(a) * 0.05), 0.03, Math.sin(a) * 0.05);
      lower.rotation.set(0.9, sx * (Math.PI / 2 - a), 0, 'YXZ');
      s.add(upper, lower);
    }
  if (on === 1) {
    s.lookAt(1, -1, 1);
    s.rotateX(Math.PI / 2);
  }
  if (on === 2) s.rotation.x = Math.PI / 2;
  s.position.set(x, y, z);
  s.scale.setScalar(1.3);
  g.add(s);
}
function addCandle(g, M, x, y, z, hgt) {
  const c = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.028, hgt, 8), M.wax);
  c.position.set(x, y + hgt / 2, z);
  g.add(c);
  const f = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 6), M.flame);
  f.scale.y = 2;
  f.position.set(x, y + hgt + 0.03, z);
  g.add(f);
}
