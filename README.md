# Orbit — tableau de bord

Dashboard personnel pour regrouper des applications web et surveiller leur disponibilité HTTP.

## Démarrer

Prérequis : Node.js 18 ou plus récent.

```powershell
npm start
```

Ouvre ensuite [http://127.0.0.1:3000](http://127.0.0.1:3000). Les applications ajoutées et leur dernier statut sont enregistrés dans `data/apps.json`.

Ajoute l'URL publique de chaque application (par exemple une URL `*.vercel.app`). Orbit vérifie le chemin indiqué toutes les minutes et affiche le code HTTP et le temps de réponse. Une réponse HTTP 4xx/5xx est signalée comme une erreur, tandis qu'une absence de réponse est signalée hors ligne. Le tableau de bord vérifie l'accessibilité du site ; il ne lit pas les événements ou les déploiements de la console Vercel.

Le serveur écoute uniquement sur l'interface locale par défaut. Pour changer le port, définis la variable d'environnement `PORT`.

## Installer Orbit comme une PWA

Orbit est installable depuis son URL HTTPS (par exemple l'adresse privée Tailscale Serve) ou depuis `localhost`. Dans le navigateur du téléphone, ouvre le site puis choisis **Ajouter à l'écran d'accueil** / **Installer l'application**. Sur iPhone, utilise **Partager → Sur l'écran d'accueil** dans Safari.

Le service worker met en cache uniquement la coque de l'application et ses icônes. Les données, les ajouts, suppressions et contrôles de disponibilité nécessitent une connexion au serveur ; les réponses de l'API ne sont jamais mises en cache. En cas de redéploiement, ferme puis rouvre l'application installée si une ancienne version de l'interface reste affichée.

Le manifeste, la page, les scripts et les styles sont servis avec revalidation pour que les versions installées récupèrent les mises à jour. Pour publier la PWA sur le VPS, pousse ces fichiers, récupère-les dans `~/DashBoard`, puis redémarre le service avec `sudo systemctl restart orbit`.
