# Pixels Racing

Jeu de course en pixel art vue du dessus, **multijoueur en ligne** dans le navigateur, jouable sur **PC et mobile**.

- 16 voitures (tirées de la planche de sprites) réparties en 4 familles : **Équilibrée**, **Vitesse** (pointe haute, moins d'adhérence), **Agile** (accélère et tourne mieux), **Lourde** (pousse les autres, encaisse mieux les chocs).
- 3 circuits : Circuit Néon, Anneau du Lac et **Le Grand Huit** (en huit avec un pont), plus ton **circuit perso** fait dans l'éditeur.
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

## Organisation

- `src/shared` : simulation commune client/serveur — physique (`cars/physics.ts`), circuits (`track/`), course, tours et bots (`race/`).
- `src/server` : HTTP + WebSocket, salles par code, classement (`records/records.ts`, API `GET/POST /api/records`).
- `src/client` : éditeur (`editor/`), fantôme (`game/ghost.ts`), rendu Canvas basse résolution agrandi sans lissage, HUD, écrans, commandes.
- `tools/sprites/extract.py` : découpe la planche `voitures-sheet.png` en atlas (`pip install pillow numpy`).

Ajouter un circuit : une entrée dans `src/shared/track/tracks.ts` (boucle de points de contrôle). `npm test` vérifie que la piste ne se chevauche pas, que les virages sont assez larges et que 8 bots bouclent la course ; il teste aussi le turbo, les objets et les dégâts.
