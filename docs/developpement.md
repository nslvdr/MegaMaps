# Développement

## Installation

Il faut Node 20.19+ ou 22.12+ (le minimum de Vite 7).

```sh
npm install
npm run dev
```

Le serveur de dev tourne sur http://localhost:5173 et écoute aussi sur votre réseau. Il n’a pas de service worker, n’envoie pas de statistiques et saute la page d’installation : l’app s’ouvre directement dans un onglet du navigateur.

## Commandes

| Commande | Rôle |
| --- | --- |
| `npm run dev` | Serveur de dev avec rechargement à chaud |
| `npm test` | Tous les tests, dans Node |
| `npm run build` | Vérifie les types, construit `dist/` et écrit le service worker |
| `npm run preview` | Sert `dist/` sur http://localhost:4173, avec le fonctionnement hors ligne |
| `npm run build:dev` | Construit le site de dev : « Mega Maps Dev », icônes orange, sans statistiques |
| `npm run deploy` | Construit et déploie l’app publiée avec Wrangler (lancez `npx wrangler login` une fois) |
| `npm run icons` | Régénère les icônes PNG après une modification de `public/icons/icon.svg` ou `assets/dev-icons/icon.svg` |

## Tests

Les tests utilisent le lanceur de tests intégré à Node, via `tsx`. `tests/setup.ts` fournit un DOM (linkedom), un canvas (`@napi-rs/canvas`) et IndexedDB (`fake-indexeddb`), et `tests/node-platform.ts` remplace les workers et d’autres API du navigateur.

```sh
npm test                                                         # tout
npx tsx --import ./tests/setup.ts --test tests/sharing.test.ts   # un seul fichier
```

Ces tests ne peuvent pas mesurer les limites mémoire de Safari, l’usage du GPU, la fluidité, l’installation ni le comportement tactile. Vérifiez-les sur un vrai téléphone.

## Vos cartes en développement

Le stockage du navigateur appartient à une origine : chaque port ou worktree démarre donc avec une bibliothèque vide. Pour éviter d’importer sans cesse les mêmes cartes, le serveur de dev restaure les fichiers `.megabackup` de `~/.megamaps-dev/` (ou du dossier indiqué par `MEGAMAPS_DEV_DATA`) qui manquent à l’origine actuelle. Enregistrez une sauvegarde depuis les Réglages et placez-la dans ce dossier.

## Tester sur un téléphone

Un téléphone qui ouvre l’adresse locale de votre ordinateur en simple `http://` n’a pas de contexte sécurisé : les service workers et OPFS n’y sont pas disponibles. Pour les tester, servez le build de production en HTTPS avec un certificat auquel le téléphone fait confiance (par exemple créé avec [mkcert](https://github.com/FiloSottile/mkcert)) :

```sh
npm run build
MAP_VIEWER_HTTPS_CERT=cert.pem MAP_VIEWER_HTTPS_KEY=key.pem npm run preview
```

Ne committez jamais de certificats ni de clés. `.gitignore` exclut déjà les fichiers `*.pem`, `*.key` et `.env`.

## Déploiement

L’app est un ensemble de fichiers statiques servis par un Worker Cloudflare (`wrangler.jsonc`). Elle a besoin de sa propre origine et ne peut pas tourner dans un sous-dossier.

| Branche | Site | Build |
| --- | --- | --- |
| `main` | [app.mega-maps.fr](https://app.mega-maps.fr), l’app publiée | `npm run build` |
| `dev` | [dev.mega-maps.fr](https://dev.mega-maps.fr), Worker `mega-maps-dev` | `npm run build:dev`, puis `npx wrangler deploy --env dev` |

Cloudflare construit chaque branche à chaque push. Le site de dev est une origine distincte : il s’installe comme une app séparée, avec ses propres cartes, et un build cassé n’y touche pas l’app publiée.

Le travail se fait sur des branches fusionnées dans `dev`. `dev` est fusionnée dans `main` pour publier.

## Fichiers générés et embarqués

- **Décodeur JPEG** (`public/codecs/jpeg.js`, `jpeg.wasm`). `scripts/build-codec.sh` le construit depuis `native/` avec Emscripten 4.0.16 et CMake, en figeant libjpeg-turbo 3.1.2. Committez le résultat : l’app ne le construit jamais à l’installation.
- **Modèles OCR** (`assets/ocr/`). Ce sont des exports PaddleOCR figés, dont `assets/ocr/README.md` donne la provenance. Chaque build vérifie leurs empreintes SHA-256 et les copie, avec les fichiers WASM d’ONNX Runtime, dans `public/ocr/`, qui est ignoré par git. Quand un modèle change, mettez à jour son empreinte dans `scripts/ocr-assets.ts`.

## Navigateurs visés

Safari sur iOS 17 ou plus récent, et Chrome à jour sur Android. L’app évite SharedArrayBuffer et l’isolation cross-origin, et ne charge rien depuis un CDN à l’exécution.

## Contribuer

Lisez d’abord [Fonctionnement](fonctionnement.md) et [Choix techniques](choix-techniques.md). Gardez les nouvelles interfaces pensées pour le tactile, utilisez les icônes Lucide, et ajoutez la traduction française de chaque nouvelle phrase dans `src/locales/fr.ts` : le build échoue s’il en manque une. Écrivez des tests ciblés pour les comportements qui comptent.

Les agents de code suivent les règles de [`AGENTS.md`](../AGENTS.md), tenues à part de cette documentation.
