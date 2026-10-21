# Rootline

> Tes plantes, de la racine à la notification.

**Rootline** suit tes plantes d'intérieur de la racine à la notification. Des capteurs plantés dans les pots mesurent l'humidité, l'engrais, la lumière et la température. Une petite passerelle ESP32 relaie les mesures, et l'app détecte toute seule quand une plante a été arrosée. Elle te prévient au bon moment, quand le sol est vraiment sec, et non selon un calendrier approximatif. Les plantes sans capteur ont droit à un rappel selon leur espèce et à un simple bouton « Arrosée ». Rootline s'installe sur l'écran d'accueil d'un téléphone, Android ou iPhone, sans store. Elle est gratuite, open source, et chacun l'héberge lui-même.

## État du projet

| Étape | Contenu | État |
| --- | --- | --- |
| 1 | Squelette : web app installable, connexion par e-mail, base de données | ✅ |
| 2 | Plantes : photo, identification Pl@ntNet, seuils Open Plantbook | ✅ |
| 3 | Rappels et notifications push | ✅ |
| 4 | Capteurs Flower Care + passerelle ESP32, détection automatique de l'arrosage | à venir |
| 5 | Plan de l'appartement, historique, courbes | ✅ |

## Pile technique

- **Front** : Vite, React, TypeScript, PWA (`vite-plugin-pwa`)
- **Back** : [Supabase](https://supabase.com) (PostgreSQL, authentification, stockage, fonctions)
- **Hébergement** : GitHub Pages
- **Matériel** : capteurs Flower Care (HHCCJCY01) et une carte ESP32 sous ESPHome

## Installer ta propre instance

### 1. Supabase

1. Crée un projet sur [supabase.com](https://supabase.com) (offre gratuite).
2. Dans **SQL Editor**, colle et exécute le contenu de [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql).
3. Dans **Authentication > URL Configuration** :
   - *Site URL* : l'adresse de ton app, par ex. `https://<ton-compte>.github.io/rootline/`
   - *Redirect URLs* : ajoute aussi `http://localhost:5173/**` pour le développement.
4. Exécute aussi les migrations suivantes du dossier `supabase/migrations/`, dans l'ordre.
5. Crée des comptes gratuits sur [Pl@ntNet](https://my.plantnet.org) et [Open Plantbook](https://open.plantbook.io), puis, dans **Edge Functions > Secrets**, ajoute `PLANTNET_API_KEY`, `OPENPLANTBOOK_CLIENT_ID` et `OPENPLANTBOOK_CLIENT_SECRET`.
6. Déploie les fonctions :
   - `npx supabase functions deploy identify-plant --project-ref <ton-projet>`
   - `npx supabase functions deploy notifications --no-verify-jwt --project-ref <ton-projet>` (elle vérifie elle-même l'utilisateur ou le secret de la tâche planifiée)

   La migration `0003_reminders.sql` contient `<ton-projet>` : remplace-le par l'identifiant de ton projet avant de l'exécuter. Les clés des notifications (VAPID) sont créées automatiquement au premier usage.
7. Dans **Authentication > Email Templates > Magic Link** (nécessite un SMTP personnalisé), ajoute le code à usage unique au message pour pouvoir te connecter directement dans l'app installée :

   ```html
   <p>Ton code de connexion : <strong>{{ .Token }}</strong></p>
   ```

### 2. En local

```bash
npm install
cp .env.example .env.local   # puis renseigne l'URL et la clé publishable de ton projet
npm run dev                  # http://localhost:5173
```

### 3. Mise en ligne (GitHub Pages)

1. Dans ton dépôt GitHub : **Settings > Pages > Source : GitHub Actions**.
2. Dans **Settings > Secrets and variables > Actions > Variables**, crée :
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
3. Pousse sur `main` : le workflow [`deploy.yml`](.github/workflows/deploy.yml) construit et publie l'app.
4. Sur ton téléphone, ouvre l'adresse dans Chrome (ou Safari) et choisis **Ajouter à l'écran d'accueil**.

## Engrais

Chaque fiche plante indique l'engrais à utiliser (plantes vertes, plantes fleuries, cactus, orchidées, terre acide…), la dose et le rythme pendant la belle saison. La catégorie est déduite du genre botanique donné par Pl@ntNet (règles générales de jardinage, dans [`fertilizer.ts`](supabase/functions/notifications/fertilizer.ts)) et se change à la main. Le récapitulatif quotidien rappelle aussi les plantes qui attendent leur engrais ; avec un capteur, c'est la conductivité du sol qui décide.

## Diagnostic de santé

Dans la fiche d'une plante, **Santé > Un souci ? Demander un diagnostic** : une photo et/ou une question. La fiche de la plante (espèce, emplacement, arrosages, engrais, mesures) est jointe automatiquement.

- **Analyser** : la fonction [`diagnose`](supabase/functions/diagnose/index.ts) demande d'abord à Pl@ntNet les maladies probables sur la photo, puis fait répondre un modèle qui lit les images, via [GitHub Models](https://docs.github.com/en/github-models) (gratuit, environ 150 demandes par jour). La réponse est gardée dans l'historique de la plante.
- **Demander à Claude** : envoie la photo et le même message à l'app Claude par la feuille de partage du téléphone (ou ouvre claude.ai avec la question pré-remplie).

Pour l'activer sur ta propre instance : sur GitHub, **Settings > Developer settings > Personal access tokens > Fine-grained tokens**, crée un jeton avec la seule permission **Models : lecture**. Ajoute-le dans Supabase, **Edge Functions > Secrets**, sous le nom `GITHUB_MODELS_TOKEN`, puis déploie la fonction :
`npx supabase functions deploy diagnose --project-ref <ton-projet>`

La fonction sait aussi utiliser Mistral (`MISTRAL_API_KEY`), dont l'API est désormais réservée aux offres payantes.

## Partager avec la maison

Dans **Réglages > Partage**, « Inviter quelqu'un » crée un lien valable 7 jours, utilisable une seule fois, à envoyer par message. La personne ouvre le lien, se connecte avec son e-mail et rejoint ton foyer : mêmes plantes, même plan, et chacun reçoit les rappels sur ses appareils. Le propriétaire du foyer peut retirer un membre ; un membre peut quitter le foyer.

Pour que le lien de connexion reçu par e-mail garde l'invitation, ajoute dans **Authentication > URL Configuration > Redirect URLs** l'adresse de ton app suivie de `**`, par ex. `https://<ton-compte>.github.io/rootline/**`.

## Le plan de l'appartement

L'onglet **Plan** affiche ton appartement avec une pastille par plante. Touche une pièce pour voir ses plantes et l'orientation de ses fenêtres ; en mode « Placer les plantes », fais glisser une pastille : sa pièce et l'orientation de la fenêtre la plus proche sont mises à jour toutes seules.

Le plan s'importe dans **Réglages > Plan de l'appartement**, sous forme d'un fichier JSON. Le plus simple : fais une capture de la carte de ton robot aspirateur, relève les coins de chaque pièce en pixels (n'importe quel éditeur d'image affiche la position du curseur), puis écris le fichier :

```json
{
  "width": 600,
  "height": 400,
  "north": 0,
  "rooms": [
    { "name": "Salon", "points": [[0, 0], [350, 0], [350, 400], [0, 400]] },
    { "name": "Cuisine", "points": [[350, 0], [600, 0], [600, 220], [350, 220]], "label": [475, 110] }
  ],
  "windows": [
    { "room": "Salon", "from": [0, 120], "to": [0, 260], "orientation": "O" },
    { "room": "Cuisine", "from": [420, 0], "to": [540, 0], "orientation": "N" }
  ]
}
```

- `width`, `height` : taille du dessin, dans l'unité de ton choix (ici, les pixels de la capture).
- `north` : direction du nord sur le dessin, en degrés dans le sens horaire depuis le haut (0 = le nord est en haut, 90 = à droite).
- `rooms` : une pièce = un nom et la liste de ses coins `[x, y]`, dans l'ordre du contour. `label` (facultatif) place le nom de la pièce.
- `windows` : une fenêtre = sa pièce, ses deux extrémités et l'orientation de sa façade (`N`, `NE`, `E`, `SE`, `S`, `SO`, `O` ou `NO`).

Les noms des pièces du plan remplacent la liste de pièces proposée à l'ajout d'une plante. Un plan plus large que haut est tourné d'un quart de tour pour remplir l'écran du téléphone.

## Offre gratuite de Supabase : éviter la mise en pause

Supabase met en pause un projet gratuit qui n'a pas d'activité pendant 7 jours (un e-mail prévient une semaine avant ; le projet se relance d'un clic dans le tableau de bord). Pendant la pause, plus de rappels. Deux choses gardent le projet éveillé :

- la fonction `notifications`, appelée toutes les heures par la base ;
- le workflow [`keepalive.yml`](.github/workflows/keepalive.yml), qui fait chaque jour une requête depuis GitHub avec la clé publique.

GitHub désactive les workflows planifiés d'un dépôt public après 60 jours sans commit (il prévient par e-mail) : dans ce cas, réactive-le dans l'onglet **Actions**.

L'offre gratuite ne comprend pas de sauvegarde automatique de la base : **Réglages > Exporter mes données** télécharge un fichier JSON avec tout le suivi (foyer et plan, plantes et photos, arrosages, engrais, notes, diagnostics, mesures). Garde-en une copie de temps en temps. **Restaurer une sauvegarde** ajoute ce qui manque (plantes supprimées avec leur photo et leur historique, diagnostics, mesures, plan si le foyer n'en a pas) sans rien écraser ; on peut réimporter le même fichier sans créer de doublons.

## Sécurité

- La clé *publishable* de Supabase est publique par conception : elle est visible dans le code de la page.
- Les données sont protégées par la connexion et les règles **RLS** : chaque utilisateur ne voit que son foyer.
- Les clés secrètes (Pl@ntNet, Open Plantbook, clé de service Supabase) ne vont **jamais** dans ce dépôt : elles sont stockées dans les secrets des fonctions Supabase.

## Licence

[MIT](LICENSE)
