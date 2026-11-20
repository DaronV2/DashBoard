# Orbit — tableau de bord

Dashboard personnel pour regrouper des applications web et surveiller leur disponibilité HTTP.

## Démarrer

Prérequis : Node.js 18 ou plus récent.

```powershell
npm start
```

Ouvre ensuite [http://127.0.0.1:3000](http://127.0.0.1:3000). Les applications ajoutées et leur dernier statut sont enregistrés dans `data/apps.json`.

Ajoute l'URL publique de chaque application (par exemple une URL `*.vercel.app`). Orbit récupère sa favicon depuis `/favicon.ico` et l'enregistre localement avec les données de l'application ; si aucune favicon compatible n'est disponible, le tableau de bord affiche une initiale. Orbit vérifie le chemin indiqué toutes les minutes et affiche le code HTTP et le temps de réponse. Une réponse HTTP 4xx/5xx est signalée comme une erreur, tandis qu'une absence de réponse est signalée hors ligne. Pour lire aussi le dernier statut de déploiement Vercel, configure un jeton API sur le serveur puis ajoute l'identifiant ou le nom du projet dans la fiche de l'application.

### Activer le suivi Vercel

Crée un jeton personnel Vercel avec le minimum de droits nécessaires pour lire les projets et déploiements concernés. Ne le colle jamais dans l'interface web, le dépôt Git, ni ce fichier.

En local, ajoute-le dans le fichier `.env` à la racine du projet :

```env
VERCEL_TOKEN=ton_token_vercel
VERCEL_TEAM_ID=team_id_optionnel
```

Le fichier `.env` est ignoré par Git. Redémarre Orbit après l'avoir modifié. Sur Linux/systemd, crée plutôt un fichier accessible uniquement à root :

```bash
sudo install -d -m 700 /etc/orbit
sudo install -m 600 /dev/null /etc/orbit/orbit.env
sudoedit /etc/orbit/orbit.env
```

Dans l'éditeur, ajoute `VERCEL_TOKEN=...` avec ton jeton puis enregistre le fichier. Ne partage pas son contenu. Ajoute cette directive dans la section `[Service]` de `/etc/systemd/system/orbit.service` :

```ini
EnvironmentFile=-/etc/orbit/orbit.env
```

Puis recharge le service :

```bash
sudo systemctl daemon-reload
sudo systemctl restart orbit
```

Si le projet est dans une équipe Vercel et que le jeton ne sélectionne pas déjà cette équipe, ajoute également `VERCEL_TEAM_ID=team_...` dans le fichier d'environnement. Dans Orbit, ajoute ou modifie une application puis renseigne son ID ou son nom de projet Vercel. Orbit interroge `GET /v7/deployments` avec `target=production` et affiche son dernier état de déploiement. Le contrôle HTTP reste indépendant et mesure l'accessibilité du site.

Le serveur écoute uniquement sur l'interface locale par défaut. Pour changer le port, définis la variable d'environnement `PORT`.

## Installer Orbit comme une PWA

Orbit est installable depuis son URL HTTPS (par exemple l'adresse privée Tailscale Serve) ou depuis `localhost`. Dans le navigateur du téléphone, ouvre le site puis choisis **Ajouter à l'écran d'accueil** / **Installer l'application**. Sur iPhone, utilise **Partager → Sur l'écran d'accueil** dans Safari.

Le service worker met en cache uniquement la coque de l'application et ses icônes. Les données, les ajouts, suppressions et contrôles de disponibilité nécessitent une connexion au serveur ; les réponses de l'API ne sont jamais mises en cache. En cas de redéploiement, ferme puis rouvre l'application installée si une ancienne version de l'interface reste affichée.

Le manifeste, la page, les scripts et les styles sont servis avec revalidation pour que les versions installées récupèrent les mises à jour. Pour publier la PWA sur le VPS, pousse ces fichiers, récupère-les dans `~/DashBoard`, puis redémarre le service avec `sudo systemctl restart orbit`.
