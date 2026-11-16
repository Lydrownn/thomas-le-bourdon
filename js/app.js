// Jauge de profondeur, couleur de l'eau, apparitions, déclencheurs d'animations
// et exploration des stations (zoom caméra + fiche éclairée par le robot).
import { Ocean } from './scene.js';
import { initSkills } from './skills.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const rand = (a, b) => a + Math.random() * (b - a);
const html = document.documentElement;

const ocean = new Ocean($('#ocean'));
if (location.hostname === 'localhost') window.__ocean = ocean; // débogage local

// Couleur de l'eau selon la profondeur (en mètres).
const STOPS = [
  [0, '#3aa6dc'], [120, '#1f80b9'], [400, '#0f4f86'], [1000, '#0a2c57'],
  [2000, '#071c3d'], [3200, '#040f24'], [4200, '#01060f'], [6000, '#000206'],
];
const ZONES = [
  [0, 'Surface'], [2, 'Zone épipélagique'], [200, 'Zone mésopélagique'],
  [1000, 'Zone bathypélagique'], [4000, 'Zone abyssopélagique'],
];
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const STOPS_RGB = STOPS.map(([d, c]) => [d, hex(c)]);
function colorAt(d) {
  for (let i = 0; i < STOPS_RGB.length - 1; i++) {
    const [d0, c0] = STOPS_RGB[i], [d1, c1] = STOPS_RGB[i + 1];
    if (d <= d1) {
      const t = Math.max(0, (d - d0) / (d1 - d0));
      const c = c0.map((v, k) => Math.round(v + (c1[k] - v) * t));
      return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    }
  }
  return STOPS[STOPS.length - 1][1];
}
const zoneAt = (d) => ZONES.filter(([z]) => d >= z).pop()[1];

// Chaque élément [data-depth] est un point d'ancrage : la profondeur est interpolée entre eux.
const stationSections = $$('section[data-station]');
// Les promontoires alternent droite / gauche ; le texte passe du côté opposé.
stationSections.forEach((s, i) => s.classList.toggle('flip', i % 2 === 1));
let anchors = [];
function measure() {
  const docTop = (el) => el.getBoundingClientRect().top + scrollY;
  const max = html.scrollHeight - innerHeight;
  anchors = $$('[data-depth]').map((el) => ({ y: Math.max(0, docTop(el) - innerHeight * 0.4), d: +el.dataset.depth }));
  anchors[0].y = 0;
  anchors.push({ y: max, d: +document.body.dataset.bottom });
  anchors.sort((a, b) => a.y - b.y);

  // Position des stations 3D : à côté du texte (ou sous le texte sur mobile).
  const narrow = innerWidth < 760;
  const reading = document.body.classList.contains('reading');
  const defs = stationSections.map((s) => {
    const wrap = $('.wrap', s);
    let docY = docTop(s) + s.offsetHeight / 2 + innerHeight * 0.08;
    if (narrow) docY = reading ? docTop(wrap) + wrap.offsetHeight + innerHeight * 0.3 : docTop(s) + innerHeight * 0.72;
    return { id: s.id, theme: s.dataset.station, depth: +s.dataset.depth, side: s.classList.contains('flip') ? -1 : 1, docY };
  });
  const foot = $('footer');
  ocean.layout(defs, docTop(foot) + foot.offsetHeight - innerHeight * 0.3, html.scrollHeight);
}
function depthAt(y) {
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i], b = anchors[i + 1];
    if (y <= b.y) return a.d + (b.d - a.d) * Math.max(0, (y - a.y) / Math.max(1, b.y - a.y));
  }
  return anchors[anchors.length - 1].d;
}
measure();
addEventListener('resize', measure);
addEventListener('load', measure);
document.fonts?.ready.then(measure);

const meterVal = $('.meter-val');
const meterZone = $('.meter-zone');
const gaugeFill = $('.gauge-fill');
const fmt = new Intl.NumberFormat('fr-FR');
let shown = 0;
let lastText = '';
(function frame() {
  const target = depthAt(scrollY);
  shown += (target - shown) * 0.12;
  if (Math.abs(target - shown) < 0.5) shown = target;
  const text = `${fmt.format(Math.round(shown))} m`;
  if (text !== lastText) {
    meterVal.textContent = text;
    meterZone.textContent = zoneAt(shown);
    lastText = text;
  }
  const color = ocean.bgOverride ?? colorAt(shown);
  document.body.style.backgroundColor = color;
  ocean.setDepth(shown, color);
  gaugeFill.style.height = `${Math.min(100, (scrollY / Math.max(1, html.scrollHeight - innerHeight)) * 100)}%`;
  requestAnimationFrame(frame);
})();

// ─── Bulles DOM autour d'un élément ─────────────────────────────────────────
const fx = $('#fx');
function puff(el, n = 10) {
  const r = el.getBoundingClientRect();
  if (r.bottom < 0 || r.top > innerHeight) return;
  for (let i = 0; i < n; i++) {
    const b = document.createElement('span');
    const size = rand(6, 18);
    b.className = 'b';
    b.style.cssText = `width:${size}px;height:${size}px;left:${r.left + rand(0, r.width)}px;top:${r.bottom - rand(0, Math.min(40, r.height))}px;`
      + `--dx:${rand(-30, 30)}px;--dy:${-rand(70, 180)}px;--dur:${rand(1.2, 2.4)}s;animation-delay:${rand(0, 0.35)}s`;
    b.addEventListener('animationend', () => b.remove());
    fx.appendChild(b);
  }
}

const revealObs = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    e.target.classList.add('in');
    if (e.target.hasAttribute('data-puff')) setTimeout(() => puff(e.target), 300);
    revealObs.unobserve(e.target);
  }
}, { threshold: 0.2, rootMargin: '0px 0px -6% 0px' });
$$('.reveal').forEach((el) => revealObs.observe(el));

// ─── Créatures 3D déclenchées quand une section traverse le milieu de l'écran
const lastFired = new WeakMap();
const eventObs = new IntersectionObserver((entries) => {
  const now = performance.now();
  for (const e of entries) {
    if (!e.isIntersecting || focused || skills.active) continue;
    if (now - (lastFired.get(e.target) ?? -1e9) < 8000) continue;
    lastFired.set(e.target, now);
    ocean.trigger(e.target.dataset.event);
  }
}, { rootMargin: '-40% 0px -40% 0px' });
$$('[data-event]').forEach((el) => eventObs.observe(el));

new IntersectionObserver(([e]) => ocean.setAngler(e.isIntersecting), { rootMargin: '0px 0px -20% 0px' })
  .observe($('#contact'));

// ─── Exploration d'une station ──────────────────────────────────────────────
const panel = $('#panel');
const panelBody = $('.panel-body', panel);
const tip = $('#tip');
let focused = null;
let opener = null;
let openTimer = 0;

function openZone(section, trigger = null) {
  // Les compétences ont leur propre mise en scène : plongée en cinématique, puis six blocs à éclairer.
  if (section.dataset.mode === 'dive') { if (!focused) skills.enter(section, trigger); return; }
  if (focused || !ocean.focus(section.id)) return;
  focused = section;
  opener = trigger;
  // Promontoire à gauche : la fiche s'ouvre à droite.
  html.classList.toggle('focus-flip', section.classList.contains('flip'));
  html.classList.add('focusing');
  html.classList.remove('can-explore');
  tip.classList.remove('on');
  $('.panel-depth', panel).textContent = $('.depth-tag', section).textContent;
  $('#panel-title').textContent = $('h2', section).textContent;
  panelBody.innerHTML = $('.details', section).innerHTML;
  [...panelBody.children].forEach((c, i) => c.style.setProperty('--i', i));
  panelBody.scrollTop = 0;
  // La fiche s'ouvre quand la caméra et le robot sont arrivés.
  openTimer = setTimeout(() => {
    panel.hidden = false;
    requestAnimationFrame(() => {
      panel.classList.add('open');
      $('.panel-close', panel).focus({ preventScroll: true });
      setTimeout(() => $$('.chips li, .facts li, .traits span', panelBody).forEach((el, i) => {
        if (i % 3 === 0) setTimeout(() => puff(el, 3), i * 40);
      }), 900);
    });
  }, 1150);
}

function closeZone() {
  if (!focused) return;
  clearTimeout(openTimer);
  panel.classList.remove('open');
  setTimeout(() => { if (!focused) panel.hidden = true; }, 600);
  ocean.unfocus();
  html.classList.remove('focusing');
  opener?.focus({ preventScroll: true });
  focused = null;
}

$$('.explore').forEach((btn) => btn.addEventListener('click', (e) => {
  e.stopPropagation();
  openZone(btn.closest('section'), btn);
}));
$('.panel-close').addEventListener('click', closeZone);
$('.panel-back').addEventListener('click', closeZone);
addEventListener('keydown', (e) => { if (e.key === 'Escape') closeZone(); });
const skills = initSkills(ocean, { puff });
// Faire défiler hors de la fiche referme l'exploration, comme pour reprendre la descente.
addEventListener('wheel', (e) => { if (focused && !panel.contains(e.target)) closeZone(); }, { passive: true });
addEventListener('touchmove', (e) => { if (focused && !panel.contains(e.target)) closeZone(); }, { passive: true });

// Survol des stations : curseur + bulle d'aide
let hoverId = null;
addEventListener('pointermove', (e) => {
  if (focused || skills.active || e.pointerType === 'touch') return;
  const overUi = e.target.closest?.('a, button, .panel, .reading-toggle');
  const id = overUi ? null : ocean.pick(e.clientX, e.clientY);
  if (id !== hoverId) {
    hoverId = id;
    ocean.setHover(id);
    html.classList.toggle('can-explore', !!id);
    if (id) tip.textContent = `Explorer · ${$(`#${id} h2`).textContent}`;
    tip.classList.toggle('on', !!id);
  }
  if (id) tip.style.left = `${e.clientX}px`, tip.style.top = `${e.clientY}px`;
});

document.addEventListener('click', (e) => {
  if (skills.active) return;
  if (focused) {
    if (!panel.contains(e.target)) closeZone();
    return;
  }
  if (e.target.closest('a, button')) return;
  const id = ocean.pick(e.clientX, e.clientY);
  if (id) { openZone($(`#${id}`)); return; }
  if (scrollY < innerHeight * 0.3 && e.clientY < innerHeight * 0.58) return; // pas de bulles dans le ciel
  ocean.burstAt(e.clientX, e.clientY);
});

// ─── Mode lecture : tout le contenu déplié, sans exploration ─────────────────
const readingBtn = $('.reading-toggle');
readingBtn.addEventListener('click', () => {
  // On garde à l'écran la section en cours de lecture, malgré le contenu qui se déplie au-dessus.
  const current = $$('main > section').find((s) => s.getBoundingClientRect().bottom > innerHeight * 0.3);
  const offset = current ? current.getBoundingClientRect().top : 0;
  const on = document.body.classList.toggle('reading');
  readingBtn.setAttribute('aria-pressed', on);
  readingBtn.textContent = on ? 'Mode plongée' : 'Mode lecture';
  ocean.setReading(on);
  if (on) $$('.details [data-puff]').forEach((el) => revealObs.observe(el));
  if (current) scrollTo({ top: current.getBoundingClientRect().top + scrollY - offset, behavior: 'instant' });
  measure();
});

// ─── Petits plaisirs ────────────────────────────────────────────────────────
let chipCool = 0;
document.addEventListener('pointerover', (e) => {
  const el = e.target.closest?.('.chips li, .traits span');
  if (!el) return;
  const now = performance.now();
  if (now - chipCool < 120) return;
  chipCool = now;
  puff(el, 4);
});

$('.surface').addEventListener('click', () => scrollTo({ top: 0, behavior: 'smooth' }));
