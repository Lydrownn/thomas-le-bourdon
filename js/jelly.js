// Méduses lumineuses : modèle Blender (assets/models/jelly.glb), tentacules ondulants dans le vertex shader,
// cloche translucide qui s'éclaire à chaque contraction.
import * as THREE from 'three';
import { raw, hasModel } from './assets.js';

const uTime = { value: 0 };
export const setJellyTime = (t) => { uTime.value = t; };
export const hasJelly = () => hasModel('jelly');

function wave(mat, phase, amp) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.uniforms.uPh = { value: phase };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uPh;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float w = clamp(-position.y / 2.6, 0.0, 1.0);
        transformed.x += sin(uTime * 2.3 + position.y * 3.1 + uPh) * ${amp.toFixed(2)} * w;
        transformed.z += cos(uTime * 1.9 + position.y * 2.7 + uPh * 1.3) * ${(amp * 0.75).toFixed(2)} * w;`);
  };
  mat.customProgramCacheKey = () => `jellywave${amp}`;
}

// Renvoie { group, bell, mats, halo } ou null si le modèle n'est pas chargé.
export function makeJelly(color, glowTex) {
  const model = raw('jelly');
  if (!model) return null;
  const c = new THREE.Color(color);
  const mats = [];
  const phase = Math.random() * 6.28;
  let bellMat = null, armMat = null;
  model.traverse((m) => {
    if (!m.isMesh) return;
    const list = [m.material].flat().map((mt) => {
      let n;
      if (mt.name === 'Bell') {
        n = new THREE.MeshStandardMaterial({
          color: c.clone().lerp(new THREE.Color(0xffffff), 0.35), emissive: c, emissiveIntensity: 0.6, vertexColors: true,
          transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false, roughness: 0.3,
        });
        bellMat = n;
      } else if (mt.name === 'Arms') {
        n = new THREE.MeshStandardMaterial({
          color: c.clone().lerp(new THREE.Color(0xffffff), 0.25), emissive: c, emissiveIntensity: 1.0, vertexColors: true,
          transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false, roughness: 0.4,
        });
        wave(n, phase, 0.32);
        armMat = n;
      } else {
        n = new THREE.MeshBasicMaterial({ color: c.clone().lerp(new THREE.Color(0xffffff), 0.75), transparent: true, opacity: 0.95, depthWrite: false });
      }
      n.userData.tinted = true;
      mats.push(n);
      return n;
    });
    m.material = list.length === 1 ? list[0] : list;
  });
  const bell = model.getObjectByName('Bell') ?? model;
  const group = new THREE.Group();
  group.add(model);
  const glowMat = new THREE.SpriteMaterial({ map: glowTex, color: c, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending });
  mats.push(glowMat);
  const halo = new THREE.Sprite(glowMat);
  halo.scale.setScalar(4.2);
  halo.position.y = 0.2;
  group.add(halo);
  return { group, bell, mats, halo, bellMat, armMat, phase };
}

// Contraction : p dans [-1, 1].
export function pulseJelly(j, p) {
  j.bell.scale.set(1 + p * 0.1, 1 - p * 0.14, 1 + p * 0.1);
  const flash = Math.max(0, -p);
  if (j.bellMat) j.bellMat.emissiveIntensity = 0.5 + flash * 0.7;
  if (j.armMat) j.armMat.emissiveIntensity = 0.9 + flash * 0.6;
  j.halo.material.opacity = 0.38 + flash * 0.3;
}
