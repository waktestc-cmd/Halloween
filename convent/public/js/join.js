// The join screen, in the style of Pumpkin Smash: the painted hall lit by your torch, the title, your
// name, and the costume you will wear in the house, turning slowly in a pool of light.
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import * as C from '/shared/config.js';
import { characters, findClip } from './models.js';
import { costumeSVG, costumeName } from './costumes.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch (e) {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch (e) {
      /* private window: remembered for this visit only */
    }
  },
};

/* ---------- the turning figure ----------
   A small renderer of its own, only while the join screen shows. Until the model has loaded (or if
   this laptop can't do it) the painted silhouette stands in. */
class Preview {
  constructor(canvas) {
    this.canvas = canvas;
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    } catch (e) {
      return;
    }
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.scene = new THREE.Scene();
    // framed so the feet stand at the bottom of the pool of light
    this.camera = new THREE.PerspectiveCamera(26, 1, 0.1, 30);
    this.camera.position.set(0, 1.2, 4.6);
    this.camera.lookAt(0, 1.02, 0);
    // lantern light from the front left, a cold rim from behind
    this.scene.add(new THREE.HemisphereLight(0xffe2b8, 0x1a0e06, 1.3));
    const lamp = new THREE.PointLight(0xffb468, 26, 10, 1.6);
    lamp.position.set(-1.4, 1.9, 2.2);
    this.scene.add(lamp);
    const rim = new THREE.DirectionalLight(0x9fb0ff, 1.1);
    rim.position.set(1.5, 2.5, -2.5);
    this.scene.add(rim);
    this.turn = new THREE.Group();
    this.scene.add(this.turn);
    this.cast = characters('player');
    this.clock = new THREE.Clock();
    this.want = null;
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }
  show(i, look) {
    if (!this.renderer) return;
    const key = i + ':' + look;
    if (this.want === key) return;
    this.want = key;
    $('j-hero').classList.remove('ready');
    this.cast
      .then((c) => (c.count ? c.get(i) : null))
      .then((f) => {
        if (!f || this.want !== key || !this.renderer) return;
        if (this.body) this.turn.remove(this.body);
        const body = SkeletonUtils.clone(f.scene);
        // the clothes take your colour, just as in the house
        const spec = f.spec;
        const tint = new THREE.Color(C.LOOKS[look] || C.LOOKS[0]);
        const names = [].concat(spec.tint || []);
        body.traverse((o) => {
          if (o.isMesh && names.some((n) => (o.material.name || '').includes(n))) {
            o.material = o.material.clone();
            o.material.color.copy(tint).multiplyScalar(spec.tintBoost ?? 1);
          }
        });
        body.scale.setScalar(f.scale);
        body.rotation.y = THREE.MathUtils.degToRad(spec.turn || 0);
        this.mixer = new THREE.AnimationMixer(body);
        const idle = findClip(f.animations, spec.idle || 'idle');
        if (idle) this.mixer.clipAction(idle).play();
        this.body = body;
        this.turn.add(body);
        $('j-hero').classList.add('ready');
      })
      .catch(() => {});
  }
  loop() {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, this.clock.getDelta());
    if (!$('panel-join').classList.contains('on')) return;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w && (this.canvas.width !== Math.round(w * this.renderer.getPixelRatio()) || this.h !== h)) {
      this.h = h;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    this.turn.rotation.y += dt * 0.55;
    this.mixer?.update(dt);
    this.renderer.render(this.scene, this.camera);
  }
  stop() {
    if (!this.renderer) return;
    cancelAnimationFrame(this.raf);
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer = null;
  }
}

// onJoin({ name, costume, look }) when they press "Enter the manor"
export function setupJoin(onJoin) {
  let costume = Number(store.get('convent-costume'));
  if (!(Number.isInteger(costume) && costume >= 0 && costume < C.COSTUMES.length) || store.get('convent-costume') == null) costume = Math.floor(Math.random() * C.COSTUMES.length);
  let look = Number(store.get('convent-look')) || 0;
  if (!(look >= 0 && look < C.LOOKS.length)) look = 0;
  const preview = new Preview($('j-preview'));

  const grid = $('j-pick');
  C.COSTUMES.forEach((c, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pick';
    b.title = c.name;
    b.setAttribute('aria-label', c.name);
    b.innerHTML = costumeSVG(i);
    b.addEventListener('click', () => {
      costume = i;
      sync();
    });
    grid.appendChild(b);
  });
  const looks = $('looks');
  C.LOOKS.forEach((col, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'look';
    b.style.background = col;
    b.setAttribute('aria-label', `Colour ${i + 1}`);
    b.addEventListener('click', () => {
      look = i;
      sync();
    });
    looks.appendChild(b);
  });
  function sync() {
    [...grid.children].forEach((b, i) => b.classList.toggle('on', i === costume));
    [...looks.children].forEach((b, i) => b.classList.toggle('on', i === look));
    $('j-chosen').textContent = `You are the ${costumeName(costume).toLowerCase()}.`;
    const sil = $('j-sil');
    if (sil.dataset.i !== String(costume)) {
      sil.dataset.i = costume;
      sil.innerHTML = costumeSVG(costume);
      const hero = $('j-hero');
      hero.classList.remove('pop');
      void hero.offsetWidth;
      hero.classList.add('pop');
    }
    preview.show(costume, look);
  }
  sync();

  $('name').value = store.get('convent-name') || '';
  $('join-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('name').value.trim();
    if (!name) {
      $('j-err').textContent = 'Type your name first, so the others know who you are.';
      return $('name').focus();
    }
    $('j-err').textContent = '';
    store.set('convent-name', name);
    store.set('convent-costume', costume);
    store.set('convent-look', look);
    onJoin({ name, costume, look });
  });

  // the painting is lit by your torch: it follows the mouse
  const bg = $('join-bg');
  window.addEventListener('pointermove', (e) => {
    bg.style.setProperty('--lx', `${e.clientX}px`);
    bg.style.setProperty('--ly', `${e.clientY}px`);
  });
  return { stop: () => preview.stop() };
}
