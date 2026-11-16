// Zone des compétences : le robot fonce vers le fond (les bulles filent derrière lui, à sa vitesse),
// puis une grotte bioluminescente où six piédestaux portent chacun une petite pierre à éclairer.
// Quand la pierre s'allume, le texte de la compétence sort du piédestal en hologramme.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as P from './props.js';

const { rand } = P;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (a, b, x) => { const k = clamp01((x - a) / (b - a)); return k * k * (3 - 2 * k); };
const easeOutBack = (k) => 1 + 2.2 * (k - 1) ** 3 + 1.2 * (k - 1) ** 2;

export const SKILLS_BG = '#0a1238';
const FOAM = new THREE.Color(0x9fdcf5);
const FLOOR_Y = -3.6;
const ZONE_CAM = { pos: V(0, 3.4, 15.5), look: V(0, -0.6, 0) };
const PLUNGE_CAM = { pos: V(0, 0, 12), look: V(0, 0, 4) };
const T_SWAP = 2.4;   // le voile est opaque : on change de décor
const T_READY = 3.8;  // fin de la cinématique d'entrée
const T_BACK = 1.5;   // sortie : même principe, en plus court
const T_BACK_END = 2.8;
const CRY_Y = 4.0;    // hauteur de la petite pierre au-dessus du pied du piédestal
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

// Carte holographique : titre + pastilles de compétences, dessinées dans un canvas.
function cardTexture(group, css) {
  const W = 760, pad = 40, font = '"Space Grotesk", system-ui, sans-serif';
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = `500 36px ${font}`;
  const pills = [];
  let x = pad, row = 0;
  for (const label of group.items) {
    const w = probe.measureText(label).width + 40;
    if (x + w > W - pad) { x = pad; row++; }
    pills.push({ label, x, row, w });
    x += w + 14;
  }
  const rows = row + 1;
  const H = pad + 66 + 28 + rows * 74 + pad - 12;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(6,12,38,0.9)';
  g.strokeStyle = css;
  g.lineWidth = 4;
  g.shadowColor = css; g.shadowBlur = 26;
  g.beginPath(); g.roundRect(10, 10, W - 20, H - 20, 30); g.fill(); g.stroke();
  g.shadowBlur = 0;
  g.fillStyle = css;
  g.font = `700 54px ${font}`;
  g.textBaseline = 'alphabetic';
  g.fillText(group.title, pad, pad + 54);
  g.font = `500 36px ${font}`;
  g.textBaseline = 'middle';
  for (const p of pills) {
    const y = pad + 66 + 28 + p.row * 74 + 29;
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.strokeStyle = css;
    g.lineWidth = 2;
    g.beginPath(); g.roundRect(p.x, y - 29, p.w, 58, 29); g.fill(); g.stroke();
    g.fillStyle = '#eaf6ff';
    g.fillText(p.label, p.x + 20, y + 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return { tex: t, aspect: W / H };
}

export class SkillsZone {
  constructor(ocean) {
    this.o = ocean;
    this.active = false;
    this.lighting = false;
    this.phase = 'idle';
    this.T = 0;
    this.blocks = [];
    this.groups = [];
    this.hitboxes = [];
    this.hover = -1;
    this.light = null;       // { i, t, done, shown }
    this.card = null;        // { i, t, hiding, from, to, W, H, len }
    this.celebrate = -1;
    this.ray = new THREE.Raycaster();
    this.plane = new THREE.Plane(V(0, 0, 1), -3);
    this.hit = V(0, 0, 0);
    this.face = 1;
    this.cb = {};
    this.wakeT = 0;

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

  // ─── Vitesse : bulles qui filent vers l'arrière + sillage du robot ────────
  buildStream() {
    const o = this.o;
    this.streamMat = o.bubbleMat.clone();
    this.streamMat.opacity = 0.9;
    this.lineMat = new THREE.SpriteMaterial({
      map: o.glowTex, color: 0xe6f8ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.5,
    });
    this.stream = new THREE.Group();
    this.streamItems = [];
    const N = 150, L = 40;
    for (let i = 0; i < N + L; i++) {
      const line = i >= N;
      const s = new THREE.Sprite(line ? this.lineMat : this.streamMat);
      this.streamItems.push({
        s, line, nx: rand(-1.3, 1.3), ny: rand(-1.1, 1.1), dz: line ? rand(3, 10) : rand(1.5, 15),
        vx: line ? rand(2.2, 4) : rand(0.8, 2), size: line ? rand(2, 6) : rand(0.25, 1), ph: rand(0, 6.28),
      });
      this.stream.add(s);
    }
    this.stream.visible = false;
    o.scene.add(this.stream);

    // Sillage : petites bulles lâchées derrière les hélices, qui restent en arrière.
    this.wakeMat = o.bubbleMat.clone();
    this.wake = new THREE.Group();
    this.wakeItems = Array.from({ length: 70 }, () => {
      const s = new THREE.Sprite(this.wakeMat);
      s.visible = false;
      this.wake.add(s);
      return { s, life: 0, max: 1, vx: 0, vy: 0, size: 0.2 };
    });
    this.wake.visible = false;
    o.scene.add(this.wake);
  }

  updateStream(dt, t, k) {
    this.stream.visible = this.wake.visible = k > 0.01;
    if (!this.stream.visible) return;
    const cam = this.o.camera;
    cam.updateMatrixWorld();
    const right = V(0, 0, 0).setFromMatrixColumn(cam.matrixWorld, 0);
    const up = V(0, 0, 0).setFromMatrixColumn(cam.matrixWorld, 1);
    const fwd = cam.getWorldDirection(V(0, 0, 0));
    const tan = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const N = this.streamItems.length - 40;
    this.lineMat.opacity = 0.5 * k;
    this.streamItems.forEach((b, i) => {
      // Le robot file vers la droite : tout le décor glisse vers la gauche, de plus en plus vite.
      b.nx -= b.vx * dt * (0.15 + k * 3);
      if (b.nx < -1.4) { b.nx = 1.4; b.ny = rand(-1.1, 1.1); }
      const on = b.line ? k > 0.3 : i / N < k;
      b.s.visible = on;
      if (!on) return;
      const hh = tan * b.dz, hw = hh * cam.aspect;
      b.s.position.copy(cam.position).addScaledVector(fwd, b.dz)
        .addScaledVector(right, b.nx * hw)
        .addScaledVector(up, (b.ny + Math.sin(t * 2 + b.ph) * 0.015) * hh);
      if (b.line) b.s.scale.set(b.size * (0.4 + k), 0.05, 1);
      else b.s.scale.set(b.size * (1 + k * 2.2), b.size * (1 - k * 0.1), 1);
    });

    // Sillage
    const o = this.o;
    this.wakeT -= dt;
    if (k > 0.25 && this.wakeT <= 0) {
      this.wakeT = 0.035;
      const rear = o.rov.position.clone().add(V(-1.25 * o.rov.scale.x, rand(-0.25, 0.3) * o.rov.scale.x, rand(-0.5, 0.5)));
      for (let n = 0; n < 2; n++) {
        const w = this.wakeItems.find((x) => x.life <= 0);
        if (!w) break;
        w.life = w.max = rand(0.5, 0.9);
        w.vx = -rand(6, 12) * k;
        w.vy = rand(-0.4, 0.8);
        w.size = rand(0.1, 0.32);
        w.s.position.copy(rear);
        w.s.visible = true;
      }
    }
    for (const w of this.wakeItems) {
      if (w.life <= 0) continue;
      w.life -= dt;
      if (w.life <= 0) { w.s.visible = false; continue; }
      w.s.position.x += w.vx * dt;
      w.s.position.y += w.vy * dt;
      const a = w.life / w.max;
      w.s.scale.setScalar(w.size * (1.6 - a * 0.6));
    }
    this.wakeMat.opacity = 0.85;
  }

  // ─── Décor de la grotte ───────────────────────────────────────────────────
  floorH(x, z) {
    return FLOOR_Y + 0.3 * Math.sin(x * 0.35 + 1.3) * Math.cos(z * 0.3) + Math.max(0, -z - 8) * 0.14;
  }

  buildScene() {
    const g = this.group;

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

    // Carte holographique (une seule, réutilisée) et son faisceau de projection
    this.cardMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, fog: false }),
    );
    this.cardMesh.visible = false;
    this.cardMesh.renderOrder = 10;
    g.add(this.cardMesh);
    this.cardBeam = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 0.12, 1, 24, 1, true).translate(0, 0.5, 0),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }),
    );
    this.cardBeam.visible = false;
    g.add(this.cardBeam);
  }

  // ─── Les six piédestaux ───────────────────────────────────────────────────
  buildBlocks(groups) {
    this.blocks.forEach((b) => this.group.remove(b.group));
    this.blocks = [];
    this.hitboxes = [];
    const stoneGeo = new RoundedBoxGeometry(2.2, 3, 1.6, 3, 0.18);
    const slabGeo = new RoundedBoxGeometry(3, 0.45, 2.4, 2, 0.1);
    const crystalGeo = new THREE.OctahedronGeometry(0.58);
    const hitGeo = new THREE.SphereGeometry(1.5, 10, 8);
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });

    groups.forEach((gr, i) => {
      const color = new THREE.Color(gr.color ?? DEFAULT_COLORS[i % 6]);
      const css = `#${color.getHexString()}`;
      const g = new THREE.Group();
      const stone = new THREE.MeshStandardMaterial({ color: 0x232f52, roughness: 0.75, metalness: 0.25 });
      const body = new THREE.Mesh(stoneGeo, stone);
      body.position.y = 1.95;
      const slab = new THREE.Mesh(slabGeo, new THREE.MeshStandardMaterial({ color: 0x172043, roughness: 0.9 }));
      slab.position.y = 0.2;
      // Le glyphe gravé reste éteint : seule la petite pierre s'allume.
      const glyph = new THREE.Mesh(
        new THREE.PlaneGeometry(1.5, 1.5),
        new THREE.MeshBasicMaterial({ map: glyphTexture(gr.glyph ?? '·', css), color: 0xffffff, transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      glyph.position.set(0, 2.0, 0.82);
      const crystalMat = new THREE.MeshStandardMaterial({ color: 0x3a4670, emissive: color, emissiveIntensity: 0.1, roughness: 0.25, metalness: 0.2, flatShading: true });
      const crystal = new THREE.Mesh(crystalGeo, crystalMat);
      crystal.scale.set(0.95, 1.45, 0.95);
      crystal.position.y = CRY_Y;
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.o.glowTex, color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      halo.position.set(0, CRY_Y, 0.3);
      halo.scale.setScalar(5);
      const lamp = new THREE.PointLight(color, 0, 12, 1.3);
      lamp.position.set(0, CRY_Y + 0.4, 1.6);
      const hit = new THREE.Mesh(hitGeo, hitMat);
      hit.position.y = CRY_Y;
      hit.userData.block = i;
      body.userData.block = i;
      g.add(slab, body, glyph, crystal, halo, lamp, hit);
      this.hitboxes.push(hit, body);
      this.group.add(g);
      this.blocks.push({ group: g, crystal, crystalMat, halo, lamp, color, css, k: 0, lit: false, hov: 0, ph: rand(0, 6.28), size: 1 });
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
        x = (i % 2 === 0 ? -1 : 1) * Math.min(o.halfW * 0.5, 2.3);
        z = [5, 0, -5][i >> 1] + (i % 2) * -1.2;
        s = 0.6;
      } else {
        const gap = Math.min(4.6, o.halfW * 0.25);
        x = (i - (n - 1) / 2) * gap;
        z = i % 2 === 0 ? 1.8 : -1.6;
        s = Math.min(0.85, gap / 5.2);
      }
      const y0 = this.floorH(x, z) - 0.15;
      b.group.position.set(x, y0, z);
      b.group.scale.setScalar(s);
      b.size = s;
      b.gem = V(x, y0 + CRY_Y * s, z); // position de la petite pierre
    });
  }

  // ─── Cycle de vie ─────────────────────────────────────────────────────────
  enter(groups, cb = {}) {
    if (this.active) return;
    const o = this.o;
    this.cb = cb;
    if (!this.built) { this.buildScene(); this.built = true; }
    this.groups = groups;
    if (this.blocks.length !== groups.length) this.buildBlocks(groups);
    this.blocks.forEach((b) => { b.lit = false; b.k = 0; });
    this.layout();
    this.hideCard(true);
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
    o.focusPoint = V(8, 0.2, 4);
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
    this.hideCard(true);
    this.veil.visible = true;
    this.veil.material.color.set(SKILLS_BG);
    o.rovBoost = 1.4;
    o.rovFocus = V(0, 0.5, 4);
    o.focusPoint = V(8, 0.7, 4);
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

  // Le robot vient éclairer la petite pierre du piédestal i.
  lightBlock(i) {
    if (this.phase !== 'zone') return;
    if (this.light?.i !== i) this.hideCard();
    this.light = { i, t: 0, done: this.blocks[i].lit, shown: false };
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

  // ─── Hologramme : le texte sort du piédestal ──────────────────────────────
  showCard(i) {
    const o = this.o, b = this.blocks[i], gr = this.groups[i];
    const { tex, aspect } = cardTexture(gr, b.css);
    const m = this.cardMesh;
    m.material.map?.dispose();
    m.material.map = tex;
    m.material.needsUpdate = true;
    const dist = o.camera.position.distanceTo(b.gem) - 1.2; // la carte est un peu en avant du piédestal
    const visHalfW = Math.tan(THREE.MathUtils.degToRad(o.camera.fov / 2)) * dist * o.camera.aspect;
    const W = Math.min(7, visHalfW * 1.7), H = W / aspect;
    const lim = Math.max(0, visHalfW - W / 2 - 0.4);
    const tx = THREE.MathUtils.clamp(b.gem.x, -lim, lim);
    const to = V(tx, b.gem.y + 1.5 + H / 2, b.gem.z + 1.2);
    this.card = { i, t: 0, hiding: false, from: b.gem.clone(), to, W, H };
    m.visible = this.cardBeam.visible = true;
    this.cardBeam.material.color.copy(b.color);
    o.bubbles({ x: b.gem.x, y: b.gem.y + 0.8, z: b.gem.z + 1, count: 18, spread: 0.9, size: [0.08, 0.3], anchored: false });
  }

  hideCard(now = false) {
    if (!this.card) return;
    if (now) this.card.t = 0;
    this.card.hiding = true;
  }

  updateCard(dt) {
    const c = this.card;
    if (!c) return;
    c.t = clamp01(c.t + (c.hiding ? -dt / 0.3 : dt / 0.9));
    const e = c.hiding ? c.t : easeOutBack(c.t);
    const m = this.cardMesh;
    m.position.lerpVectors(c.from, c.to, smooth(0, 1, c.t));
    const sc = 0.15 + 0.85 * Math.min(1.04, e);
    m.scale.set(c.W * sc, c.H * sc, 1);
    m.material.opacity = smooth(0, 0.6, c.t);
    // Faisceau entre la pierre et la carte
    const beamLen = Math.max(0.01, m.position.y - m.scale.y / 2 - c.from.y);
    this.cardBeam.position.copy(c.from);
    this.cardBeam.scale.set(m.scale.x * 0.34, beamLen, m.scale.x * 0.34 * 0.5);
    this.cardBeam.material.opacity = 0.16 * smooth(0, 0.7, c.t);
    if (c.hiding && c.t <= 0) { m.visible = this.cardBeam.visible = false; this.card = null; }
  }

  // ─── Boucle ───────────────────────────────────────────────────────────────
  update(dt, t) {
    if (!this.active) return;
    const o = this.o;
    this.T += dt;
    const T = this.T;
    let veil = 0, stream = 0;

    if (this.phase === 'in') {
      stream = smooth(0, 1.2, T) * (1 - smooth(T_SWAP + 0.2, 3.4, T));
      veil = T < T_SWAP ? smooth(1, 2.2, T) : 1 - smooth(T_SWAP, T_READY, T);
      this.veil.material.color.copy(FOAM).lerp(new THREE.Color(SKILLS_BG), smooth(1.6, T_SWAP, T));
      if (T >= T_SWAP && !this.swapped) this.swap(true);
      if (this.swapped && T < T_READY) this.rushJitter(t, stream, 0);
      else if (!this.swapped) this.rushJitter(t, stream, 0);
      if (T >= T_READY) {
        this.phase = 'zone';
        o.rovBoost = 1;
        this.cb.onReady?.();
        o.jellies?.();
      }
    } else if (this.phase === 'out') {
      stream = smooth(0, 1, T) * (1 - smooth(T_BACK, T_BACK_END - 0.3, T));
      veil = T < T_BACK ? smooth(0.4, 1.3, T) : 1 - smooth(T_BACK, T_BACK_END, T);
      this.rushJitter(t, stream, 0.5);
      if (T >= T_BACK && this.swapped) this.swap(false);
      if (T >= T_BACK && !this.swapped) this.veil.material.color.lerp(FOAM, 0.08);
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
    this.updateCard(dt);
    this.animateScene(dt, t);
  }

  // Le robot « fonce » : légères vibrations pendant la poussée.
  rushJitter(t, k, y0) {
    this.o.rovFocus.set(Math.sin(t * 23) * 0.09 * k, y0 + Math.sin(t * 31) * 0.07 * k, 4);
  }

  updateZone(dt, t) {
    const o = this.o;
    const L = this.light;
    if (L) {
      L.t += dt;
      const b = this.blocks[L.i];
      // Le robot se place à côté de la petite pierre, côté centre de l'écran, et braque son projecteur dessus.
      const side = b.gem.x > 0 ? -1 : 1;
      o.rovFocus = V(b.gem.x + side * 2.3, b.gem.y - 0.2, b.gem.z + 3.2);
      o.focusPoint = b.gem.clone();
      if (!L.done && L.t > 1.3) {
        L.done = true;
        b.lit = true;
        o.bubbles({ x: b.gem.x, y: b.gem.y, z: b.gem.z + 1, count: 26, spread: 1, size: [0.1, 0.4], anchored: false });
        this.cb.onLit?.(L.i);
      }
      if (L.done && !L.shown && L.t > 1.3) { L.shown = true; this.showCard(L.i); }
      if (L.t > 2.8) { this.light = null; this.lighting = false; }
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
    for (const s of this.shafts ?? []) {
      s.material.opacity = 0.12 + 0.05 * Math.sin(t * 0.4 + s.userData.ph);
      s.position.x += Math.sin(t * 0.1 + s.userData.ph) * 0.004;
    }
    for (const gl of this.glowers ?? []) gl.material.opacity = 0.32 + 0.14 * Math.sin(t * 1.3 + gl.userData.ph);

    this.blocks.forEach((b, i) => {
      b.k += ((b.lit ? 1 : 0) - b.k) * (1 - Math.exp(-dt * 2.6));
      b.hov += ((this.hover === i && this.phase === 'zone' ? 1 : 0) - b.hov) * (1 - Math.exp(-dt * 8));
      const pulse = this.celebrate >= 0 ? 0.5 + 0.5 * Math.sin(this.celebrate * 3 - i * 0.7) : 0;
      const beaming = this.light?.i === i && this.lighting ? 1 : 0;
      // Seule la petite pierre s'allume ; éteinte, elle respire doucement pour se faire repérer.
      const idle = 0.1 + 0.06 * Math.sin(t * 2 + b.ph);
      b.crystalMat.emissiveIntensity = idle * (1 - b.k) + b.k * (1.9 + pulse * 1.2) + b.hov * 0.5 + beaming * 0.4;
      b.halo.material.opacity = (1 - b.k) * (0.1 + 0.05 * Math.sin(t * 2 + b.ph)) + b.k * (0.6 + pulse * 0.3) + b.hov * 0.15;
      b.halo.scale.setScalar(5 + b.k * 2);
      b.lamp.intensity = b.k * (24 + pulse * 18);
      b.crystal.position.y = CRY_Y + Math.sin(t * 1.4 + b.ph) * 0.14 * (0.4 + b.k);
      b.crystal.rotation.y += dt * (0.5 + b.k * 1.8);
    });
    if (this.celebrate >= 0) this.celebrate += dt;
  }
}
