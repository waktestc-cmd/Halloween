// Surfaces for the convent: two photo textures from the three.js examples (hardwood floor, brick)
// and the rest painted on canvases here, so the house needs no other image files.
import * as THREE from 'three';

const loader = new THREE.TextureLoader();
const cache = new Map();

function canvas(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  return c;
}
function tex(c, { repeat = [1, 1], srgb = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function file(url, { repeat = [1, 1], srgb = true } = {}) {
  const t = loader.load(url);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// deterministic noise so every player sees the same stains
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

function speckle(g, w, h, n, colors, size = [1, 3], alpha = 0.08) {
  for (let i = 0; i < n; i++) {
    g.globalAlpha = alpha * (0.4 + rnd());
    g.fillStyle = colors[Math.floor(rnd() * colors.length)];
    const s = size[0] + rnd() * (size[1] - size[0]);
    g.fillRect(rnd() * w, rnd() * h, s, s);
  }
  g.globalAlpha = 1;
}
function stains(g, w, h, n, color) {
  for (let i = 0; i < n; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const r = 20 + rnd() * 90;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, color);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

// an inside wall, one tile wide: old plaster above dark wooden panelling and a rail
function wallCanvas(plaster = '#8d826d') {
  return canvas(512, 870, (g, w, h) => {
    g.fillStyle = plaster;
    g.fillRect(0, 0, w, h);
    speckle(g, w, h, 5000, ['#5a5043', '#a79d86', '#6e6455'], [1, 4], 0.12);
    stains(g, w, h * 0.6, 7, 'rgba(60,48,30,0.28)');
    // damp running down from the ceiling
    for (let i = 0; i < 4; i++) {
      const x = rnd() * w;
      const grd = g.createLinearGradient(0, 0, 0, h * (0.3 + rnd() * 0.3));
      grd.addColorStop(0, 'rgba(45,38,25,0.45)');
      grd.addColorStop(1, 'rgba(45,38,25,0)');
      g.fillStyle = grd;
      g.fillRect(x, 0, 10 + rnd() * 40, h * 0.6);
    }
    // cracks
    g.strokeStyle = 'rgba(40,32,22,0.55)';
    g.lineWidth = 1.2;
    for (let i = 0; i < 3; i++) {
      let x = rnd() * w;
      let y = rnd() * h * 0.5;
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 8; k++) g.lineTo((x += (rnd() - 0.5) * 30), (y += rnd() * 25));
      g.stroke();
    }
    // panelling up to 1.1 m of 3.4 m
    const py = h * (1 - 1.1 / 3.4);
    g.fillStyle = '#3a2618';
    g.fillRect(0, py, w, h - py);
    for (let x = 0; x < w; x += 4) {
      g.fillStyle = `rgba(${20 + rnd() * 30},${12 + rnd() * 15},${6 + rnd() * 8},0.25)`;
      g.fillRect(x, py, 2, h - py);
    }
    g.strokeStyle = '#1e130b';
    g.lineWidth = 6;
    for (const x0 of [16, w / 2 + 8]) g.strokeRect(x0, py + 28, w / 2 - 40, h - py - 60);
    g.fillStyle = '#4a3220';
    g.fillRect(0, py - 10, w, 18);
    g.fillStyle = '#21150c';
    g.fillRect(0, py + 8, w, 4);
    g.fillRect(0, h - 22, w, 22);
  });
}

function stoneCanvas() {
  return canvas(512, 512, (g, w, h) => {
    g.fillStyle = '#4a4741';
    g.fillRect(0, 0, w, h);
    const s = w / 4;
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 4; x++) {
        const v = 60 + rnd() * 30;
        g.fillStyle = `rgb(${v},${v - 3},${v - 8})`;
        g.fillRect(x * s + 3, y * s + 3, s - 6, s - 6);
      }
    speckle(g, w, h, 6000, ['#2c2a26', '#77736a'], [1, 3], 0.18);
    stains(g, w, h, 6, 'rgba(25,22,18,0.35)');
  });
}
function tileCanvas() {
  return canvas(512, 512, (g, w, h) => {
    const s = w / 8;
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++) {
        g.fillStyle = (x + y) % 2 ? '#2a2724' : '#8a8273';
        g.fillRect(x * s, y * s, s, s);
      }
    g.strokeStyle = 'rgba(20,18,15,0.6)';
    g.lineWidth = 3;
    for (let i = 0; i <= 8; i++) {
      g.beginPath();
      g.moveTo(i * s, 0);
      g.lineTo(i * s, h);
      g.moveTo(0, i * s);
      g.lineTo(w, i * s);
      g.stroke();
    }
    stains(g, w, h, 8, 'rgba(30,25,15,0.4)');
    speckle(g, w, h, 3000, ['#111', '#bbb'], [1, 2], 0.08);
  });
}
function groundCanvas() {
  return canvas(512, 512, (g, w, h) => {
    g.fillStyle = '#1d2117';
    g.fillRect(0, 0, w, h);
    speckle(g, w, h, 14000, ['#2c3322', '#14170f', '#3a3a2a', '#2a2418'], [1, 4], 0.35);
    stains(g, w, h, 10, 'rgba(10,10,6,0.5)');
  });
}
function ceilingCanvas() {
  return canvas(256, 256, (g, w, h) => {
    g.fillStyle = '#4e463b';
    g.fillRect(0, 0, w, h);
    speckle(g, w, h, 3000, ['#2e281f', '#6a6152'], [1, 3], 0.15);
    stains(g, w, h, 5, 'rgba(30,24,15,0.4)');
    g.fillStyle = '#24170d';
    g.fillRect(0, h / 2 - 14, w, 28);
  });
}
function woodCanvas(base = '#3b2616') {
  return canvas(256, 256, (g, w, h) => {
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 2) {
      g.fillStyle = `rgba(${10 + rnd() * 25},${6 + rnd() * 12},${2 + rnd() * 6},${0.15 + rnd() * 0.2})`;
      g.fillRect(0, y, w, 1 + rnd() * 2);
    }
    speckle(g, w, h, 600, ['#120a05', '#5a3c25'], [1, 3], 0.2);
  });
}
function clothCanvas(color) {
  return canvas(128, 128, (g, w, h) => {
    g.fillStyle = color;
    g.fillRect(0, 0, w, h);
    speckle(g, w, h, 2500, ['#000', '#fff'], [1, 2], 0.05);
    stains(g, w, h, 3, 'rgba(60,50,30,0.25)');
  });
}
// gloomy portraits in gilt frames: dark figures with pale faces, nothing recognisable
export function portraitCanvas(i, haunted = false) {
  seed = 99 + i * 31;
  return canvas(256, 192, (g, w, h) => {
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, ['#2b2418', '#1d2422', '#2a1d1a'][i % 3]);
    bg.addColorStop(1, '#0b0906');
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    if (i % 2 === 0) {
      // a figure in a veil
      g.fillStyle = '#0a0806';
      g.beginPath();
      g.ellipse(w / 2, h * 0.95, w * 0.3, h * 0.55, 0, Math.PI, 0);
      g.fill();
      g.fillStyle = '#d7cdb8';
      g.beginPath();
      g.ellipse(w / 2, h * 0.42, w * 0.12, h * 0.2, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#9b927f';
      g.beginPath();
      g.ellipse(w / 2, h * 0.47, w * 0.08, h * 0.12, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#1b130b';
      g.fillRect(w / 2 - 14, h * 0.43, 9, 5);
      g.fillRect(w / 2 + 5, h * 0.43, 9, 5);
      if (haunted) {
        // in the lightning the face is not quite a face: hollow eyes that glint, a gaping mouth
        g.fillStyle = '#7d7464';
        g.beginPath();
        g.ellipse(w / 2, h * 0.45, w * 0.1, h * 0.16, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#050302';
        for (const sx of [-1, 1]) {
          g.beginPath();
          g.ellipse(w / 2 + sx * 11, h * 0.42, 8, 10, 0, 0, Math.PI * 2);
          g.fill();
        }
        g.beginPath();
        g.ellipse(w / 2, h * 0.58, 7, 13, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#ffe6b0';
        g.fillRect(w / 2 - 12, h * 0.42 - 1, 3, 3);
        g.fillRect(w / 2 + 10, h * 0.42 - 1, 3, 3);
      }
    } else {
      // a landscape with a lone house
      g.fillStyle = '#131813';
      g.beginPath();
      g.moveTo(0, h * 0.7);
      g.quadraticCurveTo(w * 0.4, h * 0.5, w, h * 0.68);
      g.lineTo(w, h);
      g.lineTo(0, h);
      g.fill();
      g.fillStyle = '#0a0a08';
      g.fillRect(w * 0.6, h * 0.45, 40, 40);
      g.beginPath();
      g.moveTo(w * 0.6 - 6, h * 0.45);
      g.lineTo(w * 0.6 + 20, h * 0.3);
      g.lineTo(w * 0.6 + 46, h * 0.45);
      g.fill();
      g.fillStyle = '#c9a24a';
      g.fillRect(w * 0.6 + 16, h * 0.5, 7, 9);
      if (haunted) {
        // someone stands in the field, looking out of the picture
        g.fillStyle = '#d8d0bc';
        g.fillRect(w * 0.28, h * 0.5, 9, 30);
        g.beginPath();
        g.arc(w * 0.28 + 4.5, h * 0.5 - 3, 6, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#d04020';
        g.fillRect(w * 0.6 + 16, h * 0.5, 7, 9);
      }
    }
    speckle(g, w, h, 2500, ['#000', '#7a6a50'], [1, 2], 0.15);
    g.strokeStyle = '#8a6a2a';
    g.lineWidth = 14;
    g.strokeRect(0, 0, w, h);
    g.strokeStyle = '#3a2a10';
    g.lineWidth = 3;
    g.strokeRect(12, 12, w - 24, h - 24);
  });
}

export function makeMaterials(maxAniso) {
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const m = {
    wall: std({ map: tex(wallCanvas()), roughness: 0.95 }),
    wallCold: std({ map: tex(wallCanvas('#7a7c74')), roughness: 0.95 }),
    brick: std({ map: file('/assets/textures/brick_diffuse.jpg', { repeat: [1, 1.7] }), bumpMap: file('/assets/textures/brick_bump.jpg', { repeat: [1, 1.7], srgb: false }), bumpScale: 2, roughness: 1, color: 0x8a7a6a }),
    wood: std({ map: file('/assets/textures/hardwood2_diffuse.jpg', { repeat: [1, 1] }), bumpMap: file('/assets/textures/hardwood2_bump.jpg', { srgb: false }), bumpScale: 0.6, roughness: 0.75, color: 0x9a8270 }),
    stone: std({ map: tex(stoneCanvas()), roughness: 0.9 }),
    tiles: std({ map: tex(tileCanvas()), roughness: 0.55 }),
    ground: std({ map: tex(groundCanvas(), { repeat: [1, 1] }), roughness: 1 }),
    ceiling: std({ map: tex(ceilingCanvas()), roughness: 1 }),
    darkWood: std({ map: tex(woodCanvas('#2c1b0f')), roughness: 0.7 }),
    oldWood: std({ map: tex(woodCanvas('#4a3522')), roughness: 0.8 }),
    door: std({ map: tex(woodCanvas('#3a2312')), roughness: 0.65 }),
    linen: std({ map: tex(clothCanvas('#a59c88')), roughness: 1 }),
    blanket: std({ map: tex(clothCanvas('#3d2a2a')), roughness: 1 }),
    curtain: std({ map: tex(clothCanvas('#5a5040')), roughness: 1, side: THREE.DoubleSide }),
    altarCloth: std({ map: tex(clothCanvas('#8a8270')), roughness: 1 }),
    iron: std({ color: 0x2a2826, metalness: 0.7, roughness: 0.5 }),
    rust: std({ color: 0x4a2a18, metalness: 0.4, roughness: 0.8 }),
    brass: std({ color: 0xa8843a, metalness: 0.9, roughness: 0.35 }),
    porcelain: std({ color: 0xb8b2a4, roughness: 0.3 }),
    chalk: std({ color: 0x1b2420, roughness: 0.9 }),
    stoneProp: std({ map: tex(stoneCanvas()), roughness: 0.95, color: 0x8a8a84 }),
    bark: std({ map: tex(woodCanvas('#1e1812')), roughness: 1 }),
    book: [0x4a1c14, 0x1c2a3a, 0x2a3a1c, 0x3a2a14, 0x2a1830].map((c) => std({ color: c, roughness: 0.8 })),
    wax: std({ color: 0xe8dcc0, roughness: 0.6 }),
    pumpkin: std({ color: 0xb05a18, roughness: 0.7, emissive: 0x401800, emissiveIntensity: 0.5 }),
    flame: new THREE.MeshBasicMaterial({ color: 0xffb04a }),
  };
  for (const v of Object.values(m)) for (const k of ['map', 'bumpMap']) if (v[k]) v[k].anisotropy = Math.min(8, maxAniso);
  return m;
}
// each painting has a second, wrong version that shows only while lightning flashes
export const paintings = [0, 1, 2, 3, 4, 5].map((i) => {
  const calm = tex(portraitCanvas(i));
  const m = new THREE.MeshStandardMaterial({ map: calm, roughness: 0.6 });
  m.userData = { calm, haunted: tex(portraitCanvas(i, true)) };
  return m;
});
