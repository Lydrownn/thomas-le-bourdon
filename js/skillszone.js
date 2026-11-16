// Zone des compétences : le robot fonce vers le fond (les bulles filent derrière lui, à sa vitesse),
// puis une grotte bioluminescente où six piédestaux portent chacun une petite pierre à éclairer.
// Quand la pierre s'allume, le texte de la compétence sort du piédestal en hologramme.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as P from './props.js';
import { loadModels, hasModel, raw } from './assets.js';
import { makeJelly, pulseJelly } from './jelly.js';

const { rand } = P;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (a, b, x) => { const k = clamp01((x - a) / (b - a)); return k * k * (3 - 2 * k); };
const easeOutBack = (k) => 1 + 2.2 * (k - 1) ** 3 + 1.2 * (k - 1) ** 2;

export const SKILLS_BG = '#0a1238';
const FOAM = new THREE.Color(0x9fdcf5);
const FLOOR_Y = -3.6;
const ZONE_CAM = { pos: V(0, 3.4, 15.5), look: V(0, -0.6, 0) };
const T_SWAP = 2.4;   // le voile est opaque : on change de décor
const T_READY = 3.8;  // fin de la cinématique d'entrée
const T_BACK = 1.5;   // sortie : même principe, en plus court
const T_BACK_END = 2.8;
const CRY_Y = 4.0;    // hauteur par défaut de la petite pierre (piédestal procédural de secours)
const SKILL_MODELS = ['temple', ...Array.from({ length: 6 }, (_, i) => `skill_rock_${i}`)];
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
    this.sprintPos = V(0, 0, 0);
    this.sprintV = 0;
    this.camStart = V(0, 0, 20);

    this.group = new THREE.Group();
    this.group.visible = false;
    ocean.scene.add(this.group);

    // Voile : cache le décor de l'océan derrière le robot (le robot reste devant, à z = 4).
    this.veil = new THREE.Mesh(
      new THREE.PlaneGeometry(260, 260),
      new THREE.MeshBasicMaterial({ color: FOAM, transparent: true, opacity: 0, depthWrite: false, fog: false }),
    );
    this.veil.frustumCulled = false;
    this.veil.visible = false;
    ocean.scene.add(this.veil);

    this.buildStream();
  }

  // Les modèles Blender (temple, roches) sont chargés en différé : ils pèsent ~1,3 Mo.
  preload() {
    this.loading ??= loadModels(SKILL_MODELS).finally(() => { this.modelsSettled = true; });
    return this.loading;
  }

  ensureBuilt() {
    if (!this.modelsSettled || !this.groups.length) return false;
    if (!this.built) { this.buildScene(); this.built = true; }
    if (this.blocks.length !== this.groups.length) this.buildBlocks(this.groups);
    return true;
  }

  // ─── Vitesse : les bulles sortent du robot et restent derrière lui ───────
  // Toutes rondes (jamais étirées), petites, en espace monde : c'est le robot qui file, pas elles.
  buildStream() {
    const o = this.o;
    this.bubMat = o.bubbleMat.clone();
    this.bubMat.opacity = 0.85;
    this.bubs = new THREE.Group();
    this.bubs.visible = false;
    this.trail = Array.from({ length: 520 }, () => {
      const s = new THREE.Sprite(this.bubMat);
      s.visible = false;
      this.bubs.add(s);
      return { s, life: 0, max: 1, v: V(0, 0, 0), size: 0.2, ph: 0 };
    });
    // Bulles ambiantes : un nuage autour de la caméra qui se recycle vers l'avant, pour sentir la vitesse.
    this.ambient = Array.from({ length: 170 }, () => {
      const s = new THREE.Sprite(this.bubMat);
      this.bubs.add(s);
      return { s, off: V(rand(-9, 9), rand(-5, 6), rand(-1, 1)), size: rand(0.06, 0.26), ph: rand(0, 6.28), d: rand(1, 28) };
    });
    o.scene.add(this.bubs);
    this.emitAcc = 0;
    this.lastRov = V(0, 0, 0);
  }

  // speed : vitesse du robot (unités/s) ; k : 0..1 pour faire apparaître le nuage ambiant.
  updateBubbles(dt, t, speed, k) {
    const o = this.o;
    this.bubs.visible = k > 0.01 || this.trail.some((b) => b.life > 0);
    if (!this.bubs.visible) return;
    // Émission depuis l'arrière du robot, proportionnelle à sa vitesse.
    const sc = o.rov.scale.x;
    const heading = o.rovHeading;
    const back = V(-Math.cos(heading), 0, Math.sin(heading)); // opposé au nez du robot
    this.emitAcc += dt * Math.min(230, speed * 6) * (k > 0.01 ? 1 : 0);
    while (this.emitAcc >= 1) {
      this.emitAcc--;
      const b = this.trail.find((x) => x.life <= 0);
      if (!b) break;
      b.life = b.max = rand(1.1, 2.2);
      b.size = rand(0.09, 0.3) * (0.7 + sc * 0.4);
      b.ph = rand(0, 6.28);
      b.s.position.copy(o.rov.position)
        .addScaledVector(back, 1.1 * sc)
        .add(V(rand(-0.45, 0.45) * sc, rand(-0.35, 0.4) * sc, rand(-0.45, 0.45) * sc));
      b.v.set(rand(-0.6, 0.6), rand(0.2, 1.2), rand(-0.6, 0.6)).addScaledVector(back, rand(0.5, 2));
      b.s.visible = true;
    }
    for (const b of this.trail) {
      if (b.life <= 0) continue;
      b.life -= dt;
      if (b.life <= 0) { b.s.visible = false; continue; }
      b.v.x += Math.sin(t * 3 + b.ph) * dt * 1.2;
      b.s.position.addScaledVector(b.v, dt);
      const a = b.life / b.max;
      b.s.scale.setScalar(b.size * (0.5 + 0.5 * smooth(0, 0.25, 1 - a)) * smooth(0, 0.2, a));
    }
    // Nuage ambiant autour de la caméra : on recycle ce qui passe derrière elle.
    const cam = o.camera.position;
    for (const a of this.ambient) {
      a.s.visible = k > 0.01;
      if (!a.s.visible) continue;
      const rel = a.s.position.z - cam.z;
      if (rel > 3 || a.s.position.z === 0 && a.s.position.x === 0) {
        a.s.position.set(cam.x + a.off.x, cam.y + a.off.y, cam.z - rand(8, 32));
        a.d = rand(0, 1);
      }
      a.s.position.y += Math.sin(t * 1.5 + a.ph) * dt * 0.1 + dt * 0.15;
      a.s.scale.setScalar(a.size * k);
    }
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
        const x = side * rand(24, 38), z = rand(-26, -2);
        r.position.set(x, this.floorH(x, z) + s * 0.4, z);
        g.add(r);
      }
    }

    this.buildTemple();

    // Méduses lumineuses qui dérivent au-dessus de la grotte
    this.jellies = [];
    if (hasModel('jelly')) {
      const spots = [[-12, 5.5, -4, 0xff7ad9], [13, 6.5, -6, 0x6fe8ff], [-6.5, 9, -11, 0xb98bff], [7, 4, -10, 0x7affb0], [1, 11, -17, 0xffa2c0], [-17, 8, -14, 0x6fe8ff]];
      for (const [x, y, z, c] of spots) {
        const j = makeJelly(c, this.o.glowTex);
        j.group.scale.setScalar(rand(1.0, 1.6));
        j.group.position.set(x, y, z);
        g.add(j.group);
        this.jellies.push({ j, x, y, z, ph: rand(0, 6.28) });
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

  // Temple marin en ruine (modèle Blender) au fond de la grotte, avec son portail lumineux.
  buildTemple() {
    const t = raw('temple');
    if (!t) return;
    this.templeFx = [];
    t.traverse((m) => {
      if (!m.isMesh) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      m.material = mats.map((mt) => {
        const n = mt.clone();
        if (n.name === 'Rune') { n.emissive = new THREE.Color(0x2fd5ff); n.emissiveIntensity = 0.5; n.color.set(0x14203a); this.templeFx.push(n); }
        if (n.name === 'Glow') return new THREE.MeshBasicMaterial({ color: 0x6fe6ff, fog: false });
        if (n.name === 'Portal') {
          this.portal = new THREE.MeshBasicMaterial({ color: 0x3fb8ff, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
          return this.portal;
        }
        return n;
      });
      if (m.material.length === 1) m.material = m.material[0];
    });
    t.scale.setScalar(0.9);
    t.position.set(0, -3.1, -13);
    this.group.add(t);
    for (const [x, y, z, i] of [[0, 5.5, -22, 26], [-3.6, -0.2, -11.4, 9], [3.6, -0.2, -11.4, 9]]) {
      const l = new THREE.PointLight(0x4fe0ff, i, 28, 1.4);
      l.position.set(x, y, z);
      this.group.add(l);
    }
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
      let gy = CRY_Y;
      const runes = [];
      const model = hasModel(`skill_rock_${i}`) ? raw(`skill_rock_${i}`) : null;
      if (model) {
        // Roche ancienne modélisée sous Blender : elle remplace la dalle et le bloc.
        g.remove(slab, body);
        this.hitboxes.pop();
        g.add(model);
        model.traverse((m) => {
          if (!m.isMesh) return;
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          m.material = mats.map((mt) => {
            const n = mt.clone();
            if (n.name === 'Rune') { n.emissive = color.clone(); n.emissiveIntensity = 0.12; n.color.set(0x14203a); runes.push(n); }
            return n;
          });
          if (m.material.length === 1) m.material = m.material[0];
        });
        const gem = model.getObjectByName('Gem').position, tab = model.getObjectByName('Tablet').position;
        gy = gem.y;
        crystal.position.set(gem.x, gy, gem.z);
        halo.position.set(gem.x, gy, gem.z + 0.3);
        lamp.position.set(gem.x, gy + 0.4, gem.z + 1.6);
        hit.position.set(gem.x, gy, gem.z);
        glyph.geometry = new THREE.PlaneGeometry(0.85, 0.85);
        glyph.position.set(tab.x, tab.y, tab.z + 0.01);
        glyph.material.opacity = 0.4;
        const box = new THREE.Box3().setFromObject(model), sz = box.getSize(V(0, 0, 0)), c = box.getCenter(V(0, 0, 0));
        const bb = new THREE.Mesh(new THREE.BoxGeometry(sz.x, sz.y, sz.z), hitMat);
        bb.position.copy(c);
        bb.userData.block = i;
        g.add(bb);
        this.hitboxes.push(bb);
      }
      this.group.add(g);
      this.blocks.push({ group: g, crystal, crystalMat, halo, lamp, runes, gy, color, css, k: 0, lit: false, hov: 0, ph: rand(0, 6.28), size: 1 });
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
      b.group.rotation.y = hasModel(`skill_rock_${i}`) ? [0.1, -0.12, 0.06, -0.05, 0.14, -0.1][i % 6] : 0;
      b.gem = V(x, y0 + b.gy * s, z); // position de la petite pierre
    });
  }

  // ─── Cycle de vie ─────────────────────────────────────────────────────────
  enter(groups, cb = {}) {
    if (this.active) return;
    const o = this.o;
    this.cb = cb;
    this.groups = groups;
    this.preload();
    this.ensureBuilt();
    this.blocks.forEach((b) => { b.lit = false; b.k = 0; });
    this.layout();
    this.hideCard(true);
    this.active = true;
    this.phase = 'in';
    this.swapped = false;
    this.worldHidden = false;
    this.light = null;
    this.lighting = false;
    this.celebrate = -1;
    this.T = o.reduced ? T_SWAP : 0;
    this.veil.visible = true;
    this.veil.material.color.copy(FOAM);
    o.rovBoost = 1.25;
    o.rovSpeed = 40;
    this.sprintPos.copy(o.rov.position);
    this.sprintFrom = o.rov.position.clone();
    this.camStart.copy(o.camera.position);
    this.sprintV = 0;
    o.camAnim = null;
    o.rovFocus = this.sprintPos;
    this.headFrom = o.rovHeading;
    this.steer(0, 0.9);
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
    o.rovBoost = 1.25;
    o.rovSpeed = 40;
    this.sprintPos.copy(o.rov.position);
    this.sprintV = 0;
    o.rovFocus = this.sprintPos;
    this.headFrom = o.rovHeading;
    this.steer(0, 0.7);
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
      // La caméra se pose dans la grotte ; le robot y entre en freinant, ses bulles le suivent.
      o.rovBoost = 1;
      o.rovSpeed = 3.2;
      o.camAnim = null;
      o.camera.position.copy(ZONE_CAM.pos);
      o.camLook.copy(ZONE_CAM.look);
      o.rov.position.set(0, 0.8, 13);
      o.rovFocus = V(0, 0.8, 3);
      o.focusPoint = V(0, 0.8, -20);
      this.lastRov.copy(o.rov.position);
      o.camera.lookAt(o.camLook);
    } else {
      o.camera.position.set(0, 0, 20);
      o.camLook.set(0, 0, 0);
      o.camAnim = null;
      o.rovFocus = o.focusPoint = null;
      o.rovSpeed = null;
      o.rov.position.set(o.halfW * (o.narrow ? 0.55 : 0.72), o.halfH * 0.5, 2);
      o.rovHeading = -Math.PI / 2 - 0.88 * (o.narrow ? 1 : o.rovSide); // cap habituel, sans demi-tour visible
      this.lastRov.copy(o.rov.position);
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
    // La carte est placée dans le champ de la caméra : on mesure la largeur visible à sa profondeur,
    // on la rapproche un peu du centre, puis on la garde entièrement à l'écran (marges de 6 %).
    const cam = o.camera;
    const fwd = cam.getWorldDirection(V(0, 0, 0));
    const depth = Math.max(4, V(0, 0, 0).subVectors(b.gem, cam.position).dot(fwd) - 1.2);
    const th = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const visH = th * depth, visW = visH * cam.aspect;
    const W = Math.min(7, visW * 1.7), H = W / aspect;
    const limX = Math.max(0, visW * 0.94 - W / 2);
    const tx = THREE.MathUtils.clamp(b.gem.x * 0.7, -limX, limX);
    const camY = cam.position.y + fwd.y * depth;
    const wantY = b.gem.y + 1.5 + H / 2;
    const ty = Math.min(wantY, camY + visH * 0.94 - H / 2);
    const to = V(tx, Math.max(ty, b.gem.y + 0.9 + H / 2), b.gem.z + 1.2);
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
    let veil = 0, cloud = 0, emit = false;
    const speed = o.rov.position.distanceTo(this.lastRov) / Math.max(dt, 1e-3);
    this.lastRov.copy(o.rov.position);

    if (this.phase === 'in') {
      cloud = smooth(0, 0.8, T) * (1 - smooth(T_SWAP + 0.1, T_SWAP + 0.9, T));
      emit = T < T_READY - 0.4;
      if (!this.swapped) {
        // Sprint : le robot fonce droit devant lui (vers le fond), la caméra le suit par l'arrière.
        const v = 46 * smooth(0.2, 1.5, T);
        const k = 1 - Math.exp(-dt * 3);
        const sp = this.sprintPos;
        sp.z -= v * dt;
        sp.x += (0 - sp.x) * k;
        sp.y += (0.4 - sp.y) * k;
        o.rov.position.copy(sp);
        o.rov.position.y += Math.sin(t * 38) * 0.035 * smooth(0.3, 1.2, T);
        this.steer(T, 0.9);
        const b = smooth(0, 0.9, T);
        const rig = V(sp.x * 0.5 + Math.sin(t * 1.3) * 0.25, sp.y + 2.2, sp.z + 8.2 + v * 0.05);
        o.camera.position.lerpVectors(this.camStart, rig, b);
        o.camLook.lerpVectors(V(0, 0, 0), V(sp.x, sp.y + 0.1, sp.z - 6), b);
        o.camera.lookAt(o.camLook);
        // Voile : le décor de l'océan disparaît dans l'écume, puis s'assombrit vers la grotte.
        veil = smooth(0, 0.9, T);
        this.veil.material.color.copy(FOAM).lerp(new THREE.Color(SKILLS_BG), smooth(0.9, T_SWAP, T));
        if (T >= 1.1 && !this.worldHidden) this.hideWorld();
        if (T >= T_SWAP) {
          // Si les modèles ne sont pas encore là, on garde la course au même rythme et on attend.
          if (this.ensureBuilt()) { this.layout(); this.swap(true); } else this.T = T_SWAP - 0.01;
        }
      } else {
        veil = 1 - smooth(T_SWAP, T_SWAP + 0.9, T);
      }
      if (T >= T_READY) {
        this.phase = 'zone';
        o.rovBoost = 1;
        o.rovSpeed = null;
        this.cb.onReady?.();
      }
    } else if (this.phase === 'out') {
      cloud = smooth(0, 0.6, T) * (1 - smooth(T_BACK, T_BACK_END - 0.3, T));
      emit = T < T_BACK;
      veil = T < T_BACK ? smooth(0.5, 1.4, T) : 1 - smooth(T_BACK, T_BACK_END, T);
      if (this.swapped) {
        // Le robot s'élance vers le fond de la grotte et disparaît dans le voile.
        this.sprintV = 44 * smooth(0, 0.9, T);
        this.sprintPos.z -= this.sprintV * dt;
        o.rov.position.copy(this.sprintPos);
        this.steer(T, 0.7);
      }
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
        this.updateBubbles(dt, t, 0, 0, false);
        this.cb.onClosed?.();
        return;
      }
    }
    this.veil.material.opacity = veil;
    // Le voile suit la caméra, juste derrière le robot.
    this.veil.position.copy(o.camera.position).addScaledVector(o.camera.getWorldDirection(V(0, 0, 0)), 13.5);
    this.veil.quaternion.copy(o.camera.quaternion);
    this.updateBubbles(dt, t, speed, cloud, emit);

    if (this.phase === 'zone') this.updateZone(dt, t);
    this.updateCard(dt);
    this.animateScene(dt, t);
  }

  // Cap du robot pendant la course : il pivote progressivement (par le plus court) jusqu'à regarder
  // droit devant lui (vers le fond), sans jamais se retourner d'un coup.
  steer(T, dur) {
    const o = this.o;
    let d = Math.PI / 2 - this.headFrom;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const h = this.headFrom + d * smooth(0, dur, T);
    o.focusPoint = this.sprintPos.clone().add(V(Math.cos(h) * 10, 0, -Math.sin(h) * 10));
  }

  hideWorld() {
    const o = this.o;
    this.worldHidden = true;
    o.world.visible = false;
    for (let i = o.effects.length - 1; i >= 0; i--) o.removeEffect(o.effects[i]);
    o.effects.length = 0;
    o.bgOverride = SKILLS_BG;
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
        o.rovFocus = target;
        // Toujours face à la grotte ; le nez penche doucement vers le curseur, sans changer de côté d'un coup.
        const lean = THREE.MathUtils.clamp((target.x - o.rov.position.x) * 0.6, -2.5, 2.5);
        this.lean = (this.lean ?? 0) + (lean - (this.lean ?? 0)) * (1 - Math.exp(-dt * 3));
        o.focusPoint = target.clone().add(V(this.lean + 1.2, -0.6, -4.5));
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
      b.crystal.position.y = b.gy + Math.sin(t * 1.4 + b.ph) * 0.14 * (0.4 + b.k);
      for (const r of b.runes) r.emissiveIntensity = 0.12 + b.k * 0.55 + pulse * 0.3;
      b.crystal.rotation.y += dt * (0.5 + b.k * 1.8);
    });
    for (const e of this.jellies ?? []) {
      const p = Math.sin(t * 1.8 + e.ph);
      pulseJelly(e.j, p);
      e.j.group.position.set(e.x + Math.sin(t * 0.25 + e.ph) * 1.4, e.y + Math.sin(t * 0.5 + e.ph) * 0.8 + Math.max(0, -p) * 0.12, e.z);
      e.j.group.rotation.y += dt * 0.12;
    }
    for (const m of this.templeFx ?? []) m.emissiveIntensity = 0.5 + 0.2 * Math.sin(t * 1.1);
    if (this.portal) this.portal.opacity = 0.28 + 0.1 * Math.sin(t * 0.9);
    if (this.celebrate >= 0) this.celebrate += dt;
  }
}
