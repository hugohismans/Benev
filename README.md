# Benev

Un site simple qui répertorie les lieux de bénévolat dans le Hainaut et alentours (Brabant wallon, province de Namur, bordure flamande et française), pensé pour les personnes qui sortent d'une hospitalisation en psychiatrie.

La personne indique sa commune, son code postal ou son adresse (ou se localise), et le site lui montre les lieux les plus proches, en liste ou sur une carte.

- **Site 100 % statique** : pas de base de données, pas d'inscription, pas de serveur à gérer.
- **Hébergement gratuit** sur GitHub Pages.
- **Administration gratuite** avec [Pages CMS](https://pagescms.org) : des formulaires pour ajouter ou modifier les lieux, sans toucher au code.
- **Vie privée** : l'adresse tapée par le visiteur n'est jamais enregistrée. Elle est seulement transformée en coordonnées GPS par [OpenStreetMap (Nominatim)](https://nominatim.org) pour calculer les distances, directement dans le navigateur.

---

## Guide du webmaster

### 1. Mettre le site en ligne (une seule fois)

1. Sur GitHub, ouvrez le dépôt, puis **Settings → Pages**.
2. Dans *Build and deployment*, choisissez **Source : Deploy from a branch**, puis la branche **main** et le dossier **/ (root)**. Cliquez sur **Save**.
3. Après une ou deux minutes, le site est en ligne à l'adresse indiquée en haut de cette page (du type `https://votre-compte.github.io/Benev/`).

Un nom de domaine personnalisé (ex. `benev.be`) peut être ajouté plus tard dans la même page, dans *Custom domain*.

### 2. Se connecter à l'administration

1. Allez sur **https://app.pagescms.org**.
2. Connectez-vous avec votre compte GitHub et autorisez l'accès au dépôt **Benev**.
3. Choisissez le dépôt puis la branche **main**. Le menu **Lieux de bénévolat** apparaît.

Chaque modification enregistrée est publiée automatiquement sur le site en une à deux minutes.

### 3. Ajouter un lieu

Cliquez sur **Lieux de bénévolat → Add an entry** et remplissez le formulaire. Seuls le nom, la description, l'adresse, la commune et les coordonnées GPS sont obligatoires.

**Pour trouver les coordonnées GPS :**

1. Ouvrez [Google Maps](https://maps.google.com) et cherchez l'adresse du lieu.
2. Faites un **clic droit** sur le lieu (ou un appui long sur téléphone).
3. Cliquez sur les chiffres qui apparaissent en haut du menu (ex. `50.4542, 3.9523`) : ils sont copiés.
4. Collez-les dans le champ **Coordonnées GPS**.

**Conseils d'écriture** (les visiteurs peuvent être fragiles ou anxieux) :

- Des phrases courtes et concrètes : « Vous aiderez à… », plutôt qu'un jargon associatif.
- Cochez **« Possible de commencer en douceur »** seulement si c'est vrai : c'est souvent ce qui décide la personne.
- Indiquez un prénom dans **« Personne de référence »** : savoir qui demander rassure beaucoup.
- Décrivez l'accès en bus ou en train, car beaucoup de visiteurs n'ont pas de voiture.

### 4. Modifier, cacher ou supprimer un lieu

- **Modifier** : cliquez sur le lieu dans la liste, changez ce qu'il faut, puis **Save**.
- **Cacher temporairement** (ex. pendant les vacances) : décochez **« Afficher ce lieu sur le site »**.
- **Supprimer** : ouvrez le lieu, puis utilisez le bouton de suppression.

### 5. La base de départ : à vérifier petit à petit

Les lieux fournis au départ ont été **collectés automatiquement sur internet** en septembre 2026, dans le Hainaut et les régions voisines : Croix-Rouge, Restos du Cœur, banques alimentaires, Oxfam, Repair Cafés, refuges, hôpitaux, Lire et Écrire, etc. Pour chaque lieu :

- le champ **Source** indique la page où l'information a été trouvée ;
- le champ **Notes** indique ce qui reste à vérifier (adresse incertaine, horaires, etc.) ;
- les lieux dont on n'a **pas pu confirmer qu'ils accueillent des bénévoles** (ou qui affichaient « équipe complète ») sont **cachés** : leur note commence par « À VÉRIFIER ». Après un coup de fil, cochez « Afficher ce lieu sur le site » ou supprimez le lieu.

Les coordonnées GPS ont été calculées automatiquement. Quand la note dit « coordonnées approximatives », corrigez-les avec Google Maps.

Pour les lieux en Flandre, le champ **Langue parlée sur place** indique si les francophones sont bienvenus (à confirmer par téléphone). Les lieux en France portent la mention « (France) » dans la commune.

Aucune fiche ne contient encore d'info sur l'**accueil des personnes fragilisées**, le **début en douceur** ou l'**accessibilité PMR** : ces infos ne se trouvent pas sur internet. Ce sont les plus précieuses pour les visiteurs, n'hésitez pas à les demander quand vous appelez un lieu.

### 6. Ajouter un type d'activité

Les types d'activité (Animaux, Nature et jardinage…) sont listés dans le fichier `.pages.yml`, sous `categories`. Pour en ajouter un, modifiez ce fichier directement sur GitHub (icône crayon) et ajoutez une ligne au même format, par exemple `- Bricolage`.

Pour lui donner une icône, ajoutez-la aussi en haut du fichier `assets/app.js`, dans la liste `ICONES`. Sans icône, 🤝 s'affiche par défaut.

---

## Pour les développeurs

| Fichier | Rôle |
| --- | --- |
| `_data/lieux/*.json` | Un fichier par lieu (modifié par Pages CMS) |
| `lieux.json` | Regroupe tous les lieux (généré par Jekyll lors de la publication sur GitHub Pages) |
| `index.html`, `assets/` | La page, le style et le JavaScript (sans framework, carte avec Leaflet) |
| `.pages.yml` | Formulaire de l'administration Pages CMS |

Importer des lieux en masse (les coordonnées GPS sont calculées automatiquement, les doublons d'adresse ignorés, et un lieu avec `"benevolat_confirme": false` est importé caché) :

```sh
python3 scripts/importer.py mes-lieux.json
```

Tester en local (Ruby requis) :

```sh
gem install jekyll
jekyll serve
# puis ouvrir http://localhost:4000
```
