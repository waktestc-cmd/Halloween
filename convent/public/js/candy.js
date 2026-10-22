// Trick or treat: the wrapped sweets lying around the house. One instanced mesh draws them all, so
// forty of them cost about as much as one. They spin and bob slowly and glow a little in their own
// colour, so you can spot them in the dark. The server says where they are; walking over one picks it up.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const MAX = 64;
const COLOURS = [0xff3d6e, 0xffb703, 0x7ed321, 0x3fc5f0, 0xb980ff, 0xff7a1a];
const HEIGHT = 0.32; // how high it floats above the floor

// a sweet: a squashed ball with a twist of wrapper either side, like a bow tie
function sweetShape() {
  const body = new THREE.SphereGeometry(0.075, 14, 10);
  body.scale(1.3, 0.85, 0.85);
  const right = new THREE.ConeGeometry(0.06, 0.08, 10);
  right.rotateZ(Math.PI / 2); // the point toward the sweet, the open end outward
  right.translate(0.12, 0, 0);
  const left = new THREE.ConeGeometry(0.06, 0.08, 10);
  left.rotateZ(-Math.PI / 2);
  left.translate(-0.12, 0, 0);
  return mergeGeometries([body, right, left]);
}

// a soft round glow under each sweet
function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,0.9)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.3)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export class Candy {
  constructor(scene) {
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0.15, emissive: 0xffffff, emissiveIntensity: 0.45 });
    // glow in each sweet's own colour, not white
    mat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_COLOR\n  totalEmissiveRadiance *= vColor;\n#endif');
    };
    this.mesh = new THREE.InstancedMesh(sweetShape(), mat, MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false; // they are spread all over the house
    this.mesh.setColorAt(0, new THREE.Color()); // makes the colour buffer
    scene.add(this.mesh);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAX * 3), 3));
    geo.setDrawRange(0, 0);
    this.glow = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.55, map: glowTexture(), vertexColors: true, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.glow.frustumCulled = false;
    scene.add(this.glow);
    this.items = []; // { id, x, z, colour, phase }
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.e = new THREE.Euler();
    this.v = new THREE.Vector3();
    this.one = new THREE.Vector3(1, 1, 1);
  }
  // the whole list: [[id, x, z], ...]
  set(list) {
    this.items = [];
    for (const c of list) this.add(c, true);
    this.changed();
  }
  add([id, x, z], quiet) {
    if (this.items.length >= MAX || this.items.some((it) => it.id === id)) return;
    this.items.push({ id, x, z, colour: new THREE.Color(COLOURS[id % COLOURS.length]), phase: (id * 2.39) % (Math.PI * 2) });
    if (!quiet) this.changed();
  }
  remove(id) {
    const n = this.items.length;
    this.items = this.items.filter((it) => it.id !== id);
    if (this.items.length !== n) this.changed();
  }
  get count() {
    return this.items.length;
  }
  // colours and glows only change when a sweet comes or goes
  changed() {
    const pos = this.glow.geometry.attributes.position;
    const col = this.glow.geometry.attributes.color;
    this.items.forEach((it, i) => {
      this.mesh.setColorAt(i, it.colour);
      pos.setXYZ(i, it.x, 0.12, it.z);
      col.setXYZ(i, it.colour.r, it.colour.g, it.colour.b);
    });
    this.mesh.count = this.items.length;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    pos.needsUpdate = col.needsUpdate = true;
    this.glow.geometry.setDrawRange(0, this.items.length);
  }
  // a slow spin and a gentle bob
  update(dt, t) {
    this.items.forEach((it, i) => {
      this.e.set(0.35 * Math.sin(t * 0.9 + it.phase), t * 1.4 + it.phase, 0.25);
      this.q.setFromEuler(this.e);
      this.v.set(it.x, HEIGHT + Math.sin(t * 2 + it.phase) * 0.04, it.z);
      this.m.compose(this.v, this.q, this.one);
      this.mesh.setMatrixAt(i, this.m);
    });
    if (this.items.length) this.mesh.instanceMatrix.needsUpdate = true;
  }
}
