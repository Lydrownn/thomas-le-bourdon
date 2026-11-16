// Zone des compétences : mini-cinématique de plongée (bulles + zoom), puis une grotte
// bioluminescente où six blocs attendent d'être éclairés par le robot.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as P from './props.js';

const { rand } = P;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (a, b, x) => { const k = clamp01((x - a) / (b - a)); return k * k * (3 - 2 * k); };

export const SKILLS_BG = '#0a1238';
const FOAM = new THREE.Color(0x9fdcf5);
const FLOOR_Y = -3.6;
const ZONE_CAM = { pos: V(0, 3.6, 15.5), look: V(0, -1.4, 0) };
const PLUNGE_CAM = { pos: V(0, 0, 13), look: V(0, 0, 3) };
const T_SWAP = 2.4;   // le voile est opaque : on change de décor
const T_READY = 3.8;  // fin de la cinématique d'entrée
const T_BACK = 1.5;   // sortie : même principe, en plus court
const T_BACK_END = 2.8;
const DEFAULT_COLORS = [0x5ee7ff, 0xb48aff, 0x7affb0, 0xffc233, 0xff7ab0, 0xff8a3d];

function glyphTexture(label, color) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.strokeStyle = g.fillStyle = color;
  g.lineWidth = 7;
  g.beginPath();
  g.roundRect(26, 26, 204, 204, 34);
  g.stroke();
  g.font = `700 ${label.length > 3 ? 62 : 90}px "Space Grotesk", system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(label, 128, 134);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function gradientTexture(stops, w = 4, h = 256) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, h);
  for (const [at, col] of stops) grad.addColorStop(at, col);
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class SkillsZone {
  constructor(ocean) {
    this.o = ocean;
    this.active = false;
    this.lighting = false;
    this.phase = 'idle';
    this.T = 0;
    this.blocks = [];
    this.hitboxes = [];
    this.hover = -1;
    this.light = null;       // { i, t, lit }
    this.celebrate = -1;
    this.ray = new THREE.Raycaster();
    this.plane = new THREE.Plane(V(0, 0, 1), -3);
    this.hit = V(0, 0, 0);
    this.face = 1;
    this.cb = {};

    this.group = new THREE.Group();
    this.group.visible = false;
    ocean.scene.add(this.group);

    // Voile : cache le décor de l'océan derrière le robot (le robot reste devant, à z = 4).
    this.veil = new THREE.Mesh(
      new THREE.PlaneGeometry(260, 260),
      new THREE.MeshBasicMaterial({ color: FOAM, transparent: true, opacity: 0, depthWrite: false, fog: false }),
    );
    this.veil.position.z = 2.2;
    this.veil.frustumCulled = false;
    this.veil.visible = false;
    ocean.scene.add(this.veil);

    this.buildStream();
  }

  // ─── Flux de bulles de la plongée ─────────────────────────────────────────
  buildStream() {
    const N = 150;
    this.streamMat = this.o.bubbleMat.clone();
    this.streamMat.opacity = 0.9;
    this.stream = new THREE.Group();
    this.streamItems = [];
    for (let i = 0; i < N; i++) {
      const s = new THREE.Sprite(this.streamMat);
      this.streamItems.push({ s, nx: rand(-1.1, 1.1), ny: rand(-1.3, 1.3), dz: rand(1.5, 15), vy: rand(0.8, 2.4), size: rand(0.25, 1.1), ph: rand(0, 6.28) });
      this.stream.add(s);
    }
    this.stream.visible = false;
    this.o.scene.add(this.stream);
    this.streamK = 0;
  }

  updateStream(dt, t, k) {
    this.streamK = k;
    this.stream.visible = k > 0.01;
    if (!this.stream.visible) return;
    const cam = this.o.camera;
    cam.updateMatrixWorld();
    const right = V(0, 0, 0).setFromMatrixColumn(cam.matrixWorld, 0);
    const up = V(0, 0, 0).setFromMatrixColumn(cam.matrixWorld, 1);
    const fwd = cam.getWorldDirection(V(0, 0, 0));
    const tan = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const N = this.streamItems.length;
    this.streamItems.forEach((b, i) => {
      b.ny += b.vy * dt * (0.4 + k * 2.2);
      if (b.ny > 1.3) { b.ny = -1.3; b.nx = rand(-1.1, 1.1); }
      const on = i / N < k;
      b.s.visible = on;
      if (!on) return;
      const hh = tan * b.dz, hw = hh * cam.aspect;
      b.s.position.copy(cam.position).addScaledVector(fwd, b.dz)
        .addScaledVector(right, (b.nx + Math.sin(t * 2 + b.ph) * 0.02) * hw)
        .addScaledVector(up, b.ny * hh);
      b.s.scale.set(b.size, b.size * (1 + k * 2.6), 1);
    });
  }

  // ─── Décor de la grotte ───────────────────────────────────────────────────
  floorH(x, z) {
    return FLOOR_Y + 0.3 * Math.sin(x * 0.35 + 1.3) * Math.cos(z * 0.3) + Math.max(0, -z - 8) * 0.14;
  }

  buildScene() {
    const g = this.group;
    const bg = new THREE.Color(SKILLS_BG);

    // Éclairage propre à la grotte
    g.add(new THREE.HemisphereLight(0x6f8cff, 0x120a2a, 1.5));
    const fill = new THREE.DirectionalLight(0x9fb8ff, 1.1);
    fill.position.set(-6, 14, 10);
    g.add(fill);

    // Toile de fond dégradée, très loin
    const back = new THREE.Mesh(
      new THREE.PlaneGeometry(520, 260),
      new THREE.MeshBasicMaterial({
        map: gradientTexture([[0, '#17408a'], [0.38, SKILLS_BG], [1, '#050816']]), fog: false, depthWrite: false,
      }),
    );
    back.position.set(0, 20, -110);
    g.add(back);

    // Rayons de lumière tombant de la surface
    const shaftTex = gradientTexture([[0, 'rgba(160,230,255,0.55)'], [1, 'rgba(160,230,255,0)']]);
    this.shafts = [];
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(rand(4, 9), 70),
        new THREE.MeshBasicMaterial({ map: shaftTex, transparent: true, opacity: rand(0.1, 0.2), depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
      );
      m.position.set(-34 + i * 13 + rand(-3, 3), 18, rand(-45, -28));
      m.rotation.z = -0.28;
      m.userData.ph = rand(0, 6.28);
      g.add(m);
      this.shafts.push(m);
    }

    // Fond marin vallonné qui remonte en crête derrière
    const geo = new THREE.PlaneGeometry(110, 90, 80, 60).rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const base = new THREE.Color(0x1b2c55), lite = new THREE.Color(0x2c4476), c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i) - 18;
      pos.setY(i, this.floorH(x, z) - FLOOR_Y + 0.35 * Math.sin(x * 1.1) * Math.sin(z * 0.9) + rand(-0.06, 0.06));
      pos.setZ(i, z);
      c.copy(base).lerp(lite, clamp01(0.5 + 0.5 * Math.sin(x * 0.5 + z * 0.35)));
      col.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const floor = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }));
    floor.position.y = FLOOR_Y;
    g.add(floor);

    // Rochers qui encadrent la scène
    for (const side of [-1, 1]) {
      for (let i = 0; i < 6; i++) {
        const s = rand(2.5, 6);
        const r = P.rock(0x1d2a4c, { sx: s, sy: s * rand(0.9, 1.7), sz: s * 0.8 });
        const x = side * rand(15, 30), z = rand(-26, -2);
        r.position.set(x, this.floorH(x, z) + s * 0.4, z);
        g.add(r);
      }
    }

    // Flore lumineuse
    this.glowers = [];
    const spots = [[-13, -1], [13, 0], [-9, 5], [10, 6], [-16, -8], [17, -7], [0, -9], [-5, -12], [6, -13], [-20, 3], [21, 4]];
    spots.forEach(([x, z], i) => {
      const colr = DEFAULT_COLORS[i % 6];
      const y = this.floorH(x, z);
      const a = P.anemone(colr, 1.1, 16);
      a.position.set(x, y, z);
      a.scale.setScalar(rand(0.9, 1.6));
      g.add(a);
      const sp = P.sponge(DEFAULT_COLORS[(i + 2) % 6], rand(1.4, 2.4), 0.8);
      sp.position.set(x + rand(-1.5, 1.5), y, z + rand(-1, 1));
      g.add(sp);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.o.glowTex, color: colr, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      glow.position.set(x, y + 0.7, z);
      glow.scale.setScalar(5);
      glow.userData.ph = rand(0, 6.28);
      g.add(glow);
      this.glowers.push(glow);
    });
  }

  // ─── Les six blocs ────────────────────────────────────────────────────────
  buildBlocks(groups) {
    this.blocks.forEach((b) => this.group.remove(b.group));
    this.blocks = [];
    this.hitboxes = [];
    const stoneGeo = new RoundedBoxGeometry(2.2, 3, 1.6, 3, 0.18);
    const slabGeo = new RoundedBoxGeometry(3, 0.45, 2.4, 2, 0.1);
    const crystalGeo = new THREE.OctahedronGeometry(0.46);

    groups.forEach((gr, i) => {
      const color = new THREE.Color(gr.color ?? DEFAULT_COLORS[i % 6]);
      const css = `#${color.getHexString()}`;
      const g = new THREE.Group();
      const stone = new THREE.MeshStandardMaterial({ color: 0x232f52, roughness: 0.75, metalness: 0.25, emissive: color, emissiveIntensity: 0 });
      const body = new THREE.Mesh(stoneGeo, stone);
      body.position.y = 1.95;
      const slab = new THREE.Mesh(slabGeo, new THREE.MeshStandardMaterial({ color: 0x172043, roughness: 0.9 }));
      slab.position.y = 0.2;
      const glyph = new THREE.Mesh(
        new THREE.PlaneGeometry(1.5, 1.5),
        new THREE.MeshBasicMaterial({ map: glyphTexture(gr.glyph ?? '·', css), color: 0xffffff, transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      glyph.position.set(0, 2.0, 0.82);
      const crystalMat = new THREE.MeshStandardMaterial({ color: 0x3a4670, emissive: color, emissiveIntensity: 0, roughness: 0.3, flatShading: true });
      const crystal = new THREE.Mesh(crystalGeo, crystalMat);
      crystal.scale.set(0.9, 1.4, 0.9);
      crystal.position.y = 4.1;
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.o.glowTex, color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      halo.position.set(0, 2.4, 0.4);
      halo.scale.setScalar(8);
      const lamp = new THREE.PointLight(color, 0, 14, 1.4);
      lamp.position.set(0, 2.6, 2.4);
      g.add(slab, body, glyph, crystal, halo, lamp);
      body.userData.block = i;
      this.hitboxes.push(body);
      this.group.add(g);
      this.blocks.push({ group: g, stone, glyph, crystal, crystalMat, halo, lamp, color, k: 0, lit: false, hov: 0, ph: rand(0, 6.28), size: 1 });
    });
    this.layout();
  }

  // Disposition : arc en zigzag sur grand écran, deux colonnes sur mobile.
  layout() {
    const o = this.o;
    const n = this.blocks.length;
    this.blocks.forEach((b, i) => {
      let x, z, s;
      if (o.narrow) {
        x = (i % 2 === 0 ? -1 : 1) * Math.min(o.halfW * 0.5, 2.4);
        z = [5, 0, -5][i >> 1] + (i % 2) * -1.2;
        s = 0.8;
      } else {
        const gap = Math.min(4.6, o.halfW * 0.25);
        x = (i - (n - 1) / 2) * gap;
        z = i % 2 === 0 ? 1.8 : -1.6;
        s = Math.min(1.2, gap / 3.7);
      }
      b.group.position.set(x, this.floorH(x, z) - 0.15, z);
      b.group.scale.setScalar(s);
      b.size = s;
      b.top = V(x, this.floorH(x, z) + 4.2 * s, z);
      b.mid = V(x, this.floorH(x, z) + 2.1 * s, z);
    });
  }

  // ─── Cycle de vie ─────────────────────────────────────────────────────────
  enter(groups, cb = {}) {
    if (this.active) return;
    const o = this.o;
    this.cb = cb;
    if (!this.built) { this.buildScene(); this.built = true; }
    if (this.blocks.length !== groups.length) this.buildBlocks(groups);
    this.blocks.forEach((b) => { b.lit = false; b.k = 0; });
    this.layout();
    this.active = true;
    this.phase = 'in';
    this.swapped = false;
    this.light = null;
    this.lighting = false;
    this.celebrate = -1;
    this.T = o.reduced ? T_SWAP : 0;
    this.veil.visible = true;
    this.veil.material.color.copy(FOAM);
    o.rovBoost = 1.5;
    o.rovSpeed = 2.2;
    o.rovFocus = V(0, 0, 4);
    o.focusPoint = V(3, -12, 4);
    if (!o.reduced) o.animateCamera(PLUNGE_CAM.pos.clone(), PLUNGE_CAM.look.clone(), T_SWAP);
    cb.onStart?.();
    if (o.reduced) this.swap(true);
  }

  exit(cb = {}) {
    if (!this.active || this.phase === 'out' || this.phase === 'in') return false;
    const o = this.o;
    this.cb = cb;
    this.phase = 'out';
    this.T = o.reduced ? T_BACK : 0;
    this.lighting = false;
    this.light = null;
    this.veil.visible = true;
    this.veil.material.color.set(SKILLS_BG);
    o.rovBoost = 1.4;
    o.rovFocus = V(0, 0.5, 4);
    o.focusPoint = V(3, -12, 4);
    cb.onStart?.();
    if (o.reduced) this.swap(false);
    return true;
  }

  swap(inside) {
    const o = this.o;
    this.swapped = inside;
    o.world.visible = !inside;
    this.group.visible = inside;
    for (let i = o.effects.length - 1; i >= 0; i--) o.removeEffect(o.effects[i]);
    o.effects.length = 0;
    o.bgOverride = inside ? SKILLS_BG : null;
    if (inside) {
      o.rovBoost = 1;
      o.rovSpeed = 2.4;
      o.camera.position.copy(PLUNGE_CAM.pos);
      o.animateCamera(ZONE_CAM.pos.clone(), ZONE_CAM.look.clone(), T_READY - T_SWAP);
    } else {
      o.camera.position.set(0, 0, 20);
      o.camLook.set(0, 0, 0);
      o.camAnim = null;
    }
  }

  // Le robot vient éclairer le bloc i ; il s'allume une fois le faisceau posé.
  lightBlock(i) {
    if (this.phase !== 'zone') return;
    this.light = { i, t: 0, done: this.blocks[i].lit };
    this.lighting = true;
  }

  pick(clientX, clientY) {
    if (this.phase !== 'zone') return -1;
    const ndc = new THREE.Vector2((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1);
    this.ray.setFromCamera(ndc, this.o.camera);
    const h = this.ray.intersectObjects(this.hitboxes, false)[0];
    return h ? h.object.userData.block : -1;
  }

  setHover(i) { this.hover = i; }

  celebrateAll() {
    this.celebrate = 0;
    this.o.bubbles({ count: 90, spread: this.o.halfW * 0.8, y: 0, z: 0, size: [0.15, 0.6] });
  }

  // ─── Boucle ───────────────────────────────────────────────────────────────
  update(dt, t) {
    if (!this.active) return;
    const o = this.o;
    this.T += dt;
    const T = this.T;
    let veil = 0, stream = 0;

    if (this.phase === 'in') {
      stream = smooth(0, 1.6, T) * (1 - smooth(T_SWAP, 3.4, T));
      veil = T < T_SWAP ? smooth(1, 2.2, T) : 1 - smooth(T_SWAP, T_READY, T);
      this.veil.material.color.copy(FOAM).lerp(new THREE.Color(SKILLS_BG), smooth(1.6, T_SWAP, T));
      if (T >= T_SWAP && !this.swapped) this.swap(true);
      if (T >= T_READY) {
        this.phase = 'zone';
        o.rovBoost = 1;
        this.cb.onReady?.();
        o.jellies?.();
      }
    } else if (this.phase === 'out') {
      stream = smooth(0, 1, T) * (1 - smooth(T_BACK, T_BACK_END - 0.3, T));
      veil = T < T_BACK ? smooth(0.4, 1.3, T) : 1 - smooth(T_BACK, T_BACK_END, T);
      if (T >= T_BACK && this.swapped) this.swap(false);
      if (T >= T_BACK && !this.swapped && this.veil.material.color.getHexString() !== FOAM.getHexString()) {
        this.veil.material.color.lerp(FOAM, 0.08);
      }
      if (T >= T_BACK_END) {
        this.phase = 'idle';
        this.active = false;
        this.lighting = false;
        o.rovFocus = o.focusPoint = null;
        o.rovBoost = 1;
        o.rovSpeed = null;
        this.veil.visible = false;
        this.updateStream(dt, t, 0);
        this.cb.onClosed?.();
        return;
      }
    }
    this.veil.material.opacity = veil;
    this.updateStream(dt, t, stream);

    if (this.phase === 'zone') this.updateZone(dt, t);
    this.animateScene(dt, t);
  }

  updateZone(dt, t) {
    const o = this.o;
    const L = this.light;
    if (L) {
      L.t += dt;
      const b = this.blocks[L.i];
      // Le robot se place devant le bloc, légèrement au-dessus, et braque son projecteur dessus.
      o.rovFocus = V(b.mid.x + (b.mid.x > 0 ? -1.2 : 1.2) * b.size, b.mid.y + 1.5 * b.size, b.mid.z + 4.2);
      o.focusPoint = b.mid.clone();
      if (!L.done && L.t > 1.3) {
        L.done = true;
        b.lit = true;
        o.bubbles({ x: b.mid.x, y: b.mid.y + 1, z: b.mid.z + 1, count: 26, spread: 1.4, size: [0.1, 0.4], anchored: false });
        this.cb.onLit?.(L.i);
      }
      if (L.t > 2.6) { this.light = null; this.lighting = false; }
    }
    if (!this.light) {
      // Au repos : le robot suit le curseur, dans le plan z = 3.
      this.ray.setFromCamera(o.mouse, o.camera);
      if (this.ray.ray.intersectPlane(this.plane, this.hit)) {
        const target = V(THREE.MathUtils.clamp(this.hit.x, -o.halfW * 0.9, o.halfW * 0.9), THREE.MathUtils.clamp(this.hit.y, -0.5, 7), 3);
        if (Math.abs(target.x - o.rov.position.x) > 1.2) this.face = Math.sign(target.x - o.rov.position.x);
        o.rovFocus = target;
        o.focusPoint = target.clone().add(V(this.face * 5, -0.8, 0));
      }
    }
  }

  animateScene(dt, t) {
    if (this.phase === 'in' && !this.swapped) return;
    const o = this.o;
    for (const s of this.shafts ?? []) {
      s.material.opacity = 0.12 + 0.05 * Math.sin(t * 0.4 + s.userData.ph);
      s.position.x += Math.sin(t * 0.1 + s.userData.ph) * 0.004;
    }
    for (const gl of this.glowers ?? []) gl.material.opacity = 0.32 + 0.14 * Math.sin(t * 1.3 + gl.userData.ph);

    this.blocks.forEach((b, i) => {
      const target = b.lit ? 1 : 0;
      b.k += (target - b.k) * (1 - Math.exp(-dt * 2.6));
      b.hov += ((this.hover === i && this.phase === 'zone' ? 1 : 0) - b.hov) * (1 - Math.exp(-dt * 8));
      const pulse = this.celebrate >= 0 ? 0.5 + 0.5 * Math.sin(this.celebrate * 3 - i * 0.7) : 0;
      const beaming = this.light?.i === i && this.lighting ? 1 : 0;
      b.stone.emissiveIntensity = b.k * 0.12 + b.hov * 0.05 + beaming * 0.04;
      b.glyph.material.opacity = 0.18 + b.k * 0.82 + b.hov * 0.25;
      b.crystalMat.emissiveIntensity = b.k * (1.6 + pulse * 1.2) + b.hov * 0.4;
      b.halo.material.opacity = b.k * (0.45 + pulse * 0.3) + b.hov * 0.12;
      b.lamp.intensity = b.k * (26 + pulse * 20);
      b.crystal.position.y = 4.1 + Math.sin(t * 1.4 + b.ph) * 0.14 * (0.4 + b.k);
      b.crystal.rotation.y += dt * (0.4 + b.k * 1.6);
    });
    if (this.celebrate >= 0) this.celebrate += dt;
  }
}
