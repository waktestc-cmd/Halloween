// The pumpkin patch in the graveyard of the house: a wooden frame with six pumpkins hanging from it,
// all the same. The winner walks up and harvests one; each bursts into a floating number, 1 to 6, and the
// 6 is the prize. Which number is in which pumpkin is dealt by the server at the moment of the pick.
import * as THREE from 'three';

const Z = 24; // the middle of the graveyard (metres)
const BX = 27; // the frame stands across the graveyard at this x, so walking in from the west you face all six
const DZ = 1.4; // between pumpkins
const BEAM_Y = 2.7;
const HANG = 1.18; // how far each pumpkin hangs below the beam, to its centre
export const START = { x: 19.2, z: Z, yaw: -Math.PI / 2 }; // just inside the west door, looking east
const REACH = 3.6;

function numberSprite(n, gold) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const glow = g.createRadialGradient(128, 128, 10, 128, 128, 126);
  glow.addColorStop(0, gold ? 'rgba(255,214,90,0.95)' : 'rgba(230,236,255,0.55)');
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, 256, 256);
  g.font = '800 150px Georgia, serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 8;
  g.strokeStyle = 'rgba(20,8,0,0.9)';
  g.strokeText(String(n), 128, 138);
  g.fillStyle = gold ? '#fff6c8' : '#f1f4ff';
  g.fillText(String(n), 128, 138);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, depthTest: false }));
  s.renderOrder = 10;
  return s;
}

// one pumpkin: the model from the house when there is one, otherwise a plain round one. Own materials, so
// the one you pick can glow without the others doing it.
function makePumpkin(source) {
  const g = new THREE.Group();
  if (source) {
    const m = source.clone(true);
    m.traverse((o) => {
      if (o.isMesh) o.material = o.material.clone();
    });
    const box = new THREE.Box3().setFromObject(m);
    const size = box.getSize(new THREE.Vector3());
    const k = 0.66 / (size.y || 1);
    m.scale.multiplyScalar(k);
    box.setFromObject(m);
    const mid = box.getCenter(new THREE.Vector3());
    m.position.sub(mid);
    g.add(m);
  } else {
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.33, 26, 18), new THREE.MeshStandardMaterial({ color: 0xe2641a, roughness: 0.7, emissive: 0x3a1400 }));
    body.scale.set(1, 0.86, 1);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 0.14, 8), new THREE.MeshStandardMaterial({ color: 0x4c5a24 }));
    stem.position.y = 0.3;
    g.add(body, stem);
  }
  const mats = [];
  g.traverse((o) => o.isMesh && mats.push(o.material));
  g.userData.glow = (v) => mats.forEach((mt) => mt.emissive && (mt.emissive.setRGB(0.55 * v, 0.22 * v, 0.03 * v)));
  return g;
}

export function createPatch(scene, solids, source) {
  const root = new THREE.Group();
  root.visible = false;
  scene.add(root);
  const wood = new THREE.MeshStandardMaterial({ color: 0x2a1b10, roughness: 1 });
  const za = Z - 2.5 * DZ - 1.2;
  const zb = Z + 2.5 * DZ + 1.2;
  for (const z of [za, zb]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.24, BEAM_Y + 0.5, 0.24), wood);
    post.position.set(BX, (BEAM_Y + 0.5) / 2, z);
    post.castShadow = true;
    root.add(post);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, zb - za + 0.5), wood);
  beam.position.set(BX, BEAM_Y, Z);
  beam.castShadow = true;
  root.add(beam);
  // a warm lantern light in front of the pumpkins
  const lamp = new THREE.PointLight(0xff9a40, 2.4, 8, 2);
  lamp.position.set(BX - 2.4, 1.7, Z);
  root.add(lamp);

  const items = [];
  for (let i = 0; i < 6; i++) {
    const swing = new THREE.Group(); // pivots at the beam
    swing.position.set(BX, BEAM_Y - 0.1, Z + (i - 2.5) * DZ);
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, HANG - 0.34, 6), new THREE.MeshStandardMaterial({ color: 0x6b5a3e, roughness: 1 }));
    rope.position.y = -(HANG - 0.34) / 2;
    const pk = makePumpkin(source);
    pk.position.y = -HANG;
    pk.rotation.y = source ? -Math.PI / 2 : 0; // the carved face towards whoever walks in from the west
    const hit = new THREE.Mesh(new THREE.SphereGeometry(0.7, 10, 8), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.y = -HANG;
    hit.userData.index = i;
    swing.add(rope, pk, hit);
    root.add(swing);
    const num = numberSprite(0, false);
    num.visible = false;
    num.position.set(BX, BEAM_Y - HANG + 0.05, Z + (i - 2.5) * DZ);
    root.add(num);
    items.push({ swing, pk, hit, num, phase: Math.random() * 6, open: 0, picked: false, win: false, at: 0, openAt: 0 });
  }
  const targets = items.map((it) => it.hit);
  const ray = new THREE.Raycaster();
  const centre = new THREE.Vector2(0, 0);
  const wall = [
    { x0: BX - 0.12, x1: BX + 0.12, z0: za - 0.12, z1: za + 0.12, gallows: true },
    { x0: BX - 0.12, x1: BX + 0.12, z0: zb - 0.12, z1: zb + 0.12, gallows: true },
  ];
  let t = 0;
  let glowLight = null;

  return {
    show(on) {
      root.visible = on;
      for (const w of wall) {
        const k = solids.indexOf(w);
        if (on && k < 0) solids.push(w);
        if (!on && k >= 0) solids.splice(k, 1);
      }
      if (on) for (const it of items) Object.assign(it, { open: 0, picked: false, win: false, at: 0, openAt: 0 }), (it.pk.visible = true), (it.num.visible = false), it.pk.scale.setScalar(1), it.pk.userData.glow(0);
      if (!on && glowLight) (root.remove(glowLight), (glowLight = null));
    },
    // which pumpkin you are looking at (-1: none), once nothing has been picked
    aim(camera, open) {
      if (!open) return -1;
      ray.setFromCamera(centre, camera);
      ray.far = REACH;
      const h = ray.intersectObjects(targets, false)[0];
      return h ? h.object.userData.index : -1;
    },
    // timing follows the clock, not the frames, so a slow laptop gets the same pace
    update() {
      const now = performance.now() / 1000;
      t = now;
      for (const it of items) {
        it.swing.rotation.x = Math.sin(t * 1.25 + it.phase) * 0.06;
        it.swing.rotation.z = Math.cos(t * 0.9 + it.phase) * 0.04;
        if (it.at > 0 && now >= it.at && !it.open) {
          it.open = 1;
          it.openAt = now;
          it.num.visible = true;
        }
        if (it.open) {
          // the pumpkin bursts: it shrinks away while the number grows out of it and floats
          const e = Math.min(1, (now - it.openAt) * 2.2);
          it.pk.scale.setScalar(Math.max(0, 1 - e * 1.4));
          it.pk.visible = e < 0.72;
          const sz = (0.2 + 0.62 * Math.min(1, e * 1.3)) * (1 + (it.win ? 0.35 : 0)) * (1 + 0.05 * Math.sin(t * 3 + it.phase));
          it.num.scale.set(sz, sz, 1);
          it.num.position.y = BEAM_Y - HANG + 0.05 + e * 0.35 + Math.sin(t * 1.6 + it.phase) * 0.03;
        } else if (it.picked) {
          it.pk.userData.glow(0.7 + 0.3 * Math.sin(t * 14));
          it.pk.scale.setScalar(1 + 0.06 * Math.sin(t * 14));
        }
      }
    },
    // r: { pick, numbers, won }. The picked one goes first, the rest a moment later.
    reveal(r) {
      r.numbers.forEach((n, i) => {
        const it = items[i];
        const win = i === r.prizeAt; // the pumpkin that holds the winning number
        it.win = win;
        it.num.material.map?.dispose();
        const s = numberSprite(n, win);
        it.num.material.dispose();
        it.num.material = s.material;
        it.num.visible = false;
        const now = performance.now() / 1000;
        if (i === r.pick) {
          it.picked = true;
          it.at = now + 1.0;
        } else it.at = now + 3.2 + 0.25 * i;
      });
      if (r.won) {
        glowLight = new THREE.PointLight(0xffc233, 14, 9, 1.6);
        glowLight.position.set(BX - 0.9, BEAM_Y - HANG + 0.4, Z + (r.pick - 2.5) * DZ);
        root.add(glowLight);
      }
    },
  };
}
