# Spécifications Techniques — Composants Cartographiques (Globe, Preview, Tiles)

> Document de référence pour la refonte visuelle et technique des composants de carte de *Live Traffic Monitor*.
> Conçu selon la grille de lecture **impeccable** : typographie à contraste élevé, palette OKLCH perceptuellement uniforme, rendu sans "AI slop", accessibilité WCAG 2.1 AA, et animation par transformation/opacité uniquement.

---

## 0. Contexte de conception (Design Context)

### Users
Parieurs sportifs / observateurs de trafic consultant l'interface sur desktop (RTS en open-space ou home office, lumière ambiante variable) et mobile (transports, extérieur lumineux). Le job à faire : *localiser instantanément une ville, juger de la clarté du flux vidéo live, et parier en confiance.*

### Brand Personality
3 mots : **précis · nerveux · crédible**. Émotion cible : la confiance immédiate née de la lisibilité et de la netteté (pas de clinquant néon).

### Aesthetic Direction
- **Thème** : dark par défaut (consultation prolongée, réduction d'éblouissement) avec surface neutre teintée vers le hue de marque (teal/emerald `hue ≈ 165`).
- **Anti-références** : cyan-on-dark, dégradés néon, glow borders partout, gradient-text, side-stripe borders, cartes à coins arrondis + ombre générique.
- **Palette de base** (OKLCH) :
  - Surface fundamentale : `oklch(16% 0.01 165)` (presque noir teinté teal, jamais `#000`).
  - Surface élevée : `oklch(22% 0.015 165)`.
  - Texte primaire : `oklch(96% 0.005 165)` (jamais `#fff`).
  - Accent marque : `oklch(72% 0.15 165)` (emerald vif mais chroma maîtrisé).
  - Accent danger/détection : `oklch(65% 0.19 25)` (rouge chaud, pas `#EF4444` plat).
- **Typographie** : paire display/body distinctive. Display = *"Space Grotesk" refusé* → utiliser **"Geist"** ou **"Hanken Grotesk"** pour l'UI ; labels techniques en **"JetBrains Mono"** (uniquement pour les métriques/coordonnées, pas comme shorthand partout). Échelle modulaire 5 paliers, ratio ≥ 1.25.

---

## 1. Globe Marker Redesign

### 1.1 Objectif & comportement attendu
Le globe comporte deux artefacts distincts par ville :
1. **Le point de marker** (dot) projeté sur la sphère cobe — doit se détacher de la texture du globe (continents, océans) par séparation de profondeur, contraste de luminance et halo.
2. **La carte de flux live au survol** — lors du hover d'un marker, une vignette `<a>` anchor-positionnée apparaît **juste au-dessus** du marker survolé (jamais centrée sur lui), affichant la vidéo du flux HLS, une vignette interne, un label LIVE pulsé, le nom de la ville et le compte de viewers. C'est le cœur de l'expérience : *au survol, le marker "déploie" son flux au-dessus de lui*.

> **Positionnement impératif** : la carte doit être ancrée par son **bord inférieur** au **haut du marker** (`bottom: anchor(top)`), centrée horizontalement (`left: anchor(center)` + `translate: -50% 0`), avec une marge de `12px` pour ne pas toucher le point. Elle ne doit PAS utiliser `bottom: anchor(center) / translate: -50% -50%` (qui la centrerait sur le marker).

> Référence d'implémentation actuelle (DOM réel de `globe-live.tsx`) — à ajuster pour l'ancrage "au-dessus" :
> ```html
> <a href="/room/london" style="position:absolute; position-anchor:--cobe-london;
>    bottom:calc(anchor(top) + 12px); left:anchor(center); translate:-50% 0;
>    width:134px; height:80px; border-radius:14px; overflow:hidden;
>    border:2px solid rgb(16,185,129);
>    box-shadow: rgba(16,185,129,0.18) 0 0 0 2px, rgba(15,23,42,0.22) 0 8px 24px;
>    background:rgb(11,13,20); pointer-events:auto; cursor:pointer;">
>   <video src="...m3u8" class="h-full w-full object-cover" playsinline autoplay loop></video>
>   <div style="position:absolute; inset:0; border-radius:14px; pointer-events:none;
>        box-shadow: rgba(255,255,255,.1) 0 0 0 1px inset, rgba(11,13,20,.55) 0 -30px 44px inset;"></div>
>   <div style="position:absolute; left:0; right:0; bottom:0; display:flex; align-items:center; gap:5px;
>        padding:4px 7px; background:linear-gradient(to top, rgba(11,13,20,.95), rgba(11,13,20,0));">
>     <span style="width:7px; height:7px; border-radius:50%; background:rgb(52,211,153);
>           box-shadow:rgb(52,211,153) 0 0 7px; animation:live-pulse 1.5s ease-in-out infinite;"></span>
>     <span style="font-size:11.5px; font-weight:800; color:#fff; white-space:nowrap;
>           overflow:hidden; text-overflow:ellipsis;">London</span>
>     <span style="font-size:9.5px; font-weight:700; letter-spacing:.08em; color:rgb(110,231,183);
>           white-space:nowrap;">LIVE</span>
>     <span style="margin-left:auto; font-size:10px; color:rgba(255,255,255,.85); white-space:nowrap;">1 045</span>
>   </div>
> </a>
> ```

### 1.2 Marqueur de base (point sur le globe cobe)
| Couche | Technique | Paramètres |
|---|---|---|
| A. Halo d'occlusion | `box-shadow` diffuse écartée de 3× le rayon du marker | `0 0 0 6px oklch(72% 0.15 165 / 0.12)` + `0 0 18px 10px oklch(72% 0.15 165 / 0.25)` |
| B. Corps du marker | Disque plein avec dégradé radial simulant une source lumineuse en relief (light haut-gauche) | `radial-gradient(circle at 35% 30%, oklch(88% 0.1 165), oklch(60% 0.16 165))` |
| C. Anneau de contraste | Stroke `1.5px` `oklch(98% 0 0)` à 85% opacité pour sceller le bord contre toute texture sombre | `box-shadow: inset 0 0 0 1.5px oklch(98% 0 0 / 0.85)` |
| D. Cœur / point central | Petit disque `oklch(99% 0 0)` pour le "ping" de présence | `box-shadow: 0 0 8px oklch(99% 0 0)` |
| E. Pulse de présence (live) | Anneau animé scale 1 → 2.4, opacity 0.6 → 0, `ease-out` | `transform` + `opacity` uniquement |

- **`markerElevation`** : cible `0.022` (actuel `0.012`, +83%) pour projeter une ombre portée sur la sphère.
- **`markerColor`** : remplacer `[0.05,0.7,0.5]` (sRGB) par la conversion OKLCH→sRGB linéaire de `oklch(72% 0.15 165)` pour cohérence avec l'accent de marque.

### 1.3 Carte de flux live au survol (refonte impeccable)
La carte existante fonctionne ; on l'affine sans casser le comportement anchor-positionné :

- **Couleur de bordure & halo** : `rgb(16,185,129)` → `oklch(72% 0.15 165)` (même teinte, perceptuellement uniforme). Conserver le double `box-shadow` (halo fin + ombre portée) — il sert la séparation, pas du décoratif gratuit.
- **Vignette interne** (le `div` inset) : **conserver** `inset 0 0 0 1px rgba(255,255,255,.1)` (lisibilité du label) + `inset 0 -30px 44px rgba(11,13,20,.55)` (dégradé de pied). Cette vignette est exigée par le brief utilisateur (« comme ceci »).
- **Label LIVE** : remplacer `system-ui` par **Hanken Grotesk** (UI) ; garder le point pulsé `rgb(52,211,153)` → `oklch(80% 0.16 165)`. `animation: live-pulse 1.5s ease-in-out infinite` (déjà correct, `transform`/`opacity`).
- **Nom de ville** : Hanken Grotesk 800, `clamp(11.5px, 1.1vw, 13px)`, `color: oklch(98% 0.005 165)` (≈ `#fff` mais teinté), `text-overflow: ellipsis; max-width: 60%`.
- **Compte viewers** : **JetBrains Mono** 10px (métrique), `color: oklch(96% 0.005 165 / 0.85)`.
- **Apparition — Framer Motion (fade + scale)** : remplacer la mécanique CSS `opacity/blur + transition` par un composant `motion.a` (ou `motion.div` wrapper) de **Framer Motion**. La carte apparaît **au-dessus du marker** avec une entrée `fade` (opacity 0 → 1) combinée à un `scale` (0.85 → 1), et sort avec l'inverse. Cela donne un "déploiement" doux sans jamais centrer la carte sur le point.
  ```tsx
  <AnimatePresence>
    {isHovered && (
      <motion.a
        key={m.id}
        href={m.href}
        initial={{ opacity: 0, scale: 0.85 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.85 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }} // ease-out-quint
        style={{
          position: 'absolute',
          positionAnchor: `--cobe-${m.id}`,
          bottom: 'calc(anchor(top) + 12px)',
          left: 'anchor(center)',
          translate: '-50% 0',            // centré horizontalement, bord bas au-dessus
          width: 134, height: 80,
          borderRadius: 14, overflow: 'hidden',
          border: '2px solid oklch(72% 0.15 165)',
          boxShadow: '0 0 0 2px oklch(72% 0.15 165 / 0.18), 0 8px 24px oklch(10% 0.01 165 / 0.22)',
          background: 'oklch(16% 0.01 165)',
          transformOrigin: 'bottom center',   // le scale part du bas = "pousse" vers le haut
          pointerEvents: 'auto', cursor: 'pointer',
        }}
      >
        {/* video + vignette + label LIVE */}
      </motion.a>
    )}
  </AnimatePresence>
  ```
  - **`transformOrigin: 'bottom center'`** est impératif : le `scale` doit croître depuis le bas de la carte (vers le marker), pour renforcer l'impression qu'elle "sort" du point.
  - **Pas de `filter: blur`** au montage (le blur CSS actuel est supprimé au profit du scale, plus net et plus performant — le blur est coûteux en GPU).
  - **`AnimatePresence`** gère proprement l'`exit` au unhover (fade + scale inverse) sans flash.
- **État hover du marker (point uniquement)** : le point de marker peut s'agrandir légèrement (`scale 1 → 1.15` en `motion.span`) mais la **carte** ne change plus de taille au survol — sa taille est fixe (134×80), seule l'apparition est animée. Cela évite tout anime de layout.

### 1.4 Contrast ratios (exigence WCAG AA)
| Élément | Fond moyen | Texte/Couleur | Ratio minimal |
|---|---|---|---|
| Nom de ville (carte) | `oklch(16% 0.01 165)` | `oklch(98% 0.005 165)` | **≥ 7:1** (AAA) |
| Badge LIVE | `oklch(65% 0.19 25)` | `oklch(99% 0 0)` | **≥ 4.5:1** (AA) |
| Viewers | `transparent` | `oklch(96% 0.005 165)` | **≥ 7:1** |
| Halo / bordure marker | texture globe (≈`oklch(40% 0.02 200)`) | `oklch(72% 0.15 165)` | **≥ 3:1** (graphique) |

### 1.5 Recommandations d'implémentation (globe-live.tsx)
```ts
const MARKER = {
  core: 'oklch(99% 0 0)',
  bodyTop: 'oklch(88% 0.1 165)',
  bodyBottom: 'oklch(60% 0.16 165)',
  ring: 'oklch(98% 0 0 / 0.85)',
  halo: 'oklch(72% 0.15 165 / 0.22)',
  accent: 'oklch(72% 0.15 165)',       // bordure + halo de la carte de flux
  liveDot: 'oklch(80% 0.16 165)',
  elevation: 0.022,
  pulseEase: 'cubic-bezier(0.16, 1, 0.3, 1)', // ease-out-quint
}
```
- Une seule `@keyframes live-pulse` partagée (éviter N animations redondantes).
- **Framer Motion + accessibilité** : utiliser le hook `useReducedMotion()` de Framer Motion. Si `true`, passer `transition` à `{ duration: 0 }` et `initial/animate/exit` à `{ opacity: 1, scale: 1 }` (apparition instantanée, carte toujours nette, aucun mouvement). Le `live-pulse` du point reste désactivé aussi.
- Le `position-anchor: --cobe-{id}` est maintenu tel quel : c'est la mécanique CSS anchor-positioning qui fixe la carte sur le point du globe selon la rotation `phi/theta`, **au-dessus** du marker (`bottom: calc(anchor(top) + 12px)`).
- Dépendance : `npm i framer-motion` (ou `motion` v11+). Importer `{ motion, AnimatePresence, useReducedMotion }` depuis `framer-motion`.

---

## 2. Preview Display Optimization

### 2.1 Objectif
Le panneau "Selected stream preview" (`StreamTile`) et le label superposé au marker doivent maximiser la **définitions des éléments, la lisibilité typographique, la hiérarchie de l'information**, et réduire le **bruit visuel** (vignettes, doublons, ombres multipliées).

### 2.2 Définition des éléments (element definition)
- **Vidéo** : `object-fit: cover` (et non `contain`) dans le preview principal pour éliminer les bandes noires de letterboxing qui créent du vide ; conserver `contain` uniquement pour le contexte détection brut.
- **Bordure de séparation** : 1px plein `oklch(72% 0.15 165 / 0.4)` (pas de stripe latérale interdite, ni de glow).
- **Overlay détection** : bounding boxes en `oklch(65% 0.19 25)` avec `lineWidth = clamp(2px, 0.4%, 4px)` ; coins arrondis `2px` max pour rester technique sans mollesse.
- **Label de classe** : fond plein de la couleur de classe, texte `oklch(99% 0 0)`, padding `4px 8px`, pas d'ombre portée (déjà contrasté par le fond).

### 2.3 Typographie (legibility)
| Rôle | Police | Taille | Poids | Tracking |
|---|---|---|---|---|
| Label de ville (marker) | Hanken Grotesk | `clamp(12px, 1.1vw, 14px)` | 800 | `-0.01em` |
| Métrique "LIVE / viewers" | JetBrains Mono | 10px | 700 | `0.08em` (uppercase) |
| Compteur COUNT (preview) | JetBrains Mono | `clamp(13px, 1.4vw, 16px)` | 800 | `0` |
| Coordonnées lat/long | JetBrains Mono | 11px | 500 | `0.04em` |

- **Cap line length** : les libellés de ville tronqués via `text-overflow: ellipsis` + `max-width: 60%` du conteneur.
- **Anti-flou** : `text-rendering: optimizeLegibility` + `font-kerning: normal` + `-webkit-font-smoothing: antialiased`.

### 2.4 Scaling & responsive
- Le preview utilise `@container` (pas de viewport query) : à `<320px` de largeur de colonne, le label de ville passe en 11px et le badge viewers se masque (progressive disclosure, pas amputation).
-facteur d'échelle du canvas de détection = `devicePixelRatio` plafonné à 2 pour préserver la netteté des boxes sans surcoût GPU.

### 2.5 Réduction du bruit visuel
1. **Conserver** la double vignette du marker de globe (`inset 0 0 0 1px rgba(255,255,255,.1)` + `inset 0 -30px 44px rgba(11,13,20,.55)`) — exigée par le brief : elle scelle le label et crée le dégradé de pied du flux live au survol. **Ne pas** la remplacer.
2. **Dédoublonner** le header "Global Stream Map" et le sous-texte explicatif (le texte "Each marker plays its live camera…" redit le header → supprimer ou fusionner).
3. **Métriques** : regrouper FPS / frames / détections dans un seul chip mono compact `12fps · 340f · 9det` au lieu de trois spans empilés (uniquement dans le panneau `StreamTile`, pas sur la carte de marker qui garde son badge viewers séparé).
4. **Ombres** : une seule `0 8px 24px oklch(10% 0.01 165 / 0.25)` sur le conteneur preview ; pas d'ombre imbriquée sur chaque sous-élément.

---

## 3. Map Tile Rendering Refinement

### 3.1 Objectif
Éliminer l'**aliasing**, les **artefacts de compression** (blocking 8×8, ringing) et garantir des **transitions sans saccade** (jitter-free) entre niveaux de zoom, sur le rendu du globe cobe et des canvas de détection.

### 3.2 Netteté des bords (edge sharpness)
- **Canvas globe (cobe)** : `devicePixelRatio: Math.min(window.devicePixelRatio || 1, 2)` est correct → ajouter `image-rendering: auto` (laisser le navigateur sous-échantillonner correctement) et **ne pas** forcer `pixelated`.
- **Canvas overlay détection** : synchroniser `canvas.width/height` avec `videoWidth × dpr` et appliquer `ctx.scale(dpr, dpr)` une seule fois par frame pour éviter le flou de sous-échantillonnage.
- **Lissage des boxes** : `ctx.lineJoin = 'round'`, `ctx.lineCap = 'round'` ; antialiasing natif du canvas 2D (pas de `imageSmoothingEnabled=false` qui crée du crénelage).

### 3.3 Élimination des artefacts de compression (procedural)
- **Pré-filtrage du flux HLS** : augmenter `maxBufferLength: 30 → 60` et `maxMaxBufferLength: 60 → 120` pour lisser les coupures de segment ; activer `hls.config.forceKeyFrameOnDiscontinuity = true`.
- **Deringing procédural** : appliquer un léger flou gaussien (σ ≤ 0.6px) **uniquement** sur le canvas de frame capture avant `getImageData`, via `ctx.filter = 'blur(0.4px)'` puis reset, pour atténuer le ringing des bordures haute fréquence sans perdre la détection.
- **Dithering de bande** : sur les dégradés de globe (`baseColor`→`glowColor`), ajouter un bruit de dithering de 1LSB côté shader si possible, sinon un `radial-gradient` en 3 stops pour éviter les bandes de couleur (posterisation).

### 3.4 Transitions sans jitter entre niveaux de zoom (mathématiques)
Le globe cobe tourne via `phi/theta`. Pour des transitions jitter-free lors du drag et du zoom :

1. **Interpolation exponentielle** de `phiOffsetRef` et `thetaOffsetRef` vers la cible au lieu d'assignation directe :
   ```
   const k = 1 - Math.exp(-dt / TAU)   // TAU ≈ 0.12s
   phiOffset += (phiTarget - phiOffset) * k
   ```
   Cela garantit un easing frame-rate-indépendant (pas de dépendance à `requestAnimationFrame` delta brut).
2. **Clamp du delta de drag** : `dragOffset.phi = clamp(delta / 300, -0.08, 0.08)` pour éviter les sauts brusques au relâchement.
3. **Zoom continu** (si un contrôle de zoom est ajouté) : utiliser une fonction de **lerp logarithmique** sur le rayon de caméra `r(t) = r0 * exp(lerp(ln(r0), ln(r1), ease(t)))` — préserve la perception constante de vitesse (l'œil perçoit le zoom en ratio, pas en delta linéaire).
4. **Snapping aux markers** : à la fin d'un drag, trouver le marker le plus proche en angle et animer `theta` vers lui avec `ease-out-quint` (`cubic-bezier(0.16,1,0.3,1)`) sur 280ms, `transform`/`opacity` uniquement côté overlay.

### 3.5 Qualité de rendu — checklist de validation
- [ ] Aucun crénelage sur les bounding boxes à 100% / 200% zoom navigateur.
- [ ] Bandes de couleur absentes sur le globe (vérifier dégradé océan→pôle).
- [ ] Drag relâché : pas de "snap" > 2px de position attendue.
- [ ] Transition de zoom : vitesse perçue constante (pas d'accélération au centre).
- [ ] `prefers-reduced-motion: reduce` → animations de pulse/zoom désactivées, rendu statique net.

---

## 4. Synthèse des principes directeurs (à appliquer partout)

1. **OKLCH > sRGB** : toutes les couleurs passent par OKLCH ; chroma réduit aux extrêmes de luminance.
2. **Une seule ombre par conteneur** ; jamais de glow décoratif.
3. **Typographie à deux familles** : display grotesque + mono pour les métriques ; contraste de poids, pas de gradient-text.
4. **Animation par `transform`/`opacity`** ; easing `ease-out-quint` ; respect de `prefers-reduced-motion`.
5. **Densité d'information maîtrisée** : 60% surface / 30% texte secondaire / 10% accent (règle 60-30-10 par poids visuel).
6. **Accessibilité** : contrastes ≥ 4.5:1 (AA), ≥ 7:1 pour le texte primaire ; focus visible `2px oklch(72% 0.15 165)` sur tout élément interactif.