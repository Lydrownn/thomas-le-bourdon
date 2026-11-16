// Décors procéduraux : rochers, éponges, anémones, cheminées, et les objets à explorer.
import * as THREE from 'three';
import { raw, hasModel } from './assets.js';

export const rand = (a, b) => a + Math.random() * (b - a);
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];

// ─── Rochers ────────────────────────────────────────────────────────────────
export function rockGeometry(seed = Math.random() * 100, amp = 0.28, detail = 2) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    const n = Math.sin(v.x * 3.1 + seed) * Math.sin(v.y * 4.3 + seed * 1.7) * Math.sin(v.z * 3.7 + seed * 2.3)
      + 0.35 * Math.sin(v.x * 9 + v.z * 7 + seed);
    v.multiplyScalar(1 + n * amp);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

// Roches stratifiées modélisées sous Blender (rock_a…e), normalisées pour tenir dans [-1, 1]³ comme l'ancienne sphère.
const ROCK_MODELS = ['rock_a', 'rock_b', 'rock_c', 'rock_d', 'rock_e'];
const rockMats = new Map();
const rockFit = new Map();

export function rock(color, { sx = 1, sy = 1, sz = 1, seed } = {}) {
  const names = ROCK_MODELS.filter(hasModel);
  if (names.length) {
    const name = pick(names);
    const m = raw(name);
    if (!rockFit.has(name)) {
      const box = new THREE.Box3().setFromObject(m);
      const c = box.getCenter(new THREE.Vector3()), h = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
      rockFit.set(name, { c, k: new THREE.Vector3(1 / h.x, 1 / h.y, 1 / h.z) });
    }
    const { c, k } = rockFit.get(name);
    if (!rockMats.has(color)) {
      rockMats.set(color, new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(1.4), roughness: 0.95, vertexColors: true }));
    }
    const mat = rockMats.get(color);
    m.traverse((o) => { if (o.isMesh) o.material = mat; });
    const fit = new THREE.Group();
    m.position.copy(c).negate();
    fit.add(m);
    fit.scale.copy(k);
    const g = new THREE.Group();
    g.add(fit);
    g.scale.set(sx, sy, sz);
    return g;
  }
  const m = new THREE.Mesh(rockGeometry(seed), new THREE.MeshStandardMaterial({ color, roughness: 0.95, flatShading: true }));
  m.scale.set(sx, sy, sz);
  m.userData.own = true;
  return m;
}

// ─── Faune et flore fixées ──────────────────────────────────────────────────
export function starfish(color = 0xff7a45) {
  const s = new THREE.Shape();
  for (let i = 0; i <= 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    const r = i % 2 === 0 ? 0.5 : 0.2;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r); else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.06, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.04, bevelSegments: 2 });
  g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 0.7, flatShading: true }));
  m.userData.own = true;
  return m;
}

export function sponge(color = 0xe8c26a, h = 1.2, glow = 0) {
  const pts = [[0.12, 0], [0.26, 0.25], [0.24, 0.6], [0.3, 1], [0.36, 1.2]].map(([x, y]) => new THREE.Vector2(x, y * h / 1.2));
  const m = new THREE.Mesh(new THREE.LatheGeometry(pts, 14), new THREE.MeshStandardMaterial({
    color, roughness: 0.8, side: THREE.DoubleSide, flatShading: true, emissive: color, emissiveIntensity: glow,
  }));
  m.userData.own = true;
  return m;
}

export function anemone(color = 0xff6fb5, glow = 0, n = 22) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, emissive: color, emissiveIntensity: glow });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.36, 0.3, 12), mat);
  base.position.y = 0.15;
  base.userData.own = true;
  g.add(base);
  const tGeo = new THREE.ConeGeometry(0.04, 0.6, 5).translate(0, 0.3, 0);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = 0.12 + (i % 3) * 0.06;
    const t = new THREE.Mesh(tGeo, mat);
    t.position.set(Math.cos(a) * r, 0.28, Math.sin(a) * r);
    t.rotation.set(Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6);
    g.add(t);
  }
  g.userData.tentacleGeo = tGeo;
  g.userData.sway = rand(0, 6);
  return g;
}

export function tubeWorms(n = 9) {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xe9e4d8, roughness: 0.7 });
  const red = new THREE.MeshStandardMaterial({ color: 0xd9283c, emissive: 0x6a0a14, emissiveIntensity: 0.6, roughness: 0.5 });
  for (let i = 0; i < n; i++) {
    const h = rand(0.8, 2.2);
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, h, 8).translate(0, h / 2, 0), white);
    const plume = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), red);
    plume.scale.y = 1.6;
    plume.position.y = h + 0.12;
    const w = new THREE.Group();
    w.add(tube, plume);
    w.position.set(rand(-0.6, 0.6), 0, rand(-0.6, 0.6));
    w.rotation.set(rand(-0.15, 0.15), 0, rand(-0.15, 0.15));
    tube.userData.own = plume.userData.own = true;
    g.add(w);
  }
  g.userData.sway = rand(0, 6);
  return g;
}

// ─── Objets à explorer (un par section) ─────────────────────────────────────
const own = (m) => { m.userData.own = true; return m; };

export function bottle() {
  const g = new THREE.Group();
  const profile = [[0, 0], [0.32, 0], [0.34, 0.08], [0.34, 0.9], [0.3, 1.05], [0.13, 1.25], [0.12, 1.55], [0.14, 1.6]]
    .map(([x, y]) => new THREE.Vector2(x, y));
  const glass = own(new THREE.Mesh(new THREE.LatheGeometry(profile, 24), new THREE.MeshPhysicalMaterial({
    color: 0x7fd6a8, roughness: 0.08, metalness: 0, transmission: 0.6, transparent: true, opacity: 0.55, side: THREE.DoubleSide,
  })));
  const cork = own(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.1, 0.22, 12), new THREE.MeshStandardMaterial({ color: 0xa8743f, roughness: 0.9 })));
  cork.position.y = 1.65;
  const paper = own(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.7, 16), new THREE.MeshStandardMaterial({
    color: 0xf3e6c4, roughness: 0.9, emissive: 0xf3e6c4, emissiveIntensity: 0.15,
  })));
  paper.position.y = 0.5;
  const ribbon = own(new THREE.Mesh(new THREE.TorusGeometry(0.165, 0.025, 6, 20), new THREE.MeshStandardMaterial({ color: 0xc0392b })));
  ribbon.rotation.x = Math.PI / 2;
  ribbon.position.y = 0.5;
  g.add(glass, cork, paper, ribbon);
  g.rotation.set(0.15, 0.6, Math.PI / 2.3);
  g.position.y = 0.3;
  const wrap = new THREE.Group();
  wrap.add(g);
  return wrap;
}

export function helm() {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.8, flatShading: true });
  const brass = new THREE.MeshStandardMaterial({ color: 0xd4a74a, metalness: 0.8, roughness: 0.3 });
  g.add(own(new THREE.Mesh(new THREE.TorusGeometry(1, 0.09, 8, 32), wood)));
  const hub = own(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.25, 16).rotateX(Math.PI / 2), brass));
  g.add(hub);
  const spokeGeo = new THREE.CylinderGeometry(0.05, 0.05, 1.5, 6).translate(0, 0.75, 0);
  const handleGeo = new THREE.CylinderGeometry(0.07, 0.05, 0.4, 8).translate(0, 1.6, 0);
  for (let i = 0; i < 8; i++) {
    const s = own(new THREE.Mesh(spokeGeo, wood));
    const h = own(new THREE.Mesh(handleGeo, wood));
    s.rotation.z = h.rotation.z = (i / 8) * Math.PI * 2;
    g.add(s, h);
  }
  g.rotation.set(-0.35, 0.5, 0.2);
  g.position.y = 1.2;
  const wrap = new THREE.Group();
  wrap.add(g);
  wrap.userData.spin = g;
  return wrap;
}

export function chain(links = 9) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x6f6a63, metalness: 0.7, roughness: 0.55 });
  const geo = new THREE.TorusGeometry(0.16, 0.045, 6, 14);
  geo.scale(1.5, 1, 1);
  for (let i = 0; i < links; i++) {
    const l = new THREE.Mesh(geo, mat);
    l.position.set(i * 0.38, Math.sin(i * 0.6) * 0.05, Math.sin(i * 0.45) * 0.35);
    l.rotation.x = i % 2 ? Math.PI / 2 : 0;
    l.rotation.y = Math.sin(i * 0.45) * 0.4;
    g.add(l);
  }
  g.children[0].userData.own = true;
  return g;
}

export function lab() {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0x9aa7b4, metalness: 0.7, roughness: 0.35 });
  const yellow = new THREE.MeshStandardMaterial({ color: 0xffc233, roughness: 0.45 });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x9fe8ff, roughness: 0.05, transmission: 0.5, transparent: true, opacity: 0.45, emissive: 0x1e8fb3, emissiveIntensity: 0.5,
  });
  const ring = own(new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.3, 0.35, 24), yellow));
  ring.position.y = 0.75;
  const dome = own(new THREE.Mesh(new THREE.SphereGeometry(1.1, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), glass));
  dome.position.y = 0.92;
  const core = own(new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 0.7, 12), new THREE.MeshStandardMaterial({
    color: 0x5ee7ff, emissive: 0x5ee7ff, emissiveIntensity: 1.2,
  })));
  core.position.y = 1.25;
  g.add(ring, dome, core);
  const legGeo = new THREE.CylinderGeometry(0.06, 0.08, 0.8, 6);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const leg = own(new THREE.Mesh(legGeo, steel));
    leg.position.set(Math.cos(a) * 1.05, 0.38, Math.sin(a) * 1.05);
    leg.rotation.set(Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25);
    g.add(leg);
  }
  const mast = own(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.4, 6), steel));
  mast.position.set(0.6, 2.2, -0.3);
  const dish = own(new THREE.Mesh(new THREE.SphereGeometry(0.35, 16, 8, 0, Math.PI * 2, 0, Math.PI / 3.5), steel));
  dish.material.side = THREE.DoubleSide;
  dish.position.set(0.6, 2.9, -0.3);
  dish.rotation.set(0.9, 0, 0.5);
  const blink = own(new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff4d4d })));
  blink.position.set(0.6, 2.95, -0.3);
  g.add(mast, dish, blink);
  g.userData.blink = blink;
  g.userData.dish = dish;
  return g;
}

export function clam() {
  const g = new THREE.Group();
  const shell = new THREE.MeshStandardMaterial({ color: 0xc9b6e4, roughness: 0.5, flatShading: true, side: THREE.DoubleSide });
  const half = new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  const p = half.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const a = Math.atan2(p.getZ(i), p.getX(i));
    const k = 1 + Math.abs(Math.sin(a * 6)) * 0.08;
    p.setXYZ(i, p.getX(i) * k, p.getY(i), p.getZ(i) * k);
  }
  half.computeVertexNormals();
  const bottom = own(new THREE.Mesh(half, shell));
  bottom.scale.set(1, -0.35, 0.85);
  bottom.position.y = 0.35;
  const top = new THREE.Mesh(half, shell);
  top.scale.set(1, 0.35, 0.85);
  const hinge = new THREE.Group();
  hinge.position.set(-1, 0.35, 0);
  top.position.x = 1;
  hinge.add(top);
  hinge.rotation.z = 0.75;
  const pearl = own(new THREE.Mesh(new THREE.SphereGeometry(0.25, 20, 14), new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.15, metalness: 0.3, emissive: 0xfff1f7, emissiveIntensity: 0.6,
  })));
  pearl.position.set(0.1, 0.5, 0);
  g.add(bottom, hinge, pearl);
  g.userData.hinge = hinge;
  return g;
}

// Balise qui signale qu'une zone est explorable.
export function beacon(glowTex) {
  const g = new THREE.Group();
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x7affe0, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  const rings = [0, 0.5].map(() => {
    const r = own(new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48), ringMat.clone()));
    g.add(r);
    return r;
  });
  const dot = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: 0x7affe0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  }));
  dot.scale.setScalar(0.9);
  g.add(dot);
  g.userData = { rings, dot };
  return g;
}
