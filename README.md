# Rootline

> Tes plantes, de la racine à la notification.

**Rootline** suit tes plantes d'intérieur de la racine à la notification. Des capteurs plantés dans les pots mesurent l'humidité, l'engrais, la lumière et la température. Une petite passerelle ESP32 relaie les mesures, et l'app détecte toute seule quand une plante a été arrosée. Elle te prévient au bon moment, quand le sol est vraiment sec, et non selon un calendrier approximatif. Les plantes sans capteur ont droit à un rappel selon leur espèce et à un simple bouton « Arrosée ». Rootline s'installe sur l'écran d'accueil d'un téléphone, Android ou iPhone, sans store. Elle est gratuite, open source, et chacun l'héberge lui-même.

## État du projet

| Étape | Contenu | État |
| --- | --- | --- |
| 1 | Squelette : web app installable, connexion par e-mail, base de données | ✅ |
| 2 | Plantes : photo, identification Pl@ntNet, seuils Open Plantbook | ✅ |
| 3 | Rappels et notifications push | à venir |
| 4 | Capteurs Flower Care + passerelle ESP32, détection automatique de l'arrosage | à venir |
| 5 | Plan de l'appartement, historique, courbes | à venir |

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
6. Déploie la fonction d'identification : `npx supabase functions deploy identify-plant --project-ref <ton-projet>`.
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

## Sécurité

- La clé *publishable* de Supabase est publique par conception : elle est visible dans le code de la page.
- Les données sont protégées par la connexion et les règles **RLS** : chaque utilisateur ne voit que son foyer.
- Les clés secrètes (Pl@ntNet, Open Plantbook, clé de service Supabase) ne vont **jamais** dans ce dépôt : elles sont stockées dans les secrets des fonctions Supabase.

## Licence

[MIT](LICENSE)
