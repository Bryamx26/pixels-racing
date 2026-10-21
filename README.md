# Pixels Racing

Jeu de course en pixel art **isométrique**, **multijoueur en ligne** dans le navigateur, jouable sur **PC et mobile**.

- Vue isométrique : voitures en voxels inspirées de vrais modèles (muscle car à prise d'air et pare-chocs chromés, sportive, citadine, berline, SUV, monster truck), vitres bleutées, phares, couleurs reprises des anciens designs. Elles sont dessinées un peu plus petites (la hitbox reste à 1/4 de la chaussée) avec une caméra légèrement reculée. Circuits entourés d'une ville en blocs et d'arbres, pont surélevé sur pilotis. Un décor qui cache ta voiture devient transparent.
- 20 voitures en 5 familles : **Équilibrée**, **Vitesse** (pointe haute, moins d'adhérence), **Agile** (accélère et tourne mieux), **Lourde** (pousse les autres, encaisse mieux les chocs) et **Drift** (Kaido, Touge, Ronin, Sakura : propulsions à ailes et ailes élargies qui tiennent la glisse à l'accélérateur).
- **Mode drift** (accueil → MODE DRIFT) : un coup de frein pour lancer la glisse, puis gaz et contre-braquage. Les points montent avec la vitesse et l'angle, le multiplicateur grimpe tant que la glisse s'enchaîne (×5 max), un mur fait perdre le combo. Record par circuit.
- **Monde ouvert** (accueil → MONDE OUVERT), façon Forza Horizon : une carte de 20 000 × 20 000 avec Pixel City (rues en damier, tours, parc central), l'aérodrome (piste d'envol, hangars, avions, tour de contrôle), les docks et leur arène de drift (cônes, conteneurs), le Grand Parc (lac, pont, chemins de terre), la route de montagne en lacets des collines, la campagne, le village de Port-Joli et la plage, reliés par un périphérique et deux autoroutes. Seul ou **en ligne en balade libre** (jusqu'à 16 joueurs par monde, on entre et on sort quand on veut).
  - 14 défis lancés en franchissant une arche : zones de drift (violet), arène de drift chronométrée, radars et zones de vitesse (bleu), sprints à points de passage (orange). Résultat en étoiles, record gardé, exploit annoncé aux autres joueurs en ligne.
  - 30 panneaux bonus ★ à casser, carte plein écran (M) avec voyage rapide et itinéraire, minicarte, R pour se remettre sur la route.
- 4 circuits : Circuit Néon, Anneau du Lac, **Le Grand Huit** (en huit avec un pont) et **Centre-Ville** (circuit urbain entre les immeubles, deux ponts sur la rivière, un pont surélevé et un parc avec étang), plus ton **circuit perso** fait dans l'éditeur.
- Une voiture fait exactement **1/4 de la largeur de la chaussée** : quatre voitures de front, la piste est marquée en quatre voies.
- Course solo contre 0 à 7 bots, ou salles privées en ligne par code (jusqu'à 8 pilotes, bots en option), lien d'invitation `/?salle=CODE`.
- Conduite : rotation avec inertie, rayon de braquage selon la vitesse (sous-virage si on entre trop vite), roulis visible, dérapage au freinage à haute vitesse, **aspiration** derrière une voiture (plus d'accélération et de vitesse de pointe, pour tous, bots compris).
- **Turbo** : la jauge se remplit en dérapant et en profitant de l'aspiration, on la vide d'un coup avec le bouton TURBO.
- **Boîtes d'objets** (désactivables) : nitro, flaque d'huile (tête-à-queue), bouclier. Les derniers ont plus de chances de tomber sur du nitro.
- **Dégâts et stands** : les chocs contre les murs et les voitures abîment la voiture (moins de vitesse et d'accélération) ; s'arrêter sur la bande jaune « STANDS » juste avant la ligne la répare.
- **Contre-la-montre** : seul en piste, avec le **fantôme** de ton meilleur tour sur ce circuit (enregistré dans le navigateur).
- **Classement en ligne** des meilleurs tours par circuit (top 10, un temps par pseudo), alimenté par les tours en solo, contre-la-montre et en ligne.
- **Éditeur de circuit** : on pose et déplace des points, les mêmes règles que les circuits officiels sont vérifiées en direct ; le circuit sert en solo et dans les salles en ligne (envoyé aux autres joueurs).
- Serveur autoritaire 60 Hz ; voiture du joueur prédite localement, autres voitures interpolées ; reconnexion automatique (pilote auto pendant la coupure).
- Mobile : boutons tactiles ◀ ▶ / GAZ / FREIN / TURBO / OBJET, accélération automatique en option, plein écran paysage, installable sur l'écran d'accueil.

## Lancer

```bash
npm install
npm start          # compile le client et lance le serveur sur http://localhost:3000
```

Sur un téléphone du même réseau Wi-Fi : `http://<ip-du-PC>:3000`.

Développement (rechargement à chaud) : `npm run dev` puis http://localhost:5173.
Docker : `docker compose up -d --build` (le classement est gardé dans le volume `records`). Sans Docker, il est écrit dans `data/records.json` (ou le chemin de `RECORDS_FILE`).

## Commandes

| | PC | Mobile | Manette |
|---|---|---|---|
| Gaz | ↑ ou Z (W en QWERTY) | GAZ | RT / A |
| Frein, marche arrière | ↓ ou S | FREIN | LT / B |
| Diriger | ← → ou Q D | ◀ ▶ | stick gauche |
| Dérapage | freiner à grande vitesse | FREIN | LT |
| Turbo | Espace ou Maj | TURBO | X / LB |
| Objet | E, F, Entrée ou Ctrl | OBJET | Y / RB |
| Menu | Échap | II | |

**Volant** (Logitech, Thrustmaster, Fanatec…) : Accueil → RÉGLAGES / VOLANT. Calibrage en 4 étapes (repos, volant à droite, accélérateur, frein), direction linéaire sans zone morte, rotation en jeu réglable de 270° à 1080° (900° par défaut, comme une vraie voiture), pédales séparées, palettes = turbo.

**Sensations** : transfert de charge (l'avant braque mieux au freinage), pneus qui lâchent progressivement en glisse, boîte à 6 rapports simulée (compte-tours, son), crissement des pneus, vent, vibreurs, fumée de drift, étincelles, traits de vitesse et halo du turbo, vibrations de la manette et du téléphone (désactivables dans les réglages).

## Organisation

- `src/shared` : simulation commune client/serveur — physique (`cars/physics.ts`), circuits (`track/`), course, tours et bots (`race/`).
- `src/shared/world` : monde ouvert — plan de la carte (`layout.ts`), revêtements et collisions avec le décor (`world.ts`), balade partagée (`roam.ts`), défis (`challenges.ts`).
- `src/server` : HTTP + WebSocket, salles par code, mondes ouverts (`rooms/roamRoom.ts`), classement (`records/records.ts`, API `GET/POST /api/records`).
- `src/client` : éditeur (`editor/`, vu de dessus), fantôme (`game/ghost.ts`), rendu isométrique (`render/iso*.ts`, monde ouvert cuit en tuiles à la demande dans `render/world*.ts`, interface dans `roam/`) en Canvas basse résolution agrandi sans lissage, HUD, écrans, commandes.
- `tools/sprites/extract.py` : découpe la planche `voitures-sheet.png` en atlas (`pip install pillow numpy`).

Ajouter un circuit : une entrée dans `src/shared/track/tracks.ts` (boucle de points de contrôle). `npm test` vérifie que la piste ne se chevauche pas, que les virages sont assez larges et que 8 bots bouclent la course ; il teste aussi le turbo, les objets et les dégâts.
