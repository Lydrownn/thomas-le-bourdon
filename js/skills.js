// Section « Compétences » : au lieu d'une fiche, le robot plonge dans une grotte
// où six blocs (un par groupe de compétences) sont à éclairer un par un.
// Le contenu reste dans index.html (.skill-group) : ce module ne fait que le lire.
const $ = (s, r = document) => r.querySelector(s);
const html = document.documentElement;

export function initSkills(ocean, { puff }) {
  const zone = ocean.zone;
  const hud = $('#skills-hud');
  const card = $('.skill-card', hud);
  const dots = $('.skills-dots', hud);
  const count = $('.skills-count', hud);
  const hint = $('.skills-hint', hud);
  const tip = $('#tip');
  let groups = [];
  let opener = null;
  let ready = false;
  let shown = -1;
  const lit = new Set();
  const api = { active: false, enter, exit };

  function readGroups(section) {
    return [...section.querySelectorAll('.skill-group')].map((el) => ({
      title: $('h3', el).textContent,
      items: [...el.querySelectorAll('li')].map((li) => li.textContent),
      glyph: el.dataset.glyph,
      color: el.dataset.color,
    }));
  }

  function renderProgress() {
    dots.innerHTML = groups.map((g, i) => `<i class="${lit.has(i) ? 'on' : ''}" style="--c:${g.color}"></i>`).join('');
    count.textContent = `${lit.size} / ${groups.length}`;
    hud.classList.toggle('complete', lit.size === groups.length);
  }

  function showCard(i) {
    shown = i;
    const g = groups[i];
    card.style.setProperty('--c', g.color);
    $('h3', card).textContent = g.title;
    $('.chips', card).innerHTML = g.items.map((t) => `<li>${t}</li>`).join('');
    card.hidden = false;
    card.classList.remove('in');
    void card.offsetWidth; // relance l'animation
    card.classList.add('in');
    [...card.querySelectorAll('.chips li')].forEach((el, k) => setTimeout(() => puff(el, 3), 150 + k * 90));
  }

  function enter(section, trigger = null) {
    if (api.active) return;
    groups = readGroups(section);
    if (!groups.length) return;
    api.active = true;
    ready = false;
    opener = trigger;
    lit.clear();
    shown = -1;
    card.hidden = true;
    hint.textContent = 'Clique sur un bloc : le robot va l’éclairer.';
    renderProgress();
    zone.enter(groups, {
      onStart: () => {
        html.classList.add('focusing', 'skills-mode');
        html.classList.remove('can-explore');
        tip.classList.remove('on');
      },
      onReady: () => {
        ready = true;
        hud.hidden = false;
        requestAnimationFrame(() => hud.classList.add('open'));
        $('.skills-exit', hud).focus({ preventScroll: true });
      },
      onLit: (i) => {
        lit.add(i);
        renderProgress();
        if (lit.size === groups.length) {
          zone.celebrateAll();
          hint.textContent = 'Zone entièrement éclairée. Tout est là.';
        } else {
          hint.textContent = `Encore ${groups.length - lit.size} bloc${groups.length - lit.size > 1 ? 's' : ''} dans l’ombre.`;
        }
      },
    });
  }

  function exit() {
    if (!api.active || !ready) return;
    ready = false;
    hud.classList.remove('open');
    tip.classList.remove('on');
    html.classList.remove('can-explore');
    zone.exit({
      onStart: () => html.classList.remove('skills-mode'),
      onClosed: () => {
        hud.hidden = true;
        hud.classList.remove('open');
        card.hidden = true;
        html.classList.remove('focusing');
        api.active = false;
        opener?.focus({ preventScroll: true });
      },
    });
  }

  function select(i) {
    zone.lightBlock(i);
    showCard(i);
    if (lit.has(i)) return;
    hint.textContent = `Le robot éclaire « ${groups[i].title} »…`;
  }

  addEventListener('pointermove', (e) => {
    if (!api.active || !ready || e.pointerType === 'touch') return;
    const over = e.target.closest?.('button, .skill-card');
    const i = over ? -1 : zone.pick(e.clientX, e.clientY);
    zone.setHover(i);
    html.classList.toggle('can-explore', i >= 0);
    if (i >= 0) {
      tip.textContent = `${lit.has(i) ? 'Revoir' : 'Éclairer'} · ${groups[i].title}`;
      tip.style.left = `${e.clientX}px`;
      tip.style.top = `${e.clientY}px`;
    }
    tip.classList.toggle('on', i >= 0);
  });

  addEventListener('click', (e) => {
    if (!api.active || !ready) return;
    if (e.target.closest('button, .skill-card')) return;
    const i = zone.pick(e.clientX, e.clientY);
    if (i >= 0) select(i);
    else ocean.burstAt(e.clientX, e.clientY);
  });

  $('.skills-exit', hud).addEventListener('click', exit);
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') exit();
    // Accès clavier : les touches 1 à 6 éclairent le bloc correspondant.
    if (api.active && ready && /^[1-9]$/.test(e.key) && +e.key <= groups.length) select(+e.key - 1);
  });

  return api;
}
