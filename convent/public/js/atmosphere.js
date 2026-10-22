// The house feeling alive around you: dust drifting in your flashlight beam, the edge of the screen
// closing in when a monster is near, the hall clock and dripping taps, and now and then something small
// just for you: a creak behind you, steps that stop when you turn, a book falling, a music box, a pale
// figure at the end of a corridor that is gone when you get close. None of it can hurt you.
import * as THREE from 'three';
import * as L from '/shared/level.js';

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];

/* ---------- dust in the beam ---------- */
export class Dust {
  constructor(camera, count = 700) {
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos.set([Math.random() * 8, Math.random() * 3.2, Math.random() * 8], i * 3);
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uLight: { value: 0 }, uSize: { value: 8 } },
      vertexShader: `
        uniform vec3 uCam; uniform float uTime; uniform float uLight; uniform float uSize;
        attribute float aSeed;
        varying float vA;
        void main() {
          vec3 p = position + 0.35 * vec3(sin(uTime * 0.13 + aSeed * 40.0), sin(uTime * 0.09 + aSeed * 17.0) - uTime * 0.02, cos(uTime * 0.11 + aSeed * 23.0));
          // the motes fill a box that travels with you, so there are always some around
          vec3 box = vec3(8.0, 3.2, 8.0);
          p.xz = mod(p.xz - uCam.xz + box.xz * 0.5, box.xz) - box.xz * 0.5 + uCam.xz;
          p.y = mod(p.y, box.y) + 0.05;
          vec4 mv = viewMatrix * vec4(p, 1.0);
          float d = length(mv.xyz);
          // only the ones inside the flashlight's cone catch the light
          float cone = dot(normalize(mv.xyz - vec3(0.18, -0.22, 0.1)), normalize(vec3(-0.18, 0.07, -5.1)));
          vA = smoothstep(0.83, 0.96, cone) * uLight * smoothstep(6.5, 1.2, d) * smoothstep(0.3, 0.7, d) * (0.5 + 0.5 * sin(uTime * 1.7 + aSeed * 60.0));
          gl_PointSize = uSize * (0.5 + aSeed) / max(d, 0.3);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying float vA;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float r = dot(c, c);
          if (r > 0.25 || vA < 0.01) discard;
          gl_FragColor = vec4(1.0, 0.92, 0.78, vA * (1.0 - r * 4.0) * 0.55);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.camera = camera;
  }
  resize(height) {
    this.mat.uniforms.uSize.value = (0.02 * height) / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
  }
  update(t, light) {
    const u = this.mat.uniforms;
    u.uTime.value = t;
    u.uCam.value.copy(this.camera.position);
    u.uLight.value += (light - u.uLight.value) * 0.2;
    this.points.visible = u.uLight.value > 0.02;
  }
}

/* ---------- a pale figure at the end of a corridor ---------- */
class Figure {
  constructor(scene) {
    this.mat = new THREE.MeshStandardMaterial({ color: 0xb8bcc4, emissive: 0x606a78, emissiveIntensity: 0.5, transparent: true, opacity: 0, roughness: 1, depthWrite: false });
    this.hair = new THREE.MeshBasicMaterial({ color: 0x050505, transparent: true, opacity: 0, depthWrite: false });
    const pts = [];
    for (let i = 0; i <= 10; i++) pts.push(new THREE.Vector2(0.28 - i * 0.015 + Math.sin(i * 0.9) * 0.01, i * 0.14));
    pts.push(new THREE.Vector2(0.1, 1.45));
    this.root = new THREE.Group();
    this.root.add(new THREE.Mesh(new THREE.LatheGeometry(pts, 16), this.mat));
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), this.mat);
    head.position.y = 1.58;
    head.scale.y = 1.2;
    // long dark hair hiding the face
    const hair = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.6, 12, 1, true), this.hair);
    hair.position.set(0, 1.4, 0.01);
    const fringe = new THREE.Mesh(new THREE.SphereGeometry(0.125, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.6), this.hair);
    fringe.position.y = 1.6;
    this.root.add(head, hair, fringe);
    this.root.visible = false;
    scene.add(this.root);
    this.state = null;
  }
  show(x, z, faceX, faceZ) {
    this.root.position.set(x, 0, z);
    this.root.rotation.y = Math.atan2(faceX - x, faceZ - z);
    this.root.visible = true;
    this.state = 'in';
    this.t = 0;
    this.k = 0;
  }
  // returns true the moment it vanishes
  update(dt, eye, lit) {
    if (!this.state) return false;
    this.t += dt;
    const d = Math.hypot(eye.x - this.root.position.x, eye.z - this.root.position.z);
    let gone = false;
    if (this.state === 'in') {
      this.k = Math.min(1, this.k + dt * 1.5);
      if (d < 7 || this.t > 4 || (lit && this.t > 1.2)) {
        this.state = 'out';
        gone = true;
      }
    } else {
      this.k -= dt * 3;
      if (this.k <= 0) {
        this.state = null;
        this.root.visible = false;
      }
    }
    this.mat.opacity = this.k * 0.5;
    this.hair.opacity = this.k * 0.85;
    this.root.position.y = Math.sin(this.t * 2) * 0.02;
    return gone;
  }
}

/* ---------- small events for you alone, and the sounds of the rooms ---------- */
const CLOCK = L.PROPS.find((p) => p.type === 'clock');
const BOILER = L.PROPS.find((p) => p.type === 'boiler');
const TAPS = L.PROPS.filter((p) => p.type === 'sink' || p.type === 'tub');
const SHELVES = L.PROPS.filter((p) => p.type === 'shelf' || p.type === 'crate');
const ROOM_KEYS = Object.keys(L.ROOMS).filter((k) => k !== 'c' && k !== 'g');

export class Haunts {
  constructor(scene, sound) {
    this.sound = sound;
    this.figure = new Figure(scene);
    this.next = rand(15, 25);
    this.lastFigure = -999;
    this.lastBox = -999;
    this.t = 0;
    this.tickAt = 0;
    this.dripAt = 0;
    this.steps = null;
    this.started = false;
  }
  reset() {
    this.next = rand(15, 25);
    this.steps = null;
  }
  // me: {x, z, yaw}; calm: nothing is hunting you; gentle: the softer setting; open: can this
  // spot be seen from that one (walls and closed doors block it)
  update(dt, { me, eye, calm, gentle, playing, lit, open }) {
    const snd = this.sound;
    this.t += dt;
    const vanished = this.figure.update(dt, eye, lit);
    if (vanished && snd.ctx) snd.whoosh(0.25);
    if (!snd.ctx || !playing) return;
    if (!this.started) {
      this.started = true;
      snd.rumble(BOILER.x, BOILER.z);
    }
    // the hall clock and the dripping taps
    if (this.t > this.tickAt) {
      this.tickAt = this.t + 1;
      this.tock = !this.tock;
      if (Math.hypot(me.x - CLOCK.x, me.z - CLOCK.z) < 18) snd.tick(CLOCK.x, CLOCK.z, this.tock);
    }
    if (this.t > this.dripAt) {
      this.dripAt = this.t + rand(1.2, 3.5);
      for (const p of TAPS) if (Math.hypot(me.x - p.x, me.z - p.z) < 10 && Math.random() < 0.5) snd.drip(p.x, p.z);
    }
    // footsteps following you
    if (this.steps) {
      const s = this.steps;
      s.t -= dt;
      const turned = Math.abs(Math.atan2(Math.sin(me.yaw - s.yaw), Math.cos(me.yaw - s.yaw))) > 1.3;
      if (turned || !calm) this.steps = null;
      else if (s.t <= 0) {
        s.n--;
        s.t = 0.55 + Math.random() * 0.1;
        s.dist -= 0.5;
        const bx = me.x + Math.sin(me.yaw) * s.dist;
        const bz = me.z + Math.cos(me.yaw) * s.dist;
        snd.play('step', { at: [bx, bz], vol: 0.35, rate: 0.8 + Math.random() * 0.1 });
        if (s.n <= 0) this.steps = null;
      }
    }
    this.next -= dt;
    if (this.next > 0) return;
    this.next = gentle ? rand(45, 80) : rand(22, 45);
    if (!calm) return;
    const room = L.roomAt(me.x, me.z);
    const behind = (d) => [me.x + Math.sin(me.yaw) * d, me.z + Math.cos(me.yaw) * d];
    const options = ['creak', 'whisper'];
    if (!gentle) options.push('steps', 'steps');
    const shelf = SHELVES.find((p) => Math.hypot(p.x - me.x, p.z - me.z) < 8 && open(me.x, me.z, p.x, p.z));
    if (shelf) options.push('thud', 'thud');
    if (this.t - this.lastBox > 120) options.push('musicbox');
    const sight = !gentle && this.t - this.lastFigure > 150 && this.sightline(me, open);
    if (sight) options.push('figure', 'figure');
    const what = pick(options);
    if (what === 'creak') snd.creak(...behind(2.5));
    if (what === 'whisper') {
      const side = Math.random() < 0.5 ? 1 : -1;
      snd.whisper(me.x + Math.cos(me.yaw) * side * 0.8, me.z - Math.sin(me.yaw) * side * 0.8, 0.3);
    }
    if (what === 'steps') this.steps = { n: 3 + Math.floor(Math.random() * 2), t: 0.2, dist: 4, yaw: me.yaw };
    if (what === 'thud') snd.thud(shelf.x, shelf.z, 0.45);
    if (what === 'musicbox') {
      this.lastBox = this.t;
      const near = ROOM_KEYS.filter((k) => k !== room).map((k) => {
        const r = L.ROOMS[k];
        return { x: ((r.c0 + r.c1 + 1) / 2) * L.TILE, z: ((r.r0 + r.r1 + 1) / 2) * L.TILE };
      }).filter((p) => {
        const d = Math.hypot(p.x - me.x, p.z - me.z);
        return d > 6 && d < 18;
      });
      if (near.length) {
        const p = pick(near);
        snd.musicBox(p.x, p.z);
      }
    }
    if (what === 'figure') {
      this.lastFigure = this.t;
      this.figure.show(sight[0], sight[1], me.x, me.z);
    }
  }
  // a spot 10 to 15 m straight ahead, down a corridor, in plain view
  sightline(me, open) {
    const fx = -Math.sin(me.yaw);
    const fz = -Math.cos(me.yaw);
    for (let d = 15; d >= 10; d -= 1) {
      const x = me.x + fx * d;
      const z = me.z + fz * d;
      const [c, r] = L.tileOf(x, z);
      if (!L.floorTile(c, r) || L.at(c, r) === '+' || L.BLOCKED.has(c + ',' + r)) continue;
      if (open(me.x, me.z, x, z)) return [x, z];
    }
    return null;
  }
}

/* ---------- the edge of the screen closing in ---------- */
export function setDanger(el, near, hunted, t, gentle) {
  const pulse = hunted ? 0.5 + 0.5 * Math.sin(t * 9) : 0;
  const k = Math.max(near * 0.55, hunted ? 0.55 + pulse * 0.35 : 0) * (gentle ? 0.6 : 1);
  el.style.opacity = k.toFixed(3);
}
