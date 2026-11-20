# Suivi des déploiements Vercel dans Orbit

Orbit peut afficher deux états indépendants pour une application :

- **Disponibilité HTTP** : Orbit vérifie l'URL configurée et affiche son code HTTP et son temps de réponse.
- **Déploiement Vercel** : si un projet Vercel est configuré, Orbit interroge l'API Vercel pour afficher l'état de son déploiement de production le plus récent.

Le suivi Vercel est facultatif. Une application sans identifiant de projet conserve son fonctionnement actuel.

## Configuration du serveur

Il faut un jeton API Vercel autorisé à lire le projet et ses déploiements. Ne place jamais ce jeton dans le dépôt Git, dans le navigateur ou dans le formulaire d'Orbit.

Sur le VPS Linux, crée un fichier d'environnement lisible uniquement par `root` :

```bash
sudo install -d -m 700 /etc/orbit
sudo touch /etc/orbit/orbit.env
sudo chmod 600 /etc/orbit/orbit.env
sudoedit /etc/orbit/orbit.env
```

Dans l'éditeur, ajoute :

```ini
VERCEL_TOKEN=ton_jeton_vercel
```

Si le projet est dans une équipe Vercel et que le jeton ne sélectionne pas déjà cette équipe, ajoute également son identifiant :

```ini
VERCEL_TEAM_ID=team_identifiant
```

Dans `/etc/systemd/system/orbit.service`, ajoute la directive suivante à la section `[Service]` :

```ini
EnvironmentFile=-/etc/orbit/orbit.env
```

Recharge systemd et redémarre Orbit :

```bash
sudo systemctl daemon-reload
sudo systemctl restart orbit
sudo systemctl status orbit --no-pager
```

## Associer un projet

Dans Orbit, ouvre le menu **···** de l'application et choisis **Configurer Vercel**. Saisis l'identifiant du projet, ou son nom si l'API Vercel le reconnaît, puis enregistre.

Le formulaire ne demande et ne reçoit jamais le jeton API. Celui-ci est utilisé uniquement par le serveur Orbit.

## Fonctionnement et états

Orbit appelle `GET https://api.vercel.com/v7/deployments`, filtre sur le projet et la cible `production`, et consulte le déploiement le plus récent. La réponse de l'API n'est pas envoyée telle quelle au navigateur : Orbit ne conserve que l'état, la date de création et les liens Vercel validés.

Les états de déploiement présentés sont :

| État Vercel | Libellé Orbit |
|---|---|
| `READY` | Production prête |
| `BUILDING` | Build en cours |
| `INITIALIZING` | Initialisation |
| `QUEUED` | En attente de build |
| `ERROR` | Échec du déploiement |
| `CANCELED` | Déploiement annulé |
| `BLOCKED` | Déploiement bloqué |
| Aucun résultat | Aucun déploiement de production trouvé |

Si l'API échoue, Orbit affiche une information telle qu'un jeton invalide, un accès refusé ou une limite de requêtes. Le statut HTTP du site reste affiché séparément : un déploiement peut être prêt alors que son URL ne répond pas, et inversement.

## Fichiers concernés

- `server.js` : appel à l'API Vercel, gestion des identifiants de projet et lecture des variables d'environnement.
- `public/index.html` : champ d'identifiant du projet dans le formulaire.
- `public/app.js` et `public/styles.css` : configuration depuis une fiche et affichage de l'état.
- `README.md` : démarrage et configuration générale d'Orbit.
