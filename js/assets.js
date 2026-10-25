// Chargement et normalisation des modèles .glb (voir assets/models/CREDITS.txt).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const loader = new GLTFLoader();
const cache = new Map();

export const MODELS = [
  'clownfish', 'butterflyfish', 'lionfish', 'puffer', 'shark', 'whale', 'swordfish',
  'anchor', 'chest_gold', 'octopus', 'crab', 'urchin',
  'coral1', 'coral2', 'coral3', 'coral_orange', 'seaweed', 'kelp1',
  'rock2', 'rocks3', 'rocks4',
];

export async function loadModels(names = MODELS) {
  await Promise.all(names.map(async (n) => {
    try {
      cache.set(n, await loader.loadAsync(`assets/models/${n}.glb`));
    } catch (e) {
      console.warn(`[portfolio] modèle ${n} indisponible`, e);
    }
  }));
}

export const hasModel = (n) => cache.has(n);

// Renvoie une copie du modèle dont la plus grande dimension vaut `size`.
// anchor 'base' : posé sur y = 0 ; 'center' : centré sur l'origine.
// fix 'fish' : les poissons Quaternius regardent +z, on les tourne vers +x.
// fix 'flat' / 'flatInv' : redresse un modèle exporté couché (dans un sens ou l'autre).
export function instance(name, { size = 1, anchor = 'base', fix = null } = {}) {
  const gltf = cache.get(name);
  if (!gltf) return null;
  const animated = gltf.animations.length > 0;
  const model = animated ? SkeletonUtils.clone(gltf.scene) : gltf.scene.clone(true);
  if (fix === 'fish') model.rotation.y = Math.PI / 2;
  if (fix === 'flat') model.rotation.x = -Math.PI / 2;
  if (fix === 'flatInv') model.rotation.x = Math.PI / 2;

  const inner = new THREE.Group();
  inner.add(model);
  inner.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(inner);
  const dims = box.getSize(new THREE.Vector3());
  const k = size / Math.max(dims.x, dims.y, dims.z);
  const c = box.getCenter(new THREE.Vector3());
  inner.scale.setScalar(k);
  inner.position.set(-c.x * k, anchor === 'base' ? -box.min.y * k : -c.y * k, -c.z * k);

  const root = new THREE.Group();
  root.add(inner);
  root.traverse((o) => { if (o.isSkinnedMesh) o.frustumCulled = false; });

  if (animated) {
    const mixer = new THREE.AnimationMixer(model);
    const clip = gltf.animations.find((a) => /Swimming_Normal|\|Swim$|Swim$/.test(a.name)) ?? gltf.animations[0];
    const action = mixer.clipAction(clip);
    action.play();
    action.time = Math.random() * clip.duration;
    root.userData.mixer = mixer;
  }
  return root;
}

// Assombrit / teinte un modèle pour les zones profondes (matériaux clonés).
export function tint(root, { color = null, mix = 0.5, emissive = null, emissiveIntensity = 0.4, dim = 1 } = {}) {
  const target = color === null ? null : new THREE.Color(color);
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const cloned = mats.map((m) => {
      const n = m.clone();
      if (target) n.color.lerp(target, mix);
      n.color.multiplyScalar(dim);
      if (emissive !== null) { n.emissive = new THREE.Color(emissive); n.emissiveIntensity = emissiveIntensity; }
      n.userData.tinted = true;
      return n;
    });
    o.material = Array.isArray(o.material) ? cloned : cloned[0];
  });
  return root;
}
