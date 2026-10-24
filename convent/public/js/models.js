// Models from /assets/models, listed in /assets/models/models.json. Each kind of furniture can name a
// .glb file; it is turned to face the right way and sized to the same footprint as the built shape it
// replaces, so walls, hiding places and bumping into things stay exactly the same. Anything not
// listed (or a file that fails to load) keeps the built shape.
//
//   { "props":  { "bed": { "file": "furniture/bedSingle.glb", "turn": 180, "fit": "stretch" },
//                 "grave": { "files": ["graveyard/a.glb", "graveyard/b.glb"] } },
//     "player": { "file": "characters/Worker.glb", "height": 1.75, "turn": 0, "tint": "Shirt" },
//     "zombie": { "files": ["characters/Zombie_Male.glb"], "height": 1.8 },
//     "recolor": { "wood": "#4a3322" } }
//
// fit: "stretch" fills the footprint exactly; "contain" (the default) keeps the model's proportions
// inside it; "height" keeps proportions and matches the height only. "raise" lifts it (metres),
// "tone" darkens and greys its colours to suit the house (0 to 1, default 0.35).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { track } from './loading.js';

const loader = new GLTFLoader();
const files = new Map();
const loadFile = (url) => {
  if (!files.has(url)) files.set(url, track(loader.loadAsync(url)).catch((e) => (console.warn('model failed to load:', url, e.message), null)));
  return files.get(url);
};

export const manifest = fetch('/assets/models/models.json')
  .then((r) => (r.ok ? r.json() : {}))
  .catch(() => ({}));

// make bright game colours fit a dark old house, once per material
const toned = new WeakSet();
// "recolor" in models.json repaints materials by name first (old dark wood instead of pine)
function tone(root, amount, recolor = {}) {
  const grey = new THREE.Color(0x777068);
  root.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of [].concat(o.material)) {
      if (toned.has(m)) continue;
      toned.add(m);
      if (m.color && recolor[m.name]) m.color.set(recolor[m.name]);
      if (m.color) m.color.lerp(grey, amount * 0.5).multiplyScalar(1 - amount * 0.4);
      // without reflections around, metal looks black: keep it mostly matte
      if (m.metalness != null) m.metalness = Math.min(m.metalness, 0.3);
      if (m.roughness != null) m.roughness = Math.max(m.roughness, 0.6);
    }
  });
}

// a ready model for every prop type that has one: prop -> THREE.Object3D (or null)
export async function propModels() {
  const all = await manifest;
  const list = all.props || {};
  const ready = {};
  await Promise.all(
    Object.entries(list).map(async ([type, spec]) => {
      const urls = spec.files || [spec.file];
      const scenes = (await Promise.all(urls.map((u) => loadFile('/assets/models/' + u)))).filter(Boolean).map((g) => g.scene);
      if (!scenes.length) return;
      for (const s of scenes) tone(s, spec.tone ?? 0.35, all.recolor);
      ready[type] = { spec, scenes };
    }),
  );
  if (!Object.keys(ready).length) return null;
  return (p) => {
    const r = ready[p.type];
    if (!r) return null;
    return fitted(r.scenes[p.id % r.scenes.length], r.spec, p);
  };
}

// a copy of the model, built facing +z, its footprint w (x) by d (z), h tall, standing on y = 0
function fitted(scene, spec, { w, d, h }) {
  const inner = scene.clone(true);
  inner.rotation.y = THREE.MathUtils.degToRad(spec.turn || 0);
  const mid = new THREE.Group();
  mid.add(inner);
  mid.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(mid);
  const size = box.getSize(new THREE.Vector3());
  const sx = w / (size.x || 1);
  const sy = h / (size.y || 1);
  const sz = d / (size.z || 1);
  const fit = spec.fit || 'contain';
  const k = fit === 'height' ? sy : Math.min(sx, sy, sz);
  const scale = fit === 'stretch' ? new THREE.Vector3(sx, sy, sz) : new THREE.Vector3(k, k, k).multiplyScalar(spec.scale || 1);
  mid.scale.copy(scale);
  const centre = box.getCenter(new THREE.Vector3());
  mid.position.set(-centre.x * scale.x, -box.min.y * scale.y + (spec.raise || 0), -centre.z * scale.z);
  const g = new THREE.Group();
  g.add(mid);
  return g;
}

// animated characters for a kind ("player", "zombie"): { count, get(i) } where get loads the i-th file
// listed (only when someone needs it) as { scene, animations, spec, scale }. count is 0 when none is
// listed; get gives null when a file fails to load.
export async function characters(kind) {
  const spec = (await manifest)[kind];
  if (!spec) return { count: 0, get: async () => null };
  const urls = spec.files || [spec.file];
  const ready = new Map();
  const get = (i) => {
    const url = urls[i % urls.length];
    if (!ready.has(url))
      ready.set(
        url,
        loadFile('/assets/models/' + url).then((g) => {
          if (!g) return null;
          tone(g.scene, spec.tone ?? 0.15);
          const size = new THREE.Box3().setFromObject(g.scene).getSize(new THREE.Vector3());
          return { scene: g.scene, animations: g.animations, spec, scale: spec.height ? spec.height / (size.y || 1) : 1 };
        }),
      );
    return ready.get(url);
  };
  return { count: urls.length, get };
}

// the animation that best matches a name: exact, then contained ("CharacterArmature|Walk")
export function findClip(animations, want) {
  if (!want) return null;
  const names = [].concat(want).map((n) => n.toLowerCase());
  for (const n of names) {
    const exact = animations.find((a) => a.name.toLowerCase() === n || a.name.toLowerCase().endsWith('|' + n));
    if (exact) return exact;
  }
  for (const n of names) {
    const part = animations.find((a) => a.name.toLowerCase().includes(n));
    if (part) return part;
  }
  return null;
}
