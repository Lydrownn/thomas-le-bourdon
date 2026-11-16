// Scène 3D de l'océan : ROV compagnon, neige marine, décor ancré au scroll
// (stations explorables, falaises, plancher abyssal) et créatures déclenchées.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { loadModels, instance, tint, hasModel } from './assets.js';
import { makeJelly, pulseJelly, setJellyTime } from './jelly.js';
import * as P from './props.js';
import { SkillsZone } from './skillszone.js';

const { rand, pick } = P;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
const CAM_Z = 20;
const ANGLER_Z = -1;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const at = (obj, x, y, z) => { obj.position.set(x, y, z); return obj; };

// ─── Textures générées ──────────────────────────────────────────────────────
function canvasTexture(draw, size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size / 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const bubbleTexture = () => canvasTexture((g, r) => {
  const grad = g.createRadialGradient(r * 0.7, r * 0.6, r * 0.04, r, r, r);
  grad.addColorStop(0, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.18, 'rgba(255,255,255,0.18)');
  grad.addColorStop(0.75, 'rgba(200,240,255,0.10)');
  grad.addColorStop(0.92, 'rgba(255,255,255,0.75)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.beginPath(); g.arc(r, r, r, 0, Math.PI * 2); g.fill();
});
const glowTexture = () => canvasTexture((g, r) => {
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.5)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, r * 2, r * 2);
});

// ─── Poissons procéduraux (repli, et poissons-lanternes des profondeurs) ────
const FISH_BODY = new THREE.SphereGeometry(0.5, 14, 10);
const FISH_TAIL = new THREE.ConeGeometry(0.32, 0.55, 4).rotateZ(-Math.PI / 2).translate(-0.275, 0, 0);
const FISH_FIN = new THREE.ConeGeometry(0.16, 0.36, 3).rotateZ(Math.PI * 0.15);
const EYE = new THREE.SphereGeometry(0.06, 8, 6);
const DOT = new THREE.SphereGeometry(0.035, 6, 4);
const EYE_MAT = new THREE.MeshBasicMaterial({ color: 0x0a0a12 });
const PHOTOPHORE = new THREE.MeshBasicMaterial({ color: 0x7affe0 });
const matCache = new Map();
const fishMat = (color, glow) => {
  const key = `${color}-${glow}`;
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshStandardMaterial({
      color, roughness: 0.45, metalness: 0.25, flatShading: true,
      emissive: glow ? color : 0x000000, emissiveIntensity: glow ? 0.15 : 0,
    }));
  }
  return matCache.get(key);
};

function makeFish(color, glow) {
  const mat = fishMat(color, glow);
  const g = new THREE.Group();
  const body = new THREE.Mesh(FISH_BODY, mat);
  body.scale.set(1.2, 0.55, 0.3);
  const tailPivot = new THREE.Group();
  tailPivot.position.x = -0.5;
  const tail = new THREE.Mesh(FISH_TAIL, mat);
  tail.scale.z = 0.25;
  tailPivot.add(tail);
  const fin = new THREE.Mesh(FISH_FIN, mat);
  fin.position.set(0, 0.3, 0); fin.scale.z = 0.2;
  const eyeL = new THREE.Mesh(EYE, EYE_MAT); eyeL.position.set(0.4, 0.07, 0.13);
  const eyeR = new THREE.Mesh(EYE, EYE_MAT); eyeR.position.set(0.4, 0.07, -0.13);
  g.add(body, tailPivot, fin, eyeL, eyeR);
  if (glow) {
    for (let i = 0; i < 4; i++) {
      for (const z of [0.15, -0.15]) {
        const d = new THREE.Mesh(DOT, PHOTOPHORE);
        d.position.set(0.3 - i * 0.2, -0.12, z);
        g.add(d);
      }
    }
  }
  g.userData.tail = tailPivot;
  return g;
}

const PALETTES = {
  tropical: [0xff8a3d, 0xffd23f, 0x3dd6ff, 0xff5fa2, 0xffffff],
  silver: [0xa8c2d8, 0x7b9cbf, 0xcfe0ee, 0x5f84ad],
  deep: [0x1c2b3c, 0x243649, 0x2e2238],
};

const ROCK_COLORS = { shallow: 0x9a8b74, twilight: 0x56606e, deep: 0x323844 };

export class Ocean {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x3aa6dc, 22, 75);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
    this.camera.position.set(0, 0, CAM_Z);
    this.camLook = V(0, 0, 0);
    this.camAnim = null;

    this.depth = 0;
    this.scrollVel = 0;
    this.lastScroll = window.scrollY;
    this.mouse = new THREE.Vector2();
    this.effects = [];
    this.mixers = new Set();
    this.time = 0;
    this.nextAmbient = 4;
    this.nextTrail = 0;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Décor ancré : il défile avec la page.
    this.world = new THREE.Group();
    this.scene.add(this.world);
    this.stations = new Map();
    this.hitboxes = [];
    this.swayers = [];
    this.animated = [];
    this.focused = null;
    this.focusK = 0;
    this.hovered = null;
    this.raycaster = new THREE.Raycaster();
    this.rovBoost = 1;      // taille du robot (agrandi pendant la cinématique des compétences)
    this.rovBoostS = 1;
    this.rovSpeed = null;   // vitesse de suivi imposée (zone des compétences)
    this.bgOverride = null; // couleur d'eau imposée (zone des compétences)

    this.hemi = new THREE.HemisphereLight(0xcdefff, 0x0a1a33, 1.4);
    this.sun = new THREE.DirectionalLight(0xffffff, 2);
    this.sun.position.set(4, 12, 8);
    this.stationLight = new THREE.PointLight(0xbfe8ff, 0, 16, 1.1);
    this.scene.add(this.hemi, this.sun, this.stationLight);
    this.baseHemi = 1.4;
    this.baseSun = 2;

    this.bubbleMat = new THREE.SpriteMaterial({ map: bubbleTexture(), transparent: true, depthWrite: false });
    this.glowTex = glowTexture();

    this.resize();
    this.buildSnow();
    this.buildRov();
    this.buildBeam();
    this.buildAngler();
    this.zone = new SkillsZone(this);

    addEventListener('resize', () => this.resize());
    addEventListener('pointermove', (e) => {
      this.mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    });
    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this.tick());

    this.ready = loadModels().then(() => {
      this.modelsLoaded = true;
      if (this.layoutArgs) this.layout(...this.layoutArgs);
    });
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.halfH = Math.tan(THREE.MathUtils.degToRad(25)) * CAM_Z;
    this.halfW = this.halfH * this.camera.aspect;
    this.narrow = w < 760;
  }

  get pxToWorld() { return (2 * this.halfH) / innerHeight; }
  edgeAt(z) { return this.halfW * (CAM_Z - z) / CAM_Z; }
  screenToWorld(x, y) {
    return V((x / innerWidth * 2 - 1) * this.halfW, -(y / innerHeight * 2 - 1) * this.halfH, 0);
  }
  docToWorldY(docY) { return -(docY - innerHeight / 2) * this.pxToWorld; }

  register(root) {
    root.traverse((o) => { if (o.userData.mixer) this.mixers.add(o.userData.mixer); });
    return root;
  }

  // ─── Neige marine ─────────────────────────────────────────────────────────
  buildSnow() {
    const N = 900;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = rand(-32, 32);
      pos[i * 3 + 1] = rand(-16, 16);
      pos[i * 3 + 2] = rand(-24, 8);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.snowMat = new THREE.PointsMaterial({
      size: 0.14, map: this.glowTex, transparent: true, depthWrite: false, opacity: 0.3, color: 0xffffff,
    });
    this.snow = new THREE.Points(geo, this.snowMat);
    this.snow.frustumCulled = false;
    this.scene.add(this.snow);
  }

  updateSnow(dt, worldDelta) {
    const p = this.snow.geometry.attributes.position;
    const a = p.array;
    for (let i = 0; i < a.length; i += 3) {
      a[i + 1] += worldDelta - 0.18 * dt;
      a[i] += Math.sin(this.time * 0.3 + i) * 0.003;
      if (a[i + 1] > 16) a[i + 1] -= 32;
      else if (a[i + 1] < -16) a[i + 1] += 32;
    }
    p.needsUpdate = true;
    this.snow.position.copy(this.camera.position).sub(V(0, 0, CAM_Z));
  }

  // ─── ROV (robot sous-marin compagnon) ─────────────────────────────────────
  buildRov() {
    const yellow = new THREE.MeshStandardMaterial({ color: 0xffc233, roughness: 0.4, metalness: 0.1 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1d2633, roughness: 0.55, metalness: 0.5 });
    const orange = new THREE.MeshStandardMaterial({ color: 0xff6b2c, roughness: 0.5 });
    const glass = new THREE.MeshStandardMaterial({
      color: 0xbfefff, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.45,
    });
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x5ee7ff });

    const outer = new THREE.Group();
    const inner = new THREE.Group();
    inner.rotation.order = 'YZX';
    outer.add(inner);

    const body = new THREE.Mesh(new RoundedBoxGeometry(2.4, 1.1, 1.6, 4, 0.28), yellow);
    body.position.y = 0.25;
    const stripe = new THREE.Mesh(new RoundedBoxGeometry(2.42, 0.16, 1.62, 2, 0.06), orange);
    stripe.position.y = -0.1;
    const lid = new THREE.Mesh(new RoundedBoxGeometry(1.6, 0.18, 1.1, 2, 0.08), dark);
    lid.position.set(-0.2, 0.86, 0);
    inner.add(body, stripe, lid);

    const skidGeo = new THREE.CylinderGeometry(0.07, 0.07, 2.6, 8).rotateZ(Math.PI / 2);
    const legGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.4, 6);
    for (const z of [0.6, -0.6]) {
      const skid = new THREE.Mesh(skidGeo, dark);
      skid.position.set(0, -0.55, z);
      inner.add(skid);
      for (const x of [0.8, -0.8]) {
        const leg = new THREE.Mesh(legGeo, dark);
        leg.position.set(x, -0.35, z);
        inner.add(leg);
      }
    }

    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.55, 24, 16, 0, Math.PI), glass);
    dome.rotation.y = Math.PI / 2;
    dome.position.set(1.15, 0.25, 0);
    inner.add(dome);
    this.rovEyes = [];
    for (const z of [0.2, -0.2]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 8), eyeMat);
      eye.position.set(1.42, 0.32, z);
      eye.scale.set(0.6, 1, 1);
      inner.add(eye);
      this.rovEyes.push(eye);
    }

    this.props = [];
    const ductGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.7, 16, 1, true).rotateZ(Math.PI / 2);
    const ductMat = new THREE.MeshStandardMaterial({ color: 0x1d2633, metalness: 0.5, roughness: 0.5, side: THREE.DoubleSide });
    const bladeGeo = new THREE.BoxGeometry(0.04, 0.5, 0.08);
    for (const z of [0.98, -0.98]) {
      const duct = new THREE.Mesh(ductGeo, ductMat);
      duct.position.set(-0.5, 0.15, z);
      const prop = new THREE.Group();
      prop.position.set(-0.55, 0.15, z);
      for (let i = 0; i < 3; i++) {
        const blade = new THREE.Mesh(bladeGeo, orange);
        blade.rotation.x = (i / 3) * Math.PI * 2;
        prop.add(blade);
      }
      inner.add(duct, prop);
      this.props.push(prop);
    }

    const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff3c4 });
    for (const z of [0.55, -0.55]) {
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), lampMat);
      lamp.position.set(1.22, -0.25, z);
      inner.add(lamp);
    }
    this.spot = new THREE.SpotLight(0xfff1c8, 0, 45, 0.5, 0.55, 1);
    this.spot.position.set(1.3, -0.2, 0);
    this.spotTarget = new THREE.Object3D();
    this.scene.add(this.spotTarget);
    this.spot.target = this.spotTarget;
    inner.add(this.spot);
    this.headGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.glowTex, color: 0xfff1c8, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0,
    }));
    this.headGlow.position.set(1.6, -0.25, 0);
    this.headGlow.scale.setScalar(2.4);
    inner.add(this.headGlow);

    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.6, 6), dark);
    antenna.position.set(-0.7, 1.2, 0.3);
    this.beaconLamp = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3b3b }));
    this.beaconLamp.position.set(-0.7, 1.52, 0.3);
    inner.add(antenna, this.beaconLamp);

    this.tether = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(Array.from({ length: 32 }, () => V(0, 0, 0))),
      new THREE.LineBasicMaterial({ color: 0xff8a3d, transparent: true, opacity: 0.7 }),
    );
    this.tether.frustumCulled = false;
    this.scene.add(this.tether);

    this.rovFill = new THREE.PointLight(0xdff4ff, 0, 10, 1);
    this.rovFill.position.set(1.5, 2.5, 3);
    outer.add(this.rovFill);

    outer.scale.setScalar(0.001);
    this.rov = outer;
    this.rovInner = inner;
    this.rovScale = 0;
    this.rovHeading = -2.45;
    this.rovSide = 1;
    this.scene.add(outer);
  }

  // Faisceau volumétrique du projecteur, visible en mode exploration.
  buildBeam() {
    const geo = new THREE.ConeGeometry(1, 1, 40, 1, true).translate(0, -0.5, 0).rotateX(-Math.PI / 2);
    this.beam = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: { uOpacity: { value: 0 }, uColor: { value: new THREE.Color(0xfff1c8) } },
      vertexShader: 'varying float vZ; void main(){ vZ = position.z; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform float uOpacity; uniform vec3 uColor; varying float vZ; void main(){ gl_FragColor = vec4(uColor, uOpacity * (1.0 - vZ) * 0.28); }',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    this.beam.visible = false;
    this.beam.frustumCulled = false;
    this.scene.add(this.beam);
  }

  updateRov(dt) {
    const t = this.time;
    const show = this.depth > 6 || this.focused || this.zone.active ? 1 : 0;
    this.rovScale += (show - this.rovScale) * (1 - Math.exp(-dt * 3));
    this.rovBoostS += (this.rovBoost - this.rovBoostS) * (1 - Math.exp(-dt * 2));
    const base = (this.narrow ? 0.5 : 0.8) * (this.focused ? 0.75 : 1) * this.rovBoostS;
    this.rov.scale.setScalar(Math.max(0.001, this.rovScale * base));
    this.rov.visible = this.tether.visible = this.rovScale > 0.02;

    // Le robot se tient du côté du promontoire le plus proche, à l'écart du texte.
    const side = this.narrow ? 1 : this.nearSide ?? 1;
    this.rovSide += (side - this.rovSide) * (1 - Math.exp(-dt * 0.9));
    let target;
    if (this.rovFocus) {
      target = this.rovFocus.clone().add(V(Math.sin(t * 0.9) * 0.15, Math.sin(t * 1.3) * 0.12, 0));
    } else {
      target = V(
        this.halfW * (this.narrow ? 0.55 : 0.72) * this.rovSide + this.mouse.x * 0.7,
        this.halfH * (this.narrow ? 0.66 : 0.5) + this.mouse.y * 0.4 + Math.sin(t * 1.1) * 0.3 + (1 - this.rovScale) * this.halfH,
        2,
      );
    }
    const k = 1 - Math.exp(-dt * (this.rovSpeed ?? (this.rovFocus ? 1.6 : 2.2)));
    this.rov.position.lerp(target, k);

    // Cap : vers la zone explorée, sinon légèrement tourné vers le lecteur.
    let heading = -Math.PI / 2 - 0.88 * this.rovSide + this.mouse.x * 0.35 + Math.sin(t * 0.6) * 0.08;
    let pitch = 0;
    if (this.focusPoint && this.rovFocus) {
      const d = this.focusPoint.clone().sub(this.rov.position);
      heading = Math.atan2(-d.z, d.x);
      pitch = Math.atan2(d.y, Math.hypot(d.x, d.z)) * 0.6;
    }
    let dh = heading - this.rovHeading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    this.rovHeading += dh * k;
    this.rovInner.rotation.y = this.rovHeading;
    this.rovInner.rotation.z += (pitch - this.rovInner.rotation.z) * k;
    this.rovInner.rotation.x = Math.sin(t * 0.9) * 0.05;
    const scrollPitch = this.focused ? 0 : THREE.MathUtils.clamp(this.scrollVel * 0.00025, -0.4, 0.4);
    this.rov.rotation.z += (scrollPitch - this.rov.rotation.z) * k;

    const spin = 6 + Math.abs(this.scrollVel) * 0.02 + (this.camAnim ? 20 : 0);
    for (const p of this.props) p.rotation.x += spin * dt;
    this.beaconLamp.visible = Math.sin(t * 4) > 0.2;
    const blink = (t % 4.2) < 0.12 ? 0.15 : 1;
    for (const e of this.rovEyes) e.scale.y = blink;

    const dark = clamp01((this.depth - 150) / 1200);
    this.spot.intensity = Math.max(dark * 220, this.focusK * 420);
    this.headGlow.material.opacity = Math.max(dark * 0.9, this.focusK);
    this.rovFill.intensity = dark * 14;

    // Cible du projecteur
    const free = this.rovInner.localToWorld(V(8, -1.5, 0));
    this.spotTarget.position.lerpVectors(free, this.focusPoint ?? free, this.focusK);

    // Faisceau
    this.beam.visible = this.focusK > 0.02 && this.rov.visible;
    if (this.beam.visible) {
      const lamp = this.rovInner.localToWorld(V(1.35, -0.25, 0));
      const len = lamp.distanceTo(this.spotTarget.position) * 1.1;
      this.beam.position.copy(lamp);
      this.beam.lookAt(this.spotTarget.position);
      this.beam.scale.set(len * 0.34, len * 0.34, len);
      this.beam.material.uniforms.uOpacity.value = this.focusK;
    }

    // Câble ombilical vers la surface
    const a = this.rovInner.localToWorld(V(-1.0, 0.9, 0));
    const topY = this.camera.position.y + this.halfH * (this.camera.position.z / CAM_Z) + 4;
    const top = V(a.x + 2.5 * this.rovSide, topY, a.z);
    const ctrl = V((a.x + top.x) / 2 + 1.5 * this.rovSide + Math.sin(t * 0.7) * 0.6, (a.y + top.y) / 2 - 1.5, a.z);
    this.tether.geometry.setFromPoints(new THREE.QuadraticBezierCurve3(a, ctrl, top).getPoints(31));

    if (this.rov.visible && t > this.nextTrail) {
      this.nextTrail = t + rand(0.25, 0.6);
      const p = this.rovInner.localToWorld(V(-0.9, 0.15, pick([0.98, -0.98])));
      this.bubbles({ x: p.x, y: p.y, z: p.z, count: 1, spread: 0.1, size: [0.06, 0.16], anchored: false });
    }
  }

  // ─── Baudroie des abysses (persistante sur le contact) ───────────────────
  buildAngler() {
    const skin = new THREE.MeshStandardMaterial({ color: 0x1a2430, roughness: 0.85, flatShading: true });
    const g = new THREE.Group();
    const inner = new THREE.Group();
    g.add(inner);
    const body = new THREE.Mesh(new THREE.SphereGeometry(1.3, 18, 14), skin);
    body.scale.set(1.25, 1, 0.9);
    inner.add(body);
    const jaw = new THREE.Mesh(new THREE.SphereGeometry(1.05, 16, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), skin);
    jaw.position.set(0.7, -0.15, 0);
    jaw.scale.set(1, 0.7, 0.85);
    inner.add(jaw);
    const toothMat = new THREE.MeshStandardMaterial({ color: 0xe8eef2, emissive: 0x334455, roughness: 0.3 });
    const toothGeo = new THREE.ConeGeometry(0.06, 0.32, 4);
    for (let i = 0; i < 9; i++) {
      const ang = -0.9 + (i / 8) * 1.8;
      const up = i % 2 === 0;
      const tooth = new THREE.Mesh(toothGeo, toothMat);
      tooth.position.set(0.7 + Math.cos(ang) * 0.95, up ? -0.18 : -0.08, Math.sin(ang) * 0.85);
      if (!up) tooth.rotation.z = Math.PI;
      inner.add(tooth);
    }
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0xcfd9e0, emissive: 0x1d3140 });
    for (const z of [0.62, -0.62]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), eyeMat);
      eye.position.set(1.0, 0.5, z);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), EYE_MAT);
      pupil.position.set(1.12, 0.52, z * 1.08);
      inner.add(eye, pupil);
    }
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.8, 1.2, 4).rotateZ(-Math.PI / 2), skin);
    tail.scale.z = 0.25;
    tail.position.x = -2.0;
    inner.add(tail);
    this.anglerTail = tail;

    const stalkCurve = new THREE.CatmullRomCurve3([
      V(0.5, 1.15, 0), V(1.2, 2.2, 0), V(2.2, 2.5, 0), V(2.9, 1.8, 0),
    ]);
    inner.add(new THREE.Mesh(new THREE.TubeGeometry(stalkCurve, 24, 0.04, 6), skin));
    const lure = new THREE.Group();
    lure.position.set(2.9, 1.7, 0);
    lure.add(new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 8), new THREE.MeshBasicMaterial({ color: 0xc8fff0 })));
    this.lureGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.glowTex, color: 0x7affe0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.lureGlow.scale.setScalar(3);
    this.lureLight = new THREE.PointLight(0x7affe0, 0, 14, 1.2);
    lure.add(this.lureGlow, this.lureLight);
    inner.add(lure);

    g.visible = false;
    this.angler = g;
    this.anglerInner = inner;
    this.anglerOn = false;
    this.anglerScale = 0;
    this.scene.add(g);
  }

  setAngler(on) { this.anglerOn = on; }

  updateAngler(dt) {
    const t = this.time;
    this.anglerScale += ((this.anglerOn ? 1 : 0) - this.anglerScale) * (1 - Math.exp(-dt * 1.5));
    this.angler.visible = this.anglerScale > 0.01;
    if (!this.angler.visible) return;
    const s = this.narrow ? 0.55 : 0.9;
    this.angler.scale.setScalar(s);
    const x0 = this.narrow ? this.halfW * 0.2 : this.halfW * 0.45;
    const x = x0 + (1 - this.anglerScale) * this.halfW * 0.8 + Math.sin(t * 0.4) * 0.4;
    let y = -this.halfH * 0.3 + Math.sin(t * 0.8) * 0.3;
    // Le plancher remonte avec le scroll : la baudroie reste au-dessus (ventre ≈ 1,4 sous son centre).
    if (this.seabed) {
      const floorY = this.seabed.position.y + this.world.position.y
        + Math.max(this.floorH(x - 2 * s, ANGLER_Z), this.floorH(x, ANGLER_Z), this.floorH(x + 2 * s, ANGLER_Z));
      y = Math.max(y, floorY + 1.9 * s + Math.sin(t * 0.8) * 0.15);
    }
    this.angler.position.set(x, y, ANGLER_Z);
    this.anglerInner.rotation.y = Math.PI + 0.45 + this.mouse.x * 0.2;
    this.anglerInner.rotation.z = Math.sin(t * 0.8) * 0.05;
    this.anglerTail.rotation.y = Math.sin(t * 3) * 0.35;
    const flicker = 0.85 + Math.sin(t * 7) * 0.08 + Math.sin(t * 13) * 0.05;
    this.lureGlow.material.opacity = flicker * this.anglerScale;
    this.lureLight.intensity = 40 * flicker * this.anglerScale;
  }

  // ─── Décor ancré : stations, falaises, plancher ───────────────────────────
  // defs : [{ id, theme, depth, docY }] ; floorDocY : ordonnée du plancher ; docH : hauteur de page.
  layout(defs, floorDocY, docH) {
    this.layoutArgs = [defs, floorDocY, docH];
    if (!this.modelsLoaded) return;
    if (!this.built) {
      for (const d of defs) this.buildStation(d);
      this.buildCliffs();
      this.buildSeabed();
      this.built = true;
    }
    // Les promontoires de gauche sont des copies en miroir de ceux de droite.
    const sx = this.narrow ? this.halfW * 0.12 : this.halfW * 0.46;
    const s = this.narrow ? 0.62 : 1;
    for (const d of defs) {
      const st = this.stations.get(d.id);
      st.side = d.side;
      st.group.position.set(sx * d.side, this.docToWorldY(d.docY), 0);
      st.group.scale.set(s * d.side, s, s);
    }
    this.seabed.position.y = this.docToWorldY(floorDocY);
    this.cliffGroup.children.forEach((c) => {
      c.position.y = this.docToWorldY(c.userData.frac * docH);
      c.position.x = c.userData.side * this.edgeAt(c.position.z) * c.userData.xk;
    });
  }

  stationZone(depth) { return depth < 200 ? 'shallow' : depth < 1000 ? 'twilight' : 'deep'; }

  place(parent, obj, x, y, z, { ry = rand(0, 6.28), sway = false, scale = 1 } = {}) {
    if (!obj) return null;
    obj.position.set(x, y, z);
    obj.rotation.y = ry;
    obj.scale.multiplyScalar(scale);
    parent.add(obj);
    this.register(obj);
    if (sway) this.swayers.push({ obj, ph: rand(0, 6.28), amp: sway === true ? 0.08 : sway });
    return obj;
  }

  buildStation(def) {
    const zone = this.stationZone(def.depth);
    const g = new THREE.Group();
    const rc = ROCK_COLORS[zone];
    const deep = zone === 'deep';

    // Socle rocheux
    g.add(at(P.rock(rc, { sx: 3.6, sy: 1.1, sz: 2.4 }), 0.6, -0.85, 0));
    g.add(at(P.rock(rc, { sx: 2.8, sy: 2.6, sz: 2 }), 3.9, 0.3, -1.8));
    g.add(at(P.rock(rc, { sx: 2, sy: 1.4, sz: 1.8 }), -2.5, -1.3, 0.3));
    g.add(at(P.rock(rc, { sx: 4.5, sy: 2.2, sz: 3 }), 2.6, -2.7, -0.6));
    // Massif qui rattache le promontoire au bord droit de l'écran (pente continentale)
    g.add(at(P.rock(rc, { sx: 4.5, sy: 4, sz: 3.5 }), 7.5, -0.8, -2.5));
    g.add(at(P.rock(rc, { sx: 6, sy: 5, sz: 4 }), 8.5, -5.5, -1.5));
    g.add(at(P.rock(rc, { sx: 5, sy: 3.5, sz: 3.5 }), 4.5, -5.8, 0));
    g.add(at(P.rock(rc, { sx: 4, sy: 6, sz: 3 }), 10.5, 3, -3.5));
    const dimRock = (o) => (zone === 'shallow' ? o : tint(o, { color: rc, mix: 0.6, dim: deep ? 0.55 : 0.8 }));
    this.place(g, dimRock(instance('rocks4', { size: 3 })), -1.4, -0.2, 1.1);
    this.place(g, dimRock(instance('rock2', { size: 2.2 })), 2.6, -0.1, 1.0);

    // Vie fixée selon la zone
    if (zone === 'shallow') {
      this.place(g, instance('kelp1', { size: 3.6 }), -1.9, 0, -1.1, { sway: 0.1 });
      this.place(g, instance('kelp1', { size: 4.4 }), 3.2, 0.6, -1.4, { sway: 0.1 });
      this.place(g, instance('seaweed', { size: 1.5 }), 1.9, 0.05, 0.9, { sway: true });
      this.place(g, instance('seaweed', { size: 1.2 }), -0.9, 0.05, 1.2, { sway: true });
      this.place(g, instance('coral1', { size: 2.3 }), 2.4, 0.15, -0.6, { ry: 0.3 });
      this.place(g, instance('coral2', { size: 1.2 }), -1.5, 0.1, 0.2);
      this.place(g, instance('coral3', { size: 1.1 }), 1.2, 0.1, -1.1);
      this.place(g, instance('coral_orange', { size: 0.8 }), 0.9, 0.1, 1.25);
      this.place(g, P.starfish(), -0.4, 0.2, 1.35, { scale: 0.7 });
      const an = this.place(g, P.anemone(0xff6fb5), 2.0, 0.1, 0.5, { sway: 0.12 });
      for (let i = 0; i < 2; i++) {
        const f = instance('clownfish', { size: 0.55, anchor: 'center', fix: 'fish' });
        if (!f) continue;
        g.add(this.register(f));
        this.animated.push({ type: 'orbit', obj: f, c: an.position.clone().add(V(0, 0.8, 0)), r: 0.75 + i * 0.25, sp: 0.9 - i * 0.3, a: i * Math.PI });
      }
      const crab = this.place(g, instance('crab', { size: 0.6 }), -0.6, 0.12, 1.0, { ry: 0 });
      if (crab) this.animated.push({ type: 'crab', obj: crab, x0: -0.6, ph: rand(0, 6) });
    } else {
      const pale = deep ? 0xeaf6ff : 0xd8c6b0;
      const glow = deep ? { emissive: 0x7fd9ff, emissiveIntensity: 0.45 } : {};
      this.place(g, tint(instance('coral1', { size: 2.5 }), { color: pale, mix: 0.75, dim: deep ? 0.9 : 0.85, ...glow }), 2.4, 0.15, -0.7, { ry: 0.3 });
      this.place(g, tint(instance('coral3', { size: 1 }), { color: pale, mix: 0.6, dim: 0.8 }), -1.4, 0.1, -0.6);
      this.place(g, P.sponge(deep ? 0xbfe6ff : 0xe8c26a, 1.3, deep ? 0.35 : 0), 1.5, 0.1, -1.2);
      this.place(g, P.sponge(deep ? 0xd9c7ff : 0xd9a35a, 0.9, deep ? 0.35 : 0), -0.9, 0.1, -1.3);
      this.place(g, tint(instance('urchin', { size: 0.7 }), { dim: 0.8 }), -1.7, 0.15, 0.9);
      this.place(g, tint(instance('urchin', { size: 0.5 }), { dim: 0.8 }), 2.3, 0.2, 1.1);
      this.place(g, P.anemone(deep ? 0x6fe8ff : 0xff9a5a, deep ? 0.9 : 0.1), 2.0, 0.1, 0.5, { sway: 0.12 });
      if (deep) this.place(g, P.anemone(0xff5fd2, 0.9, 16), -1.9, 0.1, -0.2, { sway: 0.12, scale: 0.8 });
      if (!deep) {
        const f = instance('puffer', { size: 0.8, anchor: 'center', fix: 'fish' });
        if (f) {
          g.add(this.register(f));
          this.animated.push({ type: 'orbit', obj: f, c: V(0.6, 1.6, 0), r: 1.9, sp: 0.35, a: 0 });
        }
      }
    }

    // Objet à explorer
    const art = this.buildArtifact(def.theme, g, deep);
    const focusLocal = V(0.3, 0.9, 0.4);

    // Balise + zone cliquable
    const bc = P.beacon(this.glowTex);
    bc.position.set(0.3, 3.0, 0.6);
    bc.visible = !this.reading;
    g.add(bc);
    const hit = new THREE.Mesh(new THREE.SphereGeometry(2.6, 12, 8), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.set(0.5, 1.0, 0.3);
    hit.userData.stationId = def.id;
    g.add(hit);
    this.hitboxes.push(hit);

    this.world.add(g);
    this.stations.set(def.id, { id: def.id, group: g, beacon: bc, art, focusLocal, deep, hover: 0, side: def.side });
  }

  buildArtifact(theme, g, deep) {
    switch (theme) {
      case 'bottle': return this.place(g, P.bottle(), 0.3, 0.1, 0.9, { ry: 0.2, scale: 1.5 });
      case 'helm': {
        const h = this.place(g, P.helm(), 0.1, 0, 0.5, { ry: 0, scale: 1.15 });
        this.animated.push({ type: 'helm', obj: h.userData.spin });
        return h;
      }
      case 'anchor': {
        const a = this.place(g, tint(instance('anchor', { size: 3.2, fix: 'flatInv' }), { dim: 0.9 }), 0, 0.1, 0.4, { ry: -0.3 });
        this.place(g, P.chain(10), 0.6, 0.15, 0.6, { ry: 0.1 });
        return a;
      }
      case 'chest': {
        const c = this.place(g, instance('chest_gold', { size: 2.5 }), 0.2, 0.05, 0.5, { ry: -0.5 });
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({
          map: this.glowTex, color: 0xffcf5a, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending,
        }));
        glow.position.set(0.2, 1.1, 0.5);
        glow.scale.setScalar(3.2);
        g.add(glow);
        this.animated.push({ type: 'pulse', obj: glow, base: 3.2 });
        return c;
      }
      case 'lab': {
        const l = this.place(g, P.lab(), 0.3, 0.05, 0.3, { ry: -0.4, scale: 1 });
        this.animated.push({ type: 'lab', obj: l });
        return l;
      }
      case 'clam': {
        const c = this.place(g, P.clam(), 0.5, 0.1, 0.7, { ry: -0.3, scale: 1.15 });
        this.animated.push({ type: 'clam', obj: c });
        const o = instance('octopus', { size: 2.2 });
        if (o) {
          tint(o, { color: 0xb07ad9, mix: 0.45, emissive: 0x3a1a5a, emissiveIntensity: deep ? 0.35 : 0 });
          this.place(g, o, -1.3, 0.05, -0.3, { ry: 0.8 });
          this.animated.push({ type: 'breathe', obj: o, ph: 0 });
        }
        return c;
      }
      default: return null;
    }
  }

  // Falaises lointaines de part et d'autre, pour donner de la profondeur pendant la descente.
  // Deux plans : de grandes parois dans le brouillard, et des éboulis plus proches.
  buildCliffs() {
    this.cliffGroup = new THREE.Group();
    const layers = [
      { n: 32, z: [-44, -32], size: [5, 8], xk: [0.8, 1.0], color: 0x1f3247 },
      { n: 16, z: [-20, -14], size: [1, 1.8], xk: [0.92, 1.08], color: 0x2a3a4d },
    ];
    for (const L of layers) {
      for (let i = 0; i < L.n; i++) {
        for (const side of [-1, 1]) {
          if (Math.random() < 0.15) continue;
          const sz = rand(...L.size);
          const r = P.rock(L.color, { sx: sz * rand(0.8, 1.1), sy: sz * rand(0.9, 1.3), sz: sz * 0.65 });
          r.position.z = rand(...L.z);
          r.rotation.set(rand(0, 6), rand(0, 6), rand(0, 6));
          r.userData = { ...r.userData, frac: 0.06 + (i / L.n) * 0.96 + rand(-0.012, 0.012), side, xk: rand(...L.xk) };
          this.cliffGroup.add(r);
        }
      }
    }
    this.world.add(this.cliffGroup);
  }

  floorH(x, z) {
    let h = Math.sin(x * 0.13) * 0.9 + Math.sin(z * 0.21 + x * 0.07) * 0.7 + Math.sin(x * 0.5 + z * 0.3) * 0.2;
    if (z < -30) h += ((-30 - z) * 0.35) ** 1.25;
    return h;
  }

  buildSeabed() {
    const g = new THREE.Group();
    const geo = new THREE.PlaneGeometry(200, 100, 100, 50).rotateX(-Math.PI / 2).translate(0, 0, -22);
    const p = geo.attributes.position;
    const colors = [];
    const c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      p.setY(i, this.floorH(x, z));
      c.setHSL(0.08, 0.14, 0.08 + Math.random() * 0.04);
      colors.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    g.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true })));

    const at = (x, z) => this.floorH(x, z);
    const W = this.halfW;
    const dark = (o) => tint(o, { color: 0x2e3440, mix: 0.6, dim: 0.6 });

    // Cheminée hydrothermale (fumeur noir)
    const vx = -W * 0.45, vz = -7;
    const vent = new THREE.Group();
    [[1.4, 1.2], [1.0, 1.4], [0.7, 1.3], [0.5, 1.1]].reduce((y, [r, h]) => {
      const seg = P.rock(0x2b2622, { sx: r, sy: h, sz: r });
      seg.position.y = y + h * 0.7;
      vent.add(seg);
      return y + h * 1.25;
    }, 0);
    const ventGlow = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.12, 6, 20), new THREE.MeshBasicMaterial({ color: 0xff7a2a }));
    ventGlow.rotation.x = Math.PI / 2;
    ventGlow.position.y = 0.3;
    vent.add(ventGlow);
    vent.position.set(vx, at(vx, vz), vz);
    g.add(vent);
    this.ventLight = new THREE.PointLight(0xff7a2a, 30, 16, 1.4);
    this.ventLight.position.set(vx, at(vx, vz) + 2, vz + 1.5);
    g.add(this.ventLight);
    this.smoke = [];
    const smokeMat = new THREE.SpriteMaterial({ map: this.glowTex, color: 0x0b0b0e, transparent: true, depthWrite: false, opacity: 0.6 });
    for (let i = 0; i < 16; i++) {
      const s = new THREE.Sprite(smokeMat);
      s.userData.life = i / 16;
      g.add(s);
      this.smoke.push(s);
    }
    this.smokeBase = V(vx, at(vx, vz) + 5.6, vz);

    for (const [x, z] of [[vx + 2.4, vz + 1.5], [vx - 2.2, vz + 2], [vx + 1, vz + 3.2]]) {
      this.place(g, P.tubeWorms(rand(6, 11) | 0), x, at(x, z), z, { sway: 0.05 });
    }
    // Rochers, coraux bambou lumineux, éponges, oursins, anémones.
    // Les grands éléments restent hors du couloir de la baudroie (à droite, au premier plan).
    const lane = (x, z) => (x > W * 0.05 && z > ANGLER_Z - 5 ? z - 9 : z);
    for (let i = 0; i < 9; i++) {
      const x = rand(-W * 1.3, W * 1.3), z = lane(x, rand(-22, 4));
      this.place(g, dark(instance(pick(['rock2', 'rocks4', 'rocks3']), { size: rand(2, 5) })), x, at(x, z) - 0.2, z);
    }
    for (let i = 0; i < 4; i++) {
      const x = rand(-W, W * 1.1), z = lane(x, rand(-14, 0));
      this.place(g, tint(instance('coral1', { size: rand(1.8, 3) }), { color: 0xffffff, mix: 0.8, emissive: 0x9fe8ff, emissiveIntensity: 0.5 }), x, at(x, z), z);
    }
    for (let i = 0; i < 5; i++) {
      const x = rand(-W, W), z = rand(-10, 3);
      this.place(g, P.sponge(pick([0xbfe6ff, 0xd9c7ff, 0xfff0c9]), rand(0.8, 1.6), 0.3), x, at(x, z), z);
    }
    for (let i = 0; i < 6; i++) {
      const x = rand(-W, W), z = rand(-8, 5);
      this.place(g, P.anemone(pick([0x6fe8ff, 0xff5fd2, 0x9b7bff]), 1, 16), x, at(x, z), z, { sway: 0.1, scale: rand(0.6, 1.1) });
    }
    for (let i = 0; i < 4; i++) {
      const x = rand(-W, W), z = rand(-6, 4);
      this.place(g, tint(instance('urchin', { size: rand(0.5, 0.9) }), { dim: 0.7 }), x, at(x, z), z);
    }
    const crab = this.place(g, tint(instance('crab', { size: 0.9 }), { color: 0xe8e0d6, mix: 0.5 }), W * 0.2, at(W * 0.2, 4), 4, { ry: 0.2 });
    if (crab) this.animated.push({ type: 'crab', obj: crab, x0: W * 0.2, ph: 0, floor: true });

    this.seabed = g;
    this.world.add(g);
  }

  updateWorld(dt) {
    const t = this.time;
    for (const s of this.swayers) {
      s.obj.rotation.z = Math.sin(t * 0.8 + s.ph) * s.amp;
      s.obj.rotation.x = Math.cos(t * 0.6 + s.ph) * s.amp * 0.6;
    }
    for (const a of this.animated) {
      const o = a.obj;
      switch (a.type) {
        case 'orbit': {
          a.a += a.sp * dt;
          o.position.set(a.c.x + Math.cos(a.a) * a.r, a.c.y + Math.sin(a.a * 2) * 0.15, a.c.z + Math.sin(a.a) * a.r);
          o.rotation.y = Math.atan2(-Math.cos(a.a), -Math.sin(a.a)) + (a.sp < 0 ? Math.PI : 0);
          break;
        }
        case 'crab': {
          o.position.x = a.x0 + Math.sin(t * 0.5 + a.ph) * (a.floor ? 3 : 0.6);
          o.position.y += Math.sin(t * 14) * 0.002;
          if (a.floor) o.position.y = this.floorH(o.position.x, o.position.z);
          break;
        }
        case 'helm': o.rotation.z = Math.sin(t * 0.4) * 0.12; break;
        case 'pulse': o.scale.setScalar(a.base * (1 + Math.sin(t * 2) * 0.08)); break;
        case 'lab':
          o.userData.blink.visible = Math.sin(t * 3) > 0;
          o.userData.dish.rotation.y = t * 0.5;
          break;
        case 'clam': o.userData.hinge.rotation.z = 0.65 + Math.sin(t * 0.8) * 0.15; break;
        case 'breathe': o.scale.setScalar(1 + Math.sin(t * 1.2) * 0.03); break;
        default:
      }
    }

    // Balises : anneaux qui pulsent, plus forts au survol, masqués en exploration
    for (const st of this.stations.values()) {
      st.hover += ((this.hovered === st ? 1 : 0) - st.hover) * (1 - Math.exp(-dt * 8));
      const vis = 1 - this.focusK * (this.focused === st ? 1 : 0.6);
      const b = st.beacon;
      b.quaternion.copy(this.camera.quaternion);
      b.position.y = 3.0 + Math.sin(t * 1.6) * 0.15;
      b.userData.rings.forEach((r, i) => {
        const ph = (t * 0.6 + i * 0.5) % 1;
        r.scale.setScalar((0.35 + ph * 1.2) * (1 + st.hover * 0.4));
        r.material.opacity = (1 - ph) * 0.85 * vis;
      });
      b.userData.dot.material.opacity = vis * (0.8 + st.hover * 0.2);
      b.userData.dot.scale.setScalar(0.8 + st.hover * 0.6 + Math.sin(t * 3) * 0.08);
    }

    // Lumière d'appoint sur la station la plus proche du centre (ou celle explorée)
    let best = this.focused, bestD = Infinity;
    if (!best) {
      for (const st of this.stations.values()) {
        const y = st.group.position.y + this.world.position.y;
        if (Math.abs(y) < bestD) { bestD = Math.abs(y); best = st; }
      }
    }
    if (best) {
      // Loin de toute station (contact, plancher), le robot revient à droite.
      this.nearSide = this.focused || bestD < this.halfH * 2.4 ? best.side : 1;
      const p = best.group.localToWorld(best.focusLocal.clone());
      this.stationLight.position.copy(p).add(V(-1, 2.5, 3));
      const darkness = clamp01((this.depth - 300) / 1500);
      this.stationLight.intensity = (best.deep || darkness > 0 ? 10 * darkness : 0) + this.focusK * 30;
    }

    // Fumée du fumeur noir
    if (this.smoke) {
      for (const s of this.smoke) {
        s.userData.life = (s.userData.life + dt * 0.12) % 1;
        const l = s.userData.life;
        s.position.copy(this.smokeBase).add(V(Math.sin(l * 6 + t * 0.3) * 0.5 + l * 2, l * 9, 0));
        s.scale.setScalar(1 + l * 4);
      }
      this.ventLight.intensity = 26 + Math.sin(t * 5) * 3 + Math.sin(t * 11) * 2;
    }
  }

  // ─── Exploration (zoom caméra + ROV qui éclaire la zone) ──────────────────
  // Mode lecture : tout est déjà déplié, les balises disparaissent et rien n'est cliquable.
  setReading(on) {
    this.reading = on;
    for (const st of this.stations.values()) st.beacon.visible = !on;
  }

  pick(clientX, clientY) {
    if (!this.built || this.reading) return null;
    const ndc = new THREE.Vector2((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObjects(this.hitboxes, false)[0];
    return hit ? hit.object.userData.stationId : null;
  }

  setHover(id) { this.hovered = id ? this.stations.get(id) : null; }

  animateCamera(toPos, toLook, dur) {
    this.camAnim = { fromPos: this.camera.position.clone(), fromLook: this.camLook.clone(), toPos, toLook, t0: performance.now() / 1000, dur };
  }

  focus(id) {
    const st = this.stations.get(id);
    if (!st) return false;
    this.focused = st;
    this.hovered = null;
    this.world.position.y = window.scrollY * this.pxToWorld;
    this.world.updateMatrixWorld(true);
    const p = st.group.localToWorld(st.focusLocal.clone());
    this.focusPoint = p;
    // La caméra décale la station du côté opposé à la fiche.
    const side = st.side;
    const look = this.narrow ? p.clone().add(V(0, -2.1, 0)) : p.clone().add(V(-2.6 * side, 0.3, 0));
    const pos = look.clone().add(this.narrow ? V(0, 0.6, 11) : V(0, 1.0, 9));
    this.animateCamera(pos, look, 1.7);
    this.rovFocus = p.clone().add(this.narrow ? V(1.1 * side, 2.0, 2.0) : V(1.3 * side, 1.5, 1.8));
    return true;
  }

  unfocus() {
    this.focused = null;
    this.rovFocus = null;
    this.animateCamera(V(0, 0, CAM_Z), V(0, 0, 0), 1.4);
    setTimeout(() => { if (!this.focused) this.focusPoint = null; }, 1400);
  }

  // ─── Effets déclenchés ────────────────────────────────────────────────────
  trigger(name) {
    if (this.reduced && name !== 'sonar') return;
    const fx = {
      school: () => this.school({ palette: PALETTES.tropical, count: 26 }),
      whale: () => this.whale(),
      manta: () => { this.manta(); this.passer('shark', { size: 4, z: -10, speed: 4.5, delay: 2.5 }); },
      jelly: () => this.jellies(),
      sonar: () => this.sonar(),
      hook: () => { this.hook(); this.school({ palette: PALETTES.deep, glow: true, count: 16, z: -6 }); },
      bubbles: () => this.bubbles({ count: 50 }),
    }[name];
    if (fx) fx();
  }

  add(root, update, extraDispose) {
    this.scene.add(root);
    this.register(root);
    this.effects.push({ root, update, extraDispose });
  }

  removeEffect(fx) {
    this.scene.remove(fx.root);
    fx.root.traverse((o) => {
      if (o.userData.mixer) { o.userData.mixer.stopAllAction(); this.mixers.delete(o.userData.mixer); }
      if (o.isLine || o.userData.own) { o.geometry?.dispose(); o.material?.dispose?.(); }
      else if (o.isMesh) [o.material].flat().forEach((m) => m.userData.tinted && m.dispose());
    });
    fx.extraDispose?.();
  }

  burstAt(clientX, clientY) {
    const p = this.screenToWorld(clientX, clientY);
    this.bubbles({ x: p.x, y: p.y, z: 0, count: 14, spread: 0.6, size: [0.08, 0.35] });
  }

  bubbles({ x = 0, y = null, z = null, count = 40, spread = null, size = [0.12, 0.5], anchored = true } = {}) {
    const root = new THREE.Group();
    root.userData.anchored = anchored;
    const items = [];
    const fromBottom = y === null;
    for (let i = 0; i < count; i++) {
      const s = new THREE.Sprite(this.bubbleMat);
      const sz = rand(size[0], size[1]);
      s.scale.setScalar(sz);
      const sp = spread ?? this.halfW * 0.9;
      s.position.set(
        x + rand(-sp, sp),
        fromBottom ? -this.halfH - rand(0.5, 8) : y + rand(-sp, sp),
        z ?? rand(-5, 4),
      );
      items.push({ s, vy: 1.2 + sz * 4 + rand(0, 0.6), ph: rand(0, 6.28), x0: s.position.x, y0: s.position.y });
      root.add(s);
    }
    const maxRise = this.halfH * 2.6 + 10;
    this.add(root, (dt, t) => {
      let alive = false;
      for (const b of items) {
        b.s.position.y += b.vy * dt;
        b.s.position.x = b.x0 + Math.sin(t * 3 + b.ph) * 0.15;
        if (b.s.position.y - b.y0 < maxRise) alive = true;
      }
      return alive;
    });
  }

  school({ palette, glow = false, count = 24, z = rand(-8, 0), speed = rand(3.5, 5), scale = 1, parallax = 0.6 }) {
    const dir = Math.random() < 0.5 ? 1 : -1;
    const root = new THREE.Group();
    root.userData.parallax = parallax;
    const inner = new THREE.Group();
    if (dir < 0) inner.rotation.y = Math.PI;
    root.add(inner);
    const size = rand(0.7, 1.1) * scale * (this.narrow ? 0.6 : 1);
    const reef = palette === PALETTES.tropical && hasModel('reef_tang');
    const lantern = glow && hasModel('lantern');
    const species = !reef && palette === PALETTES.tropical && hasModel('butterflyfish') ? pick(['butterflyfish', 'clownfish']) : null;
    const n = species ? Math.round(count * 0.6) : count;
    const fishes = [];
    for (let i = 0; i < n; i++) {
      let f;
      if (reef) f = instance(pick(['reef_angel', 'reef_tang', 'reef_butter']), { size: 1.8 * size * rand(0.85, 1.15), anchor: 'center' });
      else if (lantern) f = instance('lantern', { size: 1.1 * size * rand(0.85, 1.15), anchor: 'center' });
      else if (species) f = instance(species, { size: 0.95 * size * rand(0.85, 1.15), anchor: 'center', fix: 'fish' });
      else f = makeFish(pick(palette), glow);
      if (!species && !reef && !lantern) f.scale.setScalar(size * rand(0.8, 1.2));
      const off = V(rand(-4.5, 4.5), rand(-1.8, 1.8), rand(-2, 2));
      f.position.copy(off);
      inner.add(f);
      fishes.push({ f, off, ph: rand(0, 6.28) });
    }
    const edge = this.edgeAt(z) + 8;
    root.position.set(-dir * edge, rand(-0.45, 0.35) * this.halfH, z);
    this.add(root, (dt, t) => {
      root.position.x += dir * speed * dt;
      root.position.y += Math.sin(t * 0.6) * dt * 0.4;
      for (const { f, off, ph } of fishes) {
        f.position.x = off.x + Math.sin(t * 0.8 + ph) * 0.35;
        f.position.y = off.y + Math.sin(t * 1.6 + ph) * 0.25;
        f.rotation.z = Math.cos(t * 1.6 + ph) * 0.12;
        if (f.userData.tail) f.userData.tail.rotation.y = Math.sin(t * 12 + ph) * 0.55;
        if (f.userData.tail && f.userData.mixer === undefined) f.rotation.y = Math.sin(t * 6 + ph) * 0.1;
      }
      return dir * root.position.x < edge;
    });
  }

  // Un seul animal .glb qui traverse l'écran.
  passer(name, { size = 3, z = -8, speed = 3, y = null, delay = 0, parallax = 0.6, dim = 1 } = {}) {
    if (delay) { setTimeout(() => this.passer(name, { size, z, speed, y, parallax, dim }), delay * 1000); return; }
    const m = instance(name, { size, anchor: 'center', fix: 'fish' });
    if (!m) return;
    if (dim < 1) tint(m, { dim });
    const dir = Math.random() < 0.5 ? 1 : -1;
    const root = new THREE.Group();
    root.userData.parallax = parallax;
    if (dir < 0) m.rotation.y = Math.PI;
    root.add(m);
    const edge = this.edgeAt(z) + size + 2;
    root.position.set(-dir * edge, y ?? this.halfH * rand(-0.35, 0.3), z);
    this.add(root, (dt, t) => {
      root.position.x += dir * speed * dt;
      root.position.y += Math.sin(t * 0.7) * dt * 0.3;
      return dir * root.position.x < edge;
    });
  }

  whale() {
    if (hasModel('whale')) {
      this.passer('whale', { size: 14, z: -26, speed: 2.6, y: this.halfH * rand(0, 0.35) });
      return;
    }
    const mat = new THREE.MeshStandardMaterial({ color: 0x2b5c88, roughness: 0.8, flatShading: true });
    const root = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), mat);
    body.scale.set(4, 1.15, 1.25);
    body.userData.own = true;
    root.add(body);
    root.scale.setScalar(1.6);
    const z = -24;
    const edge = this.edgeAt(z) + 12;
    root.position.set(-edge, this.halfH * 0.2, z);
    this.add(root, (dt) => {
      root.position.x += 2.6 * dt;
      return root.position.x < edge;
    }, () => mat.dispose());
  }

  manta() {
    const s = new THREE.Shape();
    s.moveTo(1.1, 0);
    s.quadraticCurveTo(0.9, 0.6, 0.1, 2.4);
    s.quadraticCurveTo(-0.2, 1.3, -0.9, 0.3);
    s.lineTo(-0.9, -0.3);
    s.quadraticCurveTo(-0.2, -1.3, 0.1, -2.4);
    s.quadraticCurveTo(0.9, -0.6, 1.1, 0);
    const geo = new THREE.ShapeGeometry(s, 18).scale(-1, 1, 1).rotateX(-Math.PI / 2);
    const base = geo.attributes.position.array.slice();
    const mat = new THREE.MeshStandardMaterial({
      color: 0x2a3f58, roughness: 0.7, side: THREE.DoubleSide, flatShading: true, emissive: 0x0b1626,
    });
    const wing = new THREE.Mesh(geo, mat);
    wing.userData.own = true;
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.06, 2.8, 5).rotateZ(Math.PI / 2), mat);
    tail.position.x = 2.2;
    tail.userData.own = true;
    const hornGeo = new THREE.ConeGeometry(0.1, 0.5, 5).rotateZ(Math.PI / 2);
    const horns = [0.35, -0.35].map((z) => {
      const h = new THREE.Mesh(hornGeo, mat);
      h.position.set(-1.25, 0.02, z);
      return h;
    });
    const tilt = new THREE.Group();
    tilt.rotation.x = 0.55;
    tilt.add(wing, tail, ...horns);
    const root = new THREE.Group();
    root.add(tilt);
    root.scale.setScalar(1.7);
    const z = -5;
    const edge = this.edgeAt(z) + 8;
    root.position.set(edge, this.halfH * rand(-0.3, 0.3), z);
    const pos = geo.attributes.position;
    this.add(root, (dt, t) => {
      root.position.x -= 3.2 * dt;
      root.position.y += Math.sin(t * 0.9) * dt * 0.8;
      for (let i = 0; i < pos.count; i++) {
        const zz = base[i * 3 + 2];
        const k = Math.pow(Math.abs(zz) / 2.4, 1.5);
        pos.array[i * 3 + 1] = Math.sin(t * 2.2 - Math.abs(zz) * 0.7) * 0.6 * k;
      }
      pos.needsUpdate = true;
      geo.computeVertexNormals();
      tilt.rotation.z = Math.sin(t * 0.9) * 0.08;
      return root.position.x > -edge;
    }, () => { mat.dispose(); hornGeo.dispose(); });
  }

  jellies() {
    const colors = [0xff7ad9, 0xb98bff, 0x6fe8ff, 0xffa2c0, 0x7affb0];
    if (hasModel('jelly')) { this.glowJellies(colors); return; }
    const bellGeo = new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    const mats = [];
    const jellies = [];
    const root = new THREE.Group();
    const n = this.narrow ? 4 : 6;
    for (let i = 0; i < n; i++) {
      const color = pick(colors);
      const mat = new THREE.MeshStandardMaterial({
        color, emissive: color, emissiveIntensity: 0.7, transparent: true, opacity: 0.55,
        side: THREE.DoubleSide, depthWrite: false, roughness: 0.3,
      });
      const glow = new THREE.SpriteMaterial({
        map: this.glowTex, color, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const lineMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.55 });
      mats.push(mat, glow, lineMat);
      const g = new THREE.Group();
      const bell = new THREE.Mesh(bellGeo, mat);
      const halo = new THREE.Sprite(glow);
      halo.scale.setScalar(3.4);
      halo.position.y = 0.2;
      g.add(bell, halo);
      const tentacles = [];
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2;
        const pts = Array.from({ length: 14 }, (_, j) => V(Math.cos(a) * 0.7, -j * 0.24, Math.sin(a) * 0.7));
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat);
        g.add(line);
        tentacles.push({ line, pts, a });
      }
      g.scale.setScalar(rand(0.6, 1.1));
      const z = rand(-8, 2);
      g.position.set(rand(-0.85, 0.85) * this.edgeAt(z), -this.halfH - rand(3, 12), z);
      root.add(g);
      jellies.push({ g, bell, tentacles, ph: rand(0, 6.28), speed: rand(0.9, 1.5), y0: g.position.y });
    }
    const maxRise = this.halfH * 2.6 + 18;
    this.add(root, (dt, t) => {
      let alive = false;
      for (const j of jellies) {
        const p = Math.sin(t * 2 + j.ph);
        j.bell.scale.set(1 + p * 0.1, 1 - p * 0.14, 1 + p * 0.1);
        j.g.position.y += (j.speed * 0.5 + Math.max(0, -p) * j.speed) * dt;
        j.g.position.x += Math.sin(t * 0.5 + j.ph) * dt * 0.2;
        for (const tn of j.tentacles) {
          tn.pts.forEach((v, idx) => {
            const w = idx / 13;
            v.x = Math.cos(tn.a) * 0.7 * (1 - w * 0.4) + Math.sin(t * 2.4 + j.ph + idx * 0.45) * 0.18 * w;
            v.z = Math.sin(tn.a) * 0.7 * (1 - w * 0.4) + Math.cos(t * 2 + j.ph + idx * 0.4) * 0.12 * w;
          });
          tn.line.geometry.setFromPoints(tn.pts);
        }
        if (j.g.position.y - j.y0 < maxRise) alive = true;
      }
      return alive;
    }, () => { bellGeo.dispose(); mats.forEach((m) => m.dispose()); });
  }

  // Méduses lumineuses (modèle Blender) qui remontent lentement et pulsent.
  glowJellies(colors) {
    const root = new THREE.Group();
    const list = [];
    const mats = [];
    const n = this.narrow ? 4 : 7;
    for (let i = 0; i < n; i++) {
      const j = makeJelly(pick(colors), this.glowTex);
      mats.push(...j.mats);
      const sc = rand(0.7, 1.3);
      j.group.scale.setScalar(sc);
      const z = rand(-9, 2);
      j.group.position.set(rand(-0.85, 0.85) * this.edgeAt(z), -this.halfH - rand(3, 12), z);
      j.group.rotation.set(rand(-0.15, 0.15), rand(0, 6.28), rand(-0.15, 0.15));
      root.add(j.group);
      list.push({ j, ph: rand(0, 6.28), speed: rand(0.9, 1.5), y0: j.group.position.y });
    }
    const maxRise = this.halfH * 2.6 + 18;
    this.add(root, (dt, t) => {
      let alive = false;
      for (const e of list) {
        const p = Math.sin(t * 2 + e.ph);
        pulseJelly(e.j, p);
        const g = e.j.group;
        g.position.y += (e.speed * 0.5 + Math.max(0, -p) * e.speed) * dt;
        g.position.x += Math.sin(t * 0.5 + e.ph) * dt * 0.2;
        g.rotation.y += dt * 0.15;
        if (g.position.y - e.y0 < maxRise) alive = true;
      }
      return alive;
    }, () => mats.forEach((m) => m.dispose()));
  }

  sonar() {
    const root = new THREE.Group();
    root.position.copy(this.rov.visible ? this.rovInner.localToWorld(V(1.2, 0.25, 0)) : V(0, 0, 0));
    const geo = new THREE.RingGeometry(0.985, 1, 96);
    const rings = [0, 0.45, 0.9].map((delay) => {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: 0x5ee7ff, transparent: true, opacity: 0, side: THREE.DoubleSide,
        depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      }));
      root.add(m);
      return { m, delay };
    });
    const start = this.time;
    const life = 3.2;
    this.add(root, () => {
      const el = this.time - start;
      for (const r of rings) {
        const k = clamp01((el - r.delay) / life);
        r.m.scale.setScalar(0.5 + k * this.halfW * 1.4);
        r.m.material.opacity = k > 0 ? (1 - k) * 0.6 : 0;
      }
      return el < life + 1;
    }, () => { geo.dispose(); rings.forEach((r) => r.m.material.dispose()); });
    this.bubbles({ count: 30 });
  }

  hook() {
    const root = new THREE.Group();
    const steel = new THREE.MeshStandardMaterial({ color: 0xc9d3dc, metalness: 0.9, roughness: 0.25 });
    const worm = new THREE.MeshStandardMaterial({ color: 0xff6f91, roughness: 0.6, emissive: 0x401020 });
    const shank = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.1, 8), steel);
    shank.position.y = 0.55;
    const bend = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.04, 8, 24, Math.PI * 1.25), steel);
    bend.rotation.z = Math.PI * 0.95;
    bend.position.set(0.3, 0, 0);
    const eye = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.025, 6, 12), steel);
    eye.position.y = 1.15;
    const wormCurve = new THREE.CatmullRomCurve3([
      V(0, 0.9, 0.05), V(-0.15, 0.6, 0.1), V(0.1, 0.35, 0.1), V(-0.1, 0.1, 0.1), V(-0.35, -0.2, 0.05),
    ]);
    const bait = new THREE.Mesh(new THREE.TubeGeometry(wormCurve, 24, 0.07, 8), worm);
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([V(0, 1.2, 0), V(0, 40, 0)]),
      new THREE.LineBasicMaterial({ color: 0xdfe8ef, transparent: true, opacity: 0.6 }),
    );
    for (const m of [shank, bend, eye, bait]) m.userData.own = true;
    const pendulum = new THREE.Group();
    pendulum.add(shank, bend, eye, bait, line);
    root.add(pendulum);
    root.scale.setScalar(1.4);
    root.userData.anchored = false;
    const x = this.narrow ? -this.halfW * 0.3 : this.halfW * 0.05;
    const topY = this.halfH + 3;
    const lowY = this.halfH * 0.25;
    root.position.set(x, topY, 1);
    const start = this.time;
    this.add(root, () => {
      const el = this.time - start;
      let y;
      if (el < 2.5) y = topY + (lowY - topY) * easeInOut(el / 2.5);
      else if (el < 7.5) y = lowY + Math.sin((el - 2.5) * 1.5) * 0.2;
      else y = lowY + (topY + 2 - lowY) * easeInOut(clamp01((el - 7.5) / 2.2));
      root.position.y = y;
      pendulum.rotation.z = Math.sin(el * 1.3) * 0.08;
      return el < 10;
    }, () => { steel.dispose(); worm.dispose(); });
  }

  ambient() {
    if (this.reduced || this.focused || this.zone.active || this.depth < 15 || this.depth > 4100) return;
    // Plan lointain : bancs et silhouettes qui glissent dans le brouillard, plus lents (parallaxe).
    if (Math.random() < 0.5) {
      const z = rand(-34, -20);
      const d = this.depth;
      if (d > 120 && d < 1600 && Math.random() < 0.25) {
        this.passer(pick(['shark', 'swordfish', 'whale']), { size: rand(4, 9), z, speed: rand(1.4, 2.4), parallax: 0.25, dim: 0.6 });
      } else {
        const palette = d < 1000 ? PALETTES.silver : PALETTES.deep;
        this.school({ palette, glow: d >= 1000, count: (rand(8, 20) | 0), z, speed: rand(1.5, 2.6), scale: 1.3, parallax: 0.25 });
      }
      return;
    }
    if (this.depth < 200 && Math.random() < 0.4 && hasModel('lionfish')) {
      this.passer(pick(['lionfish', 'puffer', 'swordfish']), { size: rand(1.2, 2), z: rand(-12, -4), speed: rand(1.5, 3) });
      return;
    }
    const palette = this.depth < 200 ? PALETTES.tropical : this.depth < 1000 ? PALETTES.silver : PALETTES.deep;
    this.school({ palette: this.depth < 200 ? PALETTES.silver : palette, glow: this.depth >= 1000, count: (Math.random() * 3 | 0) + 1, z: rand(-12, -2), speed: rand(2, 4) });
  }

  // ─── Boucle ───────────────────────────────────────────────────────────────
  setDepth(depth, color) {
    this.depth = depth;
    this.scene.fog.color.set(color);
    const r = clamp01(depth / 1600);
    this.baseSun = 2.2 * (1 - r) ** 2 + 0.05;
    this.baseHemi = 1.4 * (1 - r) + 0.25;
    this.snowMat.opacity = 0.18 + clamp01(depth / 1500) * 0.55;
    this.snowMat.color.setHSL(0.5, clamp01((depth - 1500) / 3000) * 0.6, 0.85);
  }

  tick() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.time += dt;
    const sy = window.scrollY;
    const frozen = this.focused || this.zone.active;
    const deltaPx = frozen ? 0 : sy - this.lastScroll;
    if (!frozen) this.lastScroll = sy;
    this.scrollVel += ((deltaPx / Math.max(dt, 1e-3)) - this.scrollVel) * 0.1;
    const worldDelta = deltaPx * this.pxToWorld;
    if (!frozen) this.world.position.y = this.lastScroll * this.pxToWorld;

    this.focusK += ((this.focused || this.zone.lighting ? 1 : 0) - this.focusK) * (1 - Math.exp(-dt * 2.2));
    this.hemi.intensity = this.baseHemi * (1 - 0.6 * this.focusK);
    this.sun.intensity = this.baseSun * (1 - 0.6 * this.focusK);

    if (this.camAnim) {
      const a = this.camAnim;
      const k = clamp01((performance.now() / 1000 - a.t0) / a.dur);
      const e = easeInOut(k);
      this.camera.position.lerpVectors(a.fromPos, a.toPos, e);
      this.camLook.lerpVectors(a.fromLook, a.toLook, e);
      if (k >= 1) this.camAnim = null;
    }
    this.camera.lookAt(this.camLook);

    this.updateSnow(dt, worldDelta);
    setJellyTime(this.time);
    this.updateRov(dt);
    this.updateAngler(dt);
    this.zone.update(dt, this.time);
    if (this.built) this.updateWorld(dt);
    for (const m of this.mixers) m.update(dt);

    for (let i = this.effects.length - 1; i >= 0; i--) {
      const fx = this.effects[i];
      if (fx.root.userData.anchored !== false) fx.root.position.y += worldDelta * (fx.root.userData.parallax ?? 0.6);
      if (!fx.update(dt, this.time)) {
        this.removeEffect(fx);
        this.effects.splice(i, 1);
      }
    }

    if (this.time > this.nextAmbient) {
      this.nextAmbient = this.time + rand(3, 6);
      this.ambient();
    }

    this.renderer.render(this.scene, this.camera);
  }
}
