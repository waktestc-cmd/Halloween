// Everyone who moves through the house: other players (an animated figure), the nuns and the ghosts.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { LOOKS } from '/shared/config.js';

/* ---------- players ---------- */
let figure = null;
const loading = new GLTFLoader().loadAsync('/assets/models/Soldier.glb').then((g) => (figure = g));

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
    loading.then(() => this.dress());
  }
  dress() {
    if (!figure || this.body) return;
    this.body = SkeletonUtils.clone(figure.scene);
    const tint = new THREE.Color(LOOKS[this.info.look || 0]);
    this.body.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.material = o.material.clone();
        if (o.material.name === 'VanguardBodyMat') o.material.color.copy(tint).multiplyScalar(2.2);
      }
    });
    this.body.rotation.y = Math.PI;
    this.root.add(this.body);
    this.mixer = new THREE.AnimationMixer(this.body);
    const clip = (n) => this.mixer.clipAction(figure.animations.find((a) => a.name === n));
    this.actions = [clip('Idle'), clip('Walk'), clip('Run')];
    for (const a of this.actions) {
      a.play();
      a.setEffectiveWeight(0);
    }
    this.actions[0].setEffectiveWeight(1);
    this.weights = [1, 0, 0];
  }
  set(x, z, yaw, anim, light, state) {
    this.tx = x;
    this.tz = z;
    this.tyaw = yaw;
    this.anim = anim;
    this.beam.visible = this.bulb.visible = !!light && state === 1;
    this.root.visible = state === 1;
  }
  update(dt) {
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
    if (this.mixer) {
      for (let i = 0; i < 3; i++) {
        this.weights[i] += ((i === this.anim ? 1 : 0) - this.weights[i]) * Math.min(1, dt * 6);
        this.actions[i].setEffectiveWeight(this.weights[i]);
      }
      this.mixer.update(dt);
    }
  }
  remove() {
    this.scene.remove(this.root);
  }
}

/* ---------- the nun ----------
   A tall black habit that glides rather than walks, a white wimple, a grey face with dark eyes
   that catch the light. */
function nunFace() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(128, 120, 10, 128, 128, 128);
  grd.addColorStop(0, '#b9b3a6');
  grd.addColorStop(0.7, '#7d776d');
  grd.addColorStop(1, '#3a3631');
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  // sunken eyes
  for (const x of [88, 168]) {
    const e = g.createRadialGradient(x, 110, 2, x, 110, 34);
    e.addColorStop(0, '#000');
    e.addColorStop(0.55, '#0b0806');
    e.addColorStop(1, 'rgba(30,25,20,0)');
    g.fillStyle = e;
    g.beginPath();
    g.ellipse(x, 110, 34, 26, 0, 0, Math.PI * 2);
    g.fill();
  }
  // a thin, too-wide mouth
  g.strokeStyle = '#1a0f0c';
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(80, 190);
  g.quadraticCurveTo(128, 205, 176, 188);
  g.stroke();
  g.strokeStyle = 'rgba(40,20,15,0.6)';
  g.lineWidth = 2;
  for (let i = 0; i < 9; i++) {
    g.beginPath();
    g.moveTo(84 + i * 11, 186 + Math.sin(i) * 3);
    g.lineTo(86 + i * 11, 200 + Math.sin(i) * 3);
    g.stroke();
  }
  // veins
  g.strokeStyle = 'rgba(40,30,50,0.35)';
  g.lineWidth = 1.5;
  for (let i = 0; i < 10; i++) {
    let x = 30 + Math.random() * 200;
    let y = 40 + Math.random() * 180;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 5; k++) g.lineTo((x += (Math.random() - 0.5) * 24), (y += (Math.random() - 0.5) * 24));
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const faceTex = nunFace();

export class Nun {
  constructor(scene) {
    this.root = new THREE.Group();
    const black = new THREE.MeshStandardMaterial({ color: 0x060507, roughness: 1 });
    const white = new THREE.MeshStandardMaterial({ color: 0xcfc8b8, roughness: 0.8 });
    // habit: a lathe from the hem up to the shoulders
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const y = (i / 12) * 1.55;
      const r = 0.5 - (i / 12) * 0.22 + Math.sin((i / 12) * Math.PI) * 0.03;
      pts.push(new THREE.Vector2(r, y));
    }
    pts.push(new THREE.Vector2(0.2, 1.6), new THREE.Vector2(0.1, 1.66));
    this.habitGeo = new THREE.LatheGeometry(pts, 24);
    this.habitBase = this.habitGeo.attributes.position.array.slice();
    const habit = new THREE.Mesh(this.habitGeo, black);
    this.root.add(habit);
    // white collar and wimple framing the face
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.27, 0.16, 20), white);
    collar.position.y = 1.58;
    this.root.add(collar);
    const head = new THREE.Group();
    head.position.y = 1.8;
    this.head = head;
    this.root.add(head);
    const wimple = new THREE.Mesh(new THREE.SphereGeometry(0.17, 20, 16), white);
    wimple.scale.set(1, 1.18, 1);
    head.add(wimple);
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.12, 24), new THREE.MeshStandardMaterial({ map: faceTex, roughness: 0.7 }));
    face.scale.set(0.95, 1.25, 1);
    face.position.set(0, -0.01, 0.176);
    head.add(face);
    // veil: black, hanging down the back
    // open at the front so the face shows
    const veil = new THREE.Mesh(new THREE.SphereGeometry(0.21, 20, 16, Math.PI / 2 + 1.05, Math.PI * 2 - 2.1, 0, Math.PI * 0.75), black);
    veil.scale.set(1.05, 1.2, 1.05);
    veil.position.set(0, 0.03, -0.03);
    head.add(veil);
    const drape = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.32, 0.75, 20, 1, true, Math.PI * 0.6, Math.PI * 0.8), black);
    drape.rotation.y = Math.PI;
    drape.position.set(0, -0.36, -0.02);
    head.add(drape);
    // eyes that glint when your light finds them
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffe0b0 });
    this.eyes = [];
    for (const x of [-0.042, 0.042]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.008, 6, 6), eyeMat);
      e.position.set(x, 0.012, 0.182);
      head.add(e);
      this.eyes.push(e);
    }
    // arms in long sleeves, reaching when she chases
    this.arms = [];
    for (const sx of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(sx * 0.24, 1.48, 0);
      const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.11, 0.62, 10), black);
      sleeve.position.y = -0.31;
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), new THREE.MeshStandardMaterial({ color: 0x8a8378, roughness: 0.8 }));
      hand.scale.set(0.8, 1.4, 0.6);
      hand.position.y = -0.66;
      pivot.add(sleeve, hand);
      this.root.add(pivot);
      this.arms.push(pivot);
    }
    // a small bell on her belt
    const bell = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.06, 10), new THREE.MeshStandardMaterial({ color: 0x9a7a3a, metalness: 0.9, roughness: 0.3 }));
    bell.position.set(0.2, 0.95, 0.32);
    this.root.add(bell);
    this.root.traverse((o) => o.isMesh && (o.castShadow = true));
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
  remove() {
    this.root.parent?.remove(this.root);
  }
  update(dt) {
    this.t += dt;
    const k = Math.min(1, dt * 7);
    const moved = Math.hypot(this.tx - this.x, this.tz - this.z);
    this.x += (this.tx - this.x) * k;
    this.z += (this.tz - this.z) * k;
    let d = this.tyaw - this.yaw;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    this.yaw += d * k;
    const chasing = this.state === 'chase' || this.state === 'finale';
    // a slow sway as she glides; her head tilts and twitches when she hunts
    const sway = Math.sin(this.t * (chasing ? 7 : 2.6));
    this.root.position.set(this.x, 0.02 + Math.abs(sway) * 0.03, this.z);
    this.root.rotation.y = this.yaw;
    this.root.rotation.z = sway * 0.03;
    this.head.rotation.z = chasing ? Math.sin(this.t * 17) * 0.06 + 0.2 : Math.sin(this.t * 0.5) * 0.12;
    this.head.rotation.x = chasing ? 0.15 : 0;
    for (const [i, a] of this.arms.entries()) {
      const reach = chasing ? -1.35 + Math.sin(this.t * 9 + i * 2) * 0.12 : -0.05 + Math.sin(this.t * 2 + i) * 0.04;
      a.rotation.x += (reach - a.rotation.x) * Math.min(1, dt * 4);
    }
    // the hem ripples as if over the floor
    const pos = this.habitGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = this.habitBase[i * 3 + 1];
      if (y > 0.25) continue;
      const x = this.habitBase[i * 3];
      const z = this.habitBase[i * 3 + 2];
      const a = Math.atan2(z, x);
      const w = 1 + Math.sin(a * 5 + this.t * (chasing ? 9 : 4)) * 0.06 * (1 - y / 0.25);
      pos.setX(i, x * w);
      pos.setZ(i, z * w);
    }
    pos.needsUpdate = true;
    return moved;
  }
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
