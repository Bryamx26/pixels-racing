# Pixels Racing

Jeu de course en pixel art vue du dessus, **multijoueur en ligne** dans le navigateur, jouable sur **PC et mobile**.

- 16 voitures (tirées de la planche de sprites), 2 circuits (Circuit Néon, Anneau du Lac).
- Une voiture fait exactement **1/3 de la largeur de la chaussée** : trois voitures de front, la piste est marquée en trois voies.
- Course solo contre 0 à 7 bots, ou salles privées en ligne par code (jusqu'à 8 pilotes, bots en option), lien d'invitation `/?salle=CODE`.
- Serveur autoritaire 60 Hz ; voiture du joueur prédite localement, autres voitures interpolées ; reconnexion automatique (pilote auto pendant la coupure).
- Mobile : boutons tactiles ◀ ▶ / GAZ / FREIN / DRIFT, accélération automatique en option, plein écran paysage, installable sur l'écran d'accueil.

## Lancer

```bash
npm install
npm start          # compile le client et lance le serveur sur http://localhost:3000
```

Sur un téléphone du même réseau Wi-Fi : `http://<ip-du-PC>:3000`.

Développement (rechargement à chaud) : `npm run dev` puis http://localhost:5173.
Docker : `docker compose up -d --build`.

## Commandes

| | PC | Mobile | Manette |
|---|---|---|---|
| Gaz | ↑ ou Z (W en QWERTY) | GAZ | RT / A |
| Frein, marche arrière | ↓ ou S | FREIN | LT / B |
| Diriger | ← → ou Q D | ◀ ▶ | stick gauche |
| Drift (frein à main) | Espace | DRIFT | X / RB |
| Menu | Échap | II | |

## Organisation

- `src/shared` : simulation commune client/serveur — physique (`cars/physics.ts`), circuits (`track/`), course, tours et bots (`race/`).
- `src/server` : HTTP + WebSocket, salles par code.
- `src/client` : rendu Canvas basse résolution agrandi sans lissage, HUD, écrans, commandes.
- `tools/sprites/extract.py` : découpe la planche `voitures-sheet.png` en atlas (`pip install pillow numpy`).

Ajouter un circuit : une entrée dans `src/shared/track/tracks.ts` (boucle de points de contrôle). `npm test` vérifie que la piste ne se chevauche pas, que les virages sont assez larges et que 8 bots bouclent la course.
