// Everyone who moves through the house: other players (in costume), the monsters and the ghosts.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { LOOKS } from '/shared/config.js';
import { characters, findClip } from './models.js';

/* ---------- players ----------
   The figure comes from models.json ("player"), or the three.js Soldier when none is listed. With
   several files listed, each player gets one of them. */
const soldier = () =>
  new GLTFLoader().loadAsync('/assets/models/Soldier.glb').then((g) => ({ scene: g.scene, animations: g.animations, scale: 1, spec: { turn: 180, tint: 'VanguardBodyMat', tintBoost: 2.2 } }));
const cast = characters('player');
// the figure for one player: one of the listed files, picked from their id so it stays the same
async function figureFor(id) {
  const c = await cast;
  return (c.count && (await c.get(hash(id)))) || soldier();
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
    figureFor(info.id || info.name).then((f) => this.dress(f)).catch((e) => console.warn('no figure', e));
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
   update() returns how far it moved this frame, which drives footsteps and sounds. */
function canvasTex(draw, w = 256, h = 256) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// a few random lines, for veins and scars
function scribble(g, n, x0, y0, w, h, step = 24) {
  for (let i = 0; i < n; i++) {
    let x = x0 + Math.random() * w;
    let y = y0 + Math.random() * h;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 5; k++) g.lineTo((x += (Math.random() - 0.5) * step), (y += (Math.random() - 0.5) * step));
    g.stroke();
  }
}
// the Count: a pale, hairless face, deep black eyes, a long nose and two rat-like front teeth
const countFace = canvasTex((g, w, h) => {
  const grd = g.createRadialGradient(128, 110, 10, 128, 128, 130);
  grd.addColorStop(0, '#cfcbb8');
  grd.addColorStop(0.65, '#9a9682');
  grd.addColorStop(1, '#4a473c');
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(60,50,70,0.35)';
  g.lineWidth = 1.5;
  scribble(g, 12, 30, 20, 200, 120);
  for (const x of [86, 170]) {
    const e = g.createRadialGradient(x, 104, 2, x, 104, 32);
    e.addColorStop(0, '#000');
    e.addColorStop(0.5, '#0b0806');
    e.addColorStop(1, 'rgba(40,30,20,0)');
    g.fillStyle = e;
    g.beginPath();
    g.ellipse(x, 104, 32, 22, x < 128 ? 0.25 : -0.25, 0, Math.PI * 2);
    g.fill();
  }
  // brow ridges
  g.strokeStyle = 'rgba(30,25,20,0.7)';
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(54, 78);
  g.quadraticCurveTo(90, 66, 118, 86);
  g.moveTo(138, 86);
  g.quadraticCurveTo(166, 66, 202, 78);
  g.stroke();
  // a long hooked nose
  g.strokeStyle = 'rgba(40,35,28,0.6)';
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(128, 104);
  g.quadraticCurveTo(140, 150, 124, 168);
  g.stroke();
  // thin lips and two long front teeth
  g.strokeStyle = '#1a0f0c';
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(96, 196);
  g.quadraticCurveTo(128, 190, 160, 196);
  g.stroke();
  g.fillStyle = '#e8e2c8';
  g.fillRect(117, 194, 9, 26);
  g.fillRect(130, 194, 9, 26);
});
// the Doctor's Monster: grey, scarred, stitched across the brow and cheek, one eye paler than the other
const creatureFace = canvasTex((g, w, h) => {
  const grd = g.createRadialGradient(128, 120, 10, 128, 128, 140);
  grd.addColorStop(0, '#9a968c');
  grd.addColorStop(0.7, '#6e6a62');
  grd.addColorStop(1, '#3c3a34');
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
  // patches of different skin
  g.fillStyle = 'rgba(120,96,90,0.35)';
  g.fillRect(150, 120, 80, 70);
  g.fillStyle = 'rgba(80,84,90,0.35)';
  g.fillRect(20, 30, 100, 50);
  // stitches
  g.strokeStyle = '#1c1612';
  g.lineWidth = 3;
  const stitch = (x0, y0, x1, y1) => {
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
    const n = Math.round(Math.hypot(x1 - x0, y1 - y0) / 14);
    const nx = -(y1 - y0) / Math.hypot(x1 - x0, y1 - y0);
    const ny = (x1 - x0) / Math.hypot(x1 - x0, y1 - y0);
    for (let i = 1; i < n; i++) {
      const x = x0 + ((x1 - x0) * i) / n;
      const y = y0 + ((y1 - y0) * i) / n;
      g.beginPath();
      g.moveTo(x - nx * 7, y - ny * 7);
      g.lineTo(x + nx * 7, y + ny * 7);
      g.stroke();
    }
  };
  stitch(20, 82, 236, 74);
  stitch(150, 120, 150, 190);
  stitch(150, 190, 230, 190);
  // heavy brow and sunken eyes, one milky
  g.fillStyle = 'rgba(25,20,16,0.8)';
  g.fillRect(50, 96, 156, 14);
  for (const [x, c] of [[90, '#0a0806'], [168, '#0a0806']]) {
    g.fillStyle = c;
    g.beginPath();
    g.ellipse(x, 124, 24, 14, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#b8b4a0';
  g.beginPath();
  g.arc(168, 124, 7, 0, Math.PI * 2);
  g.fill();
  // a grim, straight mouth
  g.strokeStyle = '#140c0a';
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(92, 206);
  g.lineTo(168, 202);
  g.stroke();
});

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

/* The Count: tall, thin and hunched in a long black coat, gliding rather than walking. A bald pale
   head with pointed ears, eyes that catch your light, long clawed fingers. He hides his face when
   your flashlight finds it. */
export class Vampire extends Monster {
  constructor(scene) {
    super(scene, 'vampire');
    const black = new THREE.MeshStandardMaterial({ color: 0x0a090c, roughness: 1 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xb8b4a0, roughness: 0.8 });
    // the long coat: a lathe from the hem up to narrow shoulders
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const y = (i / 12) * 1.62;
      const r = 0.42 - (i / 12) * 0.2 + Math.sin((i / 12) * Math.PI) * 0.02;
      pts.push(new THREE.Vector2(r, y));
    }
    pts.push(new THREE.Vector2(0.17, 1.68), new THREE.Vector2(0.08, 1.74));
    this.coatGeo = new THREE.LatheGeometry(pts, 24);
    this.coatBase = this.coatGeo.attributes.position.array.slice();
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.body.add(new THREE.Mesh(this.coatGeo, black));
    // a high stiff collar behind the head
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.16, 0.28, 18, 1, true, Math.PI * 0.75, Math.PI * 1.5), black);
    collar.position.y = 1.78;
    collar.material = black.clone();
    collar.material.side = THREE.DoubleSide;
    this.body.add(collar);
    const head = new THREE.Group();
    head.position.set(0, 1.9, 0.08);
    this.head = head;
    this.body.add(head);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.13, 18, 14), skin);
    skull.scale.set(0.9, 1.35, 1);
    head.add(skull);
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.1, 24), new THREE.MeshStandardMaterial({ map: countFace, roughness: 0.8 }));
    face.scale.set(0.95, 1.5, 1);
    face.position.set(0, -0.03, 0.122);
    head.add(face);
    for (const sx of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.16, 6), skin);
      ear.position.set(sx * 0.12, 0.04, -0.01);
      ear.rotation.set(-0.5, 0, -sx * 0.9);
      head.add(ear);
    }
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffd8a0 });
    for (const x of [-0.035, 0.035]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.007, 6, 6), eyeMat);
      e.position.set(x, 0.025, 0.13);
      head.add(e);
    }
    // long arms, long fingers
    this.arms = [];
    for (const sx of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(sx * 0.21, 1.6, 0);
      const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.72, 10), black);
      sleeve.position.y = -0.36;
      pivot.add(sleeve);
      const hand = new THREE.Group();
      hand.position.y = -0.74;
      const palm = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.03), skin);
      hand.add(palm);
      for (let f = 0; f < 4; f++) {
        const finger = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.01, 0.17, 5), skin);
        finger.position.set(-0.027 + f * 0.018, -0.12, 0);
        finger.rotation.x = 0.15;
        hand.add(finger);
      }
      pivot.add(hand);
      this.body.add(pivot);
      this.arms.push(pivot);
    }
    this.root.traverse((o) => o.isMesh && (o.castShadow = true));
  }
  update(dt) {
    const moved = this.follow(dt);
    const hunting = this.hunting;
    const flinch = this.state === 'flinch';
    // a slow sway as he glides; hunched lower and quicker when he hunts
    const sway = Math.sin(this.t * (hunting ? 7 : 2.4));
    this.root.position.y = 0.02 + Math.abs(sway) * 0.03;
    this.root.rotation.z = sway * 0.03;
    const lean = flinch ? -0.25 : hunting ? 0.28 : 0.14;
    this.body.rotation.x += (lean - this.body.rotation.x) * Math.min(1, dt * 5);
    this.head.rotation.z = hunting ? Math.sin(this.t * 15) * 0.05 + 0.15 : Math.sin(this.t * 0.5) * 0.1;
    this.head.rotation.x = hunting ? 0.2 : 0.35;
    for (const [i, a] of this.arms.entries()) {
      // reaching when he hunts; hiding his face from the light
      const reach = flinch ? -2.5 : hunting ? -1.4 + Math.sin(this.t * 9 + i * 2) * 0.12 : -0.08 + Math.sin(this.t * 2 + i) * 0.04;
      a.rotation.x += (reach - a.rotation.x) * Math.min(1, dt * (flinch ? 10 : 4));
      a.rotation.z += ((flinch ? (i ? 0.5 : -0.5) : 0) - a.rotation.z) * Math.min(1, dt * 8);
    }
    // the hem ripples over the floor
    const pos = this.coatGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = this.coatBase[i * 3 + 1];
      if (y > 0.25) continue;
      const x = this.coatBase[i * 3];
      const z = this.coatBase[i * 3 + 2];
      const w = 1 + Math.sin(Math.atan2(z, x) * 5 + this.t * (hunting ? 9 : 4)) * 0.06 * (1 - y / 0.25);
      pos.setX(i, x * w);
      pos.setZ(i, z * w);
    }
    pos.needsUpdate = true;
    return moved;
  }
}

/* The Doctor's Monster: a stitched-together giant, 2.4 m tall, in a too-small coat. Slow heavy steps
   you hear coming; arms out in front when he has seen you. */
export class Creature extends Monster {
  constructor(scene) {
    super(scene, 'creature');
    const coat = new THREE.MeshStandardMaterial({ color: 0x24201c, roughness: 1 });
    const cloth = new THREE.MeshStandardMaterial({ color: 0x1a1816, roughness: 1 });
    const skin = new THREE.MeshStandardMaterial({ color: 0x7a766c, roughness: 0.9 });
    const boot = new THREE.MeshStandardMaterial({ color: 0x0e0c0a, roughness: 0.6 });
    const part = (geo, mat, x, y, z) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      return m;
    };
    this.body = new THREE.Group();
    this.root.add(this.body);
    // legs hang from the hips
    this.legs = [];
    for (const sx of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(sx * 0.19, 1.05, 0);
      hip.add(part(new THREE.CylinderGeometry(0.14, 0.12, 0.9, 10), cloth, 0, -0.45, 0));
      hip.add(part(new THREE.BoxGeometry(0.26, 0.18, 0.4), boot, 0, -0.97, 0.06));
      this.body.add(hip);
      this.legs.push(hip);
    }
    // a broad, hunched body in a coat that doesn't fit
    this.torso = new THREE.Group();
    this.torso.position.y = 1.05;
    this.body.add(this.torso);
    const chest = part(new THREE.CylinderGeometry(0.44, 0.34, 1.0, 14), coat, 0, 0.48, 0);
    chest.scale.z = 0.62;
    this.torso.add(chest);
    const hump = part(new THREE.SphereGeometry(0.36, 14, 10), coat, 0, 0.88, -0.1);
    hump.scale.set(1.35, 0.65, 0.85);
    this.torso.add(hump);
    for (const sx of [-1, 1]) this.torso.add(part(new THREE.SphereGeometry(0.2, 12, 8), coat, sx * 0.44, 0.88, 0));
    const head = new THREE.Group();
    head.position.set(0, 1.16, 0.1);
    this.head = head;
    this.torso.add(head);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 12), skin);
    skull.scale.set(1, 1.12, 0.95);
    head.add(skull);
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.135, 24), new THREE.MeshStandardMaterial({ map: creatureFace, roughness: 0.9 }));
    face.scale.set(1, 1.15, 1);
    face.position.set(0, -0.02, 0.166);
    head.add(face);
    // dark, matted hair
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.188, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.42), cloth);
    hair.scale.set(1, 1.12, 0.97);
    hair.rotation.x = -0.25;
    head.add(hair);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xd8d0b0 });
    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.008, 6, 6), eyeMat);
    glint.position.set(0.05, 0.0, 0.172);
    head.add(glint);
    // long heavy arms and big hands
    this.arms = [];
    for (const sx of [-1, 1]) {
      const sh = new THREE.Group();
      sh.position.set(sx * 0.5, 0.88, 0);
      sh.add(part(new THREE.CylinderGeometry(0.12, 0.09, 0.82, 10), coat, 0, -0.41, 0));
      const hand = part(new THREE.SphereGeometry(0.1, 10, 8), skin, 0, -0.88, 0.02);
      hand.scale.set(1, 1.3, 0.8);
      sh.add(hand);
      this.torso.add(sh);
      this.arms.push(sh);
    }
    this.root.traverse((o) => o.isMesh && (o.castShadow = true));
    this.stride = 0;
  }
  update(dt) {
    const moved = this.follow(dt);
    const hunting = this.hunting;
    // a slow, heavy walk: the stride follows how far he really went
    this.stride += moved * 2.3;
    const walking = this.speed > 0.2;
    const swing = walking ? Math.sin(this.stride) * 0.45 : 0;
    for (const [i, leg] of this.legs.entries()) leg.rotation.x += ((i ? swing : -swing) - leg.rotation.x) * Math.min(1, dt * 10);
    this.body.position.y = walking ? Math.abs(Math.cos(this.stride)) * 0.06 : 0;
    this.torso.rotation.z = walking ? Math.sin(this.stride) * 0.06 : 0;
    this.torso.rotation.x += ((hunting ? 0.15 : 0.06) - this.torso.rotation.x) * Math.min(1, dt * 3);
    this.body.rotation.x = 0;
    for (const [i, a] of this.arms.entries()) {
      const want = hunting ? -1.4 + Math.sin(this.t * 4 + i) * 0.1 : walking ? (i ? -swing : swing) * 0.6 : 0;
      a.rotation.x += (want - a.rotation.x) * Math.min(1, dt * 4);
    }
    this.head.rotation.y = Math.sin(this.t * 0.4) * 0.2;
    // asleep on the slab until the power comes back; then he sits up and climbs off
    this.lie = this.lie ?? (this.state === 'asleep' ? 1 : 0);
    this.lie += ((this.state === 'asleep' ? 1 : 0) - this.lie) * Math.min(1, dt * 1.5);
    if (this.lie > 0.01) {
      this.body.rotation.x = (-Math.PI / 2) * this.lie;
      this.body.position.y = 1.12 * this.lie;
      this.body.position.z = 1.15 * this.lie;
    } else this.body.position.z = 0;
    // each time a foot lands
    const step = Math.floor(this.stride / Math.PI);
    this.footfall = walking && step !== this.lastStep;
    this.lastStep = step;
    return moved;
  }
}

/* The zombies: the animated zombie figures from models.json ("zombie"), shuffling slowly; a grey
   stand-in figure when there is no model. */
const zombieCast = characters('zombie');
export class Zombie extends Monster {
  constructor(scene, id = '') {
    super(scene, 'zombie');
    zombieCast
      .then((c) => (c.count ? c.get(hash(id)) : null))
      .then((f) => (f ? this.dress(f) : this.standIn()))
      .catch(() => this.standIn());
  }
  standIn() {
    if (this.gone || this.body) return;
    const m = new THREE.MeshStandardMaterial({ color: 0x5a5e52, roughness: 1 });
    this.body = new THREE.Group();
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.18, 1.1, 10), m);
    torso.position.y = 1.0;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), m);
    head.position.y = 1.68;
    this.body.add(torso, head);
    this.root.add(this.body);
  }
  dress(f) {
    if (this.gone || this.body) return;
    const spec = f.spec;
    this.body = SkeletonUtils.clone(f.scene);
    this.body.scale.setScalar(f.scale);
    this.body.rotation.y = THREE.MathUtils.degToRad(spec.turn || 0);
    this.body.traverse((o) => o.isMesh && (o.castShadow = true));
    this.root.add(this.body);
    this.mixer = new THREE.AnimationMixer(this.body);
    this.actions = [findClip(f.animations, 'idle'), findClip(f.animations, 'walk'), findClip(f.animations, 'run')].map((c) => c && this.mixer.clipAction(c));
    for (const a of this.actions) a && (a.play(), a.setEffectiveWeight(0));
    this.weights = [1, 0, 0];
    this.arms = ['UpperArm.L', 'UpperArm.R'].map((n) => this.body.getObjectByName(n)).filter(Boolean);
  }
  update(dt) {
    const moved = this.follow(dt);
    // a lurching shuffle
    this.root.rotation.z = Math.sin(this.t * 2.2) * 0.07;
    if (this.mixer) {
      const want = this.speed < 0.2 ? 0 : this.hunting ? 2 : 1;
      for (let i = 0; i < 3; i++) {
        this.weights[i] += ((i === want ? 1 : 0) - this.weights[i]) * Math.min(1, dt * 5);
        this.actions[i]?.setEffectiveWeight(this.weights[i]);
      }
      if (this.actions[1]) this.actions[1].timeScale = 0.6;
      if (this.actions[2]) this.actions[2].timeScale = 0.75;
      this.mixer.update(dt);
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

/* ---------- an item someone dropped ---------- */
export function looseItem(scene, item) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: item === 'fuse' ? 0xc0c0b0 : 0xb08a3a, metalness: 0.8, roughness: 0.3, emissive: 0x403010, emissiveIntensity: 0.6 });
  const m = item === 'fuse' ? new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.16, 10), mat) : new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.015, 6, 14), mat);
  m.rotation.z = Math.PI / 2;
  m.position.y = 0.06;
  g.add(m);
  const glint = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffd080, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
  glint.scale.set(0.5, 0.5, 1);
  glint.position.y = 0.1;
  g.add(glint);
  scene.add(g);
  return g;
}
