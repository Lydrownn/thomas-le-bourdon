# Portfolio · Thomas Le Bourdon

Portfolio en « plongée » inspiré de [neal.fun/deep-sea](https://neal.fun/deep-sea/) : on descend de la surface aux abysses. À chaque palier, un promontoire rocheux (coraux, algues, faune) porte un objet lumineux. Un clic dessus fait zoomer la caméra, le robot sous-marin vient l'éclairer et la fiche de la section s'ouvre.

**En ligne :** <https://lydrownn.github.io/thomas-le-bourdon/> (GitHub Pages, branche `main`). Chaque `git push` sur `main` redéploie le site en une minute environ.

## Lancer en local

```bash
node serve.mjs
# → http://localhost:5173  (autre port : PORTFOLIO_PORT=8080 node serve.mjs)
```

Aucune dépendance à installer : Three.js est chargé depuis un CDN (importmap dans `index.html`).

## Structure

```
portfolio/
├── index.html          # Tout le contenu (sections, textes, projets)
├── css/style.css       # Mise en page, surface, fiche d'exploration, bulles DOM
├── js/app.js           # Jauge, couleur de l'eau, déclencheurs, exploration, mode lecture
├── js/scene.js         # Scène 3D : ROV, stations, falaises, plancher, créatures, zoom
├── js/props.js         # Décors procéduraux (rochers, éponges, anémones, objets à explorer)
├── js/assets.js        # Chargement et normalisation des modèles .glb
├── assets/models/      # Modèles 3D (voir CREDITS.txt pour les licences)
└── serve.mjs           # Mini serveur statique de dev
```

## Modifier le contenu

Chaque section explorable suit ce gabarit :

```html
<section id="projets" data-depth="1300" data-event="jelly" data-station="chest">
  <div class="wrap">
    <p class="depth-tag reveal">1 300 m</p>
    <h2 class="reveal">Projets</h2>
    <p class="teaser reveal">Accroche courte, visible pendant la descente.</p>
    <button class="explore reveal" type="button">Explorer la zone →</button>
    <div class="details">… contenu complet, affiché dans la fiche …</div>
  </div>
</section>
```

- `data-depth` : profondeur affichée sur la jauge.
- `data-event` : créature déclenchée au passage (`school`, `whale`, `manta`, `jelly`, `sonar`, `hook`, `bubbles`).
- Les promontoires alternent droite / gauche (classe `flip` posée par `app.js` une section sur deux) ; le texte, la fiche d'exploration et le robot se placent du côté opposé.
- `data-station` : objet du promontoire (`bottle`, `helm`, `anchor`, `chest`, `lab`, `clam`). La végétation dépend de la profondeur : algues et coraux colorés au-dessus de 200 m, coraux pâles et éponges ensuite, faune bioluminescente sous 1 000 m.
- Le bouton « Mode lecture » déplie tous les `.details` dans la page, sans exploration.
- La baudroie apparaît sur `#contact` ; le plancher abyssal (cheminée hydrothermale, vers tubicoles…) est sous le footer.

## Modèles 3D

Les modèles viennent de [Poly Pizza](https://poly.pizza) : Quaternius en CC0, les autres en CC-BY 3.0 (auteurs listés dans `assets/models/CREDITS.txt`, crédit affiché dans le footer). Pour en ajouter un : le déposer dans `assets/models/`, l'ajouter à `MODELS` dans `js/assets.js`, puis l'instancier avec `instance('nom', { size, anchor, fix })`.
