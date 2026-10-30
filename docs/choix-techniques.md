# Choix techniques

## La mémoire est la contrainte

Une image RGBA de 9 000² pèse environ 309 Mio une fois décodée : l’app ne décode donc jamais un original entier, même dans un worker. `createImageBitmap(blob, crop…)` ne garantit nulle part que sa mémoire reste bornée. L’import fait défiler l’original dans une bande réutilisable de 512 lignes et écrit des tuiles de 512² dans une pyramide de facteur deux. Chaque tuile parente est construite à partir d’au plus quatre tuiles filles, décodées l’une après l’autre. La visionneuse ne lit que des tuiles.

- **JPEG :** une version WASM embarquée de libjpeg-turbo lit l’original via un accès synchrone OPFS dans le worker. Les coefficients des JPEG progressifs sont déversés dans des fichiers temporaires OPFS par `native/jmemopfs.c`, ce qui évite SharedArrayBuffer, l’isolation cross-origin et la suspension asynchrone. Le plafond du tas WASM ne borne que le décodeur, pas le processus : un import inachevé doit donc rester récupérable à partir de ses métadonnées.
- **PNG :** les données compressées sont données à `DecompressionStream` par morceaux de 4 Kio au plus, car [WebKit garde en mémoire toute la sortie décompressée de chaque morceau](https://docs.webkit.org/Deep%20Dive/Modules/CompressionStreams.html). Le PNG entrelacé et le WebP passent par un décodage natif, avec une taille plafonnée.
- **Les cartes JPEG sont décodées en tuiles PNG à tous les niveaux** (`DECODED`). Chaque niveau dézoomé est tiré du niveau PNG sans perte du dessous, si bien que les traits fins restent nets en dézoomant.
- **Les anciens formats de tuiles sont redécoupés en arrière-plan.** Les cartes découpées directement dans les blocs DCT du JPEG (l’ancien mode compact supprimé, `CUT`, et les plus anciens `CHAINED_JPEG_PARENTS` et `PNG_PARENTS`) sont redécodées en tuiles PNG par `src/processing/retile.ts`, une carte à la fois, sous le verrou de stockage. Il saute la carte ouverte et celle dont le texte est en cours de lecture, et s’arrête au moindre changement dans la bibliothèque. OPFS remplace chaque tuile d’un bloc : une carte interrompue à mi-chemin reste valide et sera redécoupée au lancement suivant. Une carte qui échoue est marquée `UNCUT` et laissée telle quelle. Le décodeur contient encore les fonctions `cropper_*` inutilisées de `native/jpeg.c`, jusqu’à sa prochaine recompilation.
- **La largeur de bande** limite les images à 32 768 px de côté. Des images plus larges demanderaient une autre organisation des bandes.
- **La détection d’OPFS** vérifie qu’une écriture fonctionne vraiment, pas seulement que l’API existe. Sans OPFS, les gros JPEG progressifs sont refusés.
- Les pixels deviennent du RGBA8 d’affichage. Les profils ICC, le gamma PNG et les profondeurs supérieures à 8 bits ne sont pas gérés.

## Affichage

- Le mode sombre est appliqué une seule fois aux pixels de chaque tuile, à son décodage, dans un worker. Un filtre CSS sur le canvas recolore tout l’écran à chaque image, et cela vidait sensiblement les batteries sous terre. La luminosité est un remplissage translucide dessiné sur des images qui sont de toute façon rendues.
- Les tuiles décodées se partagent un budget de 56 Mio, ou 24 Mio sur les appareils qui annoncent moins de 4 Go ; Safari n’annonce rien et reçoit le plus grand. Une vue utilise au plus 44 tuiles (22) : un téléphone 3× affiche donc les tuiles à au plus environ 1,5× leurs pixels. Le reste du budget garde les parentes des tuiles manquantes, qui se chargent en premier pour que l’écran se remplisse d’abord à demi-netteté. Pendant le chargement d’un niveau, toutes les tuiles en cache sont dessinées, des plus grossières aux plus nettes, si bien qu’en dézoomant les tuiles plus nettes restent à l’écran. Un niveau plus net attend que l’échelle soit stable depuis 150 ms, pour qu’un pincement ne décode pas de tuiles pour des échelles déjà dépassées.
- Les annotations SVG forment un calque séparé, sans filtre. Elles utilisent la caméra du canvas mais gardent une taille constante à l’écran.
- La visionneuse ne gère que la rotation de la carte. Elle ne verrouille jamais l’orientation de l’écran ; c’est le réglage du téléphone qui s’en charge.
- En mode boussole, la carte ne tourne qu’une fois un nouveau cap tenu un moment, pour qu’un téléphone qui bouge ne la redessine pas sans cesse.

## Persistance et intégrité

- Un import n’est marqué `ready` qu’une fois toutes ses tuiles écrites. Une suppression écrit d’abord une marque `deleting`. Au démarrage, les enregistrements abandonnés sont nettoyés sous un Web Lock commun à toute l’origine, pour qu’une fenêtre ne puisse pas supprimer l’import en cours d’une autre.
- Les écritures d’annotations et d’OCR vérifient les métadonnées de la carte prête dans la même transaction. Cela empêche une écriture tardive de faire revenir une carte supprimée.
- La caméra n’est enregistrée qu’après 2 s d’immobilité, pour qu’une carte en mouvement ou tournée par la boussole ne soit pas écrite plusieurs fois par seconde.
- Le service worker récupère toute l’app avant d’en écrire le moindre fichier : une app incomplète ne s’active jamais. Les données des cartes ne viennent jamais du réseau.
- Une mise à jour copie chaque fichier qu’une version précédente possède déjà, mais seulement si ses octets correspondent au SHA-256 du nouveau build ; sinon elle le télécharge. Les modèles OCR et leur moteur font 27 des 28 Mo de l’app et changent rarement.
- Une page ouverte avant une mise à jour continue de tourner sous le nouveau worker. La version précédente garde les fichiers hachés de `/assets/` que la nouvelle a renommés, pour que cette page puisse encore lancer ses workers hors ligne. Ces fichiers disparaissent à la mise à jour suivante.

## OCR

- Les modèles PaddleOCR tournent dans le backend WASM mono-thread d’ONNX Runtime Web, sans WebGPU ni SharedArrayBuffer. Le parallélisme vient d’au plus trois workers : moins sur les appareils à faible mémoire, et deux quand l’appareil cache sa mémoire (Safari) ; chacun monte à environ 330 Mo. Une lecture lancée à l’ouverture d’une carte attend quelques secondes pour laisser les premières tuiles se charger. Seuls les workers chargent ONNX Runtime ; la page elle-même jamais.
- La détection travaille à la résolution propre de la carte, par sections qui se chevauchent, car réduire la carte d’abord fait perdre les petits caractères. Chaque inscription appartient à la seule section dont le milieu contient son centre : elle n’est lue qu’une fois.
- Le reconnaisseur lit une ligne à la fois. Traiter les lignes par lots coûte autant par pixel et complète chaque ligne jusqu’à la largeur de la plus longue.
- L’ajustement des boîtes est écrit à la main pour éviter de dépendre d’OpenCV.
- Les résultats ne dépendent pas du minutage : la sortie des workers est fusionnée dans l’ordre de la carte.
- Un index porte une version. Les cartes lues par une ancienne version de la détection sont relues à leur ouverture.

## Format de partage (`.megamap`)

- Le conteneur est binaire (`MEGAMAP1`, taille du manifeste, manifeste JSON, puis les données brutes) pour que les images et photos déjà compressées ne soient jamais encodées en base64 ni recompressées.
- Toutes les anciennes versions doivent rester lisibles. Les anciennes apps refusent les versions plus récentes et demandent une mise à jour.
- Une carte correspond à un fichier partagé uniquement par le SHA-256 des octets de l’image d’origine et ses dimensions. Le nom du fichier ne compte pas, et une image réencodée ne correspond pas.
- Fusionner ne fait jamais revenir des éléments importés puis supprimés sur l’appareil, ni des entrées d’historique listées dans `deletedLog`. Remplacer incrémente une révision locale des annotations, pour que d’anciens enregistrements ne puissent pas restaurer les éléments retirés.
- Les lieux, itinéraires et entrées d’historique portent un `by` facultatif. L’envoi remplit le pseudo des Réglages là où il manque : ce qui vient des autres garde son auteur. Sans `by`, l’élément a été créé sur cet appareil. Une modification n’est jamais fusionnée dans l’entrée d’une autre personne. Les anciennes apps ignorent `by` sans changement de version.
- Les parcours, l’échelle de la carte, les réglages d’affichage et la caméra restent sur l’appareil et ne sont pas partagés.
