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
