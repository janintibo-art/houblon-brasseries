# 🍺 Houblon — Carte des micro-brasseries

Une application Android qui affiche une **carte mondiale**, vous **géolocalise par GPS**
et **répertorie les micro-brasseries autour de vous**, avec une liste et une fiche
détaillée pour chacune.

L'APK se construit **automatiquement sur GitHub** (via GitHub Actions) : vous n'avez
aucun outil Android à installer sur votre téléphone. Termux sert uniquement à envoyer
le code sur GitHub.

---

## Comment ça marche ?

- **Interface** : une page web (HTML / CSS / JavaScript) placée dans le dossier `www/`.
- **Emballage en APK** : [Capacitor](https://capacitorjs.com) transforme cette page web
  en application Android native.
- **Carte** : [Leaflet](https://leafletjs.com) + fonds de carte OpenStreetMap.
- **GPS** : le plugin `@capacitor/geolocation` (gère les autorisations Android).
- **Données des brasseries** : l'[API Overpass](https://overpass-turbo.eu) d'OpenStreetMap,
  gratuite et sans clé. On récupère tout ce qui est étiqueté comme brasserie
  (`craft=brewery`, `microbrewery=yes`, `industrial=brewery`) autour de votre position.

---

## Arborescence du projet

```
houblon-brasseries/
├── .github/
│   └── workflows/
│       └── build.yml          ← recette qui construit l'APK sur GitHub
├── www/                       ← l'application web
│   ├── index.html
│   ├── css/
│   │   └── style.css
│   └── js/
│       └── app.js
├── capacitor.config.json      ← nom de l'app, identifiant, dossier web
├── package.json               ← dépendances (Capacitor)
├── .gitignore
└── README.md
```

> Les dossiers `android/` et `node_modules/` **ne sont pas inclus** : ils sont
> régénérés automatiquement à chaque construction. C'est normal.

---

## Étape 1 — Envoyer le code sur GitHub avec Termux

Ouvrez **Termux** et lancez ces commandes une par une :

```bash
# Mettre à jour Termux et installer git + l'outil GitHub
pkg update && pkg upgrade -y
pkg install git gh -y

# Se connecter à votre compte GitHub (suivez les instructions à l'écran)
gh auth login
```

Placez ensuite le dossier du projet dans Termux (par exemple dans `~/houblon-brasseries`),
puis :

```bash
cd houblon-brasseries

git init
git add .
git commit -m "Première version de Houblon"
git branch -M main

# Crée le dépôt sur GitHub ET envoie le code d'un coup
gh repo create houblon-brasseries --public --source=. --remote=origin --push
```

Dès que le code arrive sur GitHub, la construction de l'APK **démarre toute seule**.

---

## Étape 2 — Récupérer l'APK

1. Sur GitHub, ouvrez votre dépôt puis l'onglet **Actions**.
2. Attendez que le travail « Construire l'APK » se termine (pastille verte ✓, ~3–6 min).
3. Deux façons de télécharger le résultat :
   - **Le plus simple sur téléphone** : onglet **Releases** (à droite de la page du dépôt) →
     dernière version → téléchargez le fichier **`houblon.apk`**.
   - **Sinon** : dans **Actions**, ouvrez la construction terminée et téléchargez
     l'artefact **`houblon-apk`** (il arrive en `.zip`, à décompresser).

---

## Étape 3 — Installer l'APK sur Android

1. Ouvrez le fichier `houblon.apk` téléchargé.
2. Android demandera d'**autoriser l'installation depuis cette source** : acceptez.
3. Installez, puis ouvrez l'application.
4. Au premier lancement, **autorisez l'accès à la position** quand on vous le demande.
5. Appuyez sur le bouton rond ◎ en bas à droite : la carte se centre sur vous et
   la liste des brasseries apparaît.

> ℹ️ C'est un APK de **test** (non signé pour le Play Store). Android peut afficher un
> avertissement : c'est attendu pour une installation manuelle, l'app fonctionne normalement.

---

## Tester sans téléphone (optionnel)

Vous pouvez ouvrir `www/index.html` dans un navigateur d'ordinateur pour vérifier
l'interface. Le navigateur demandera lui aussi l'autorisation de géolocalisation.
Tout fonctionne à l'identique, sauf l'emballage natif.

---

## Personnaliser

| Ce que vous voulez changer | Où |
|---|---|
| Le nom de l'application | `capacitor.config.json` → champ `appName` |
| Les rayons de recherche (2 / 5 / 10 / 25 km) | `www/index.html` → boutons `.chip` |
| Le rayon par défaut | `www/js/app.js` → `radius: 5000` |
| Le style de la carte | `www/js/app.js` → l'URL dans `L.tileLayer(...)` |
| Les couleurs / le design | `www/css/style.css` (bloc `:root` en haut) |

> Si vous changez l'**identifiant** `appId` (`com.houblon.brasseries`), supprimez d'abord
> le dossier `android/` sur GitHub pour qu'il soit régénéré proprement.

---

## En cas de souci

- **La construction échoue à l'étape « Releases » (erreur 403)** : sur GitHub, allez dans
  **Settings → Actions → General → Workflow permissions**, choisissez
  **« Read and write permissions »**, enregistrez, puis relancez la construction.
  (L'artefact reste téléchargeable même sans cette étape.)
- **« Aucune brasserie » alors qu'il y en a** : augmentez le rayon, ou vérifiez que
  la zone est renseignée sur OpenStreetMap — les données sont contributives.
- **La carte reste grise** : il faut une connexion Internet (pour les fonds de carte
  et les données).
- **Rien ne se passe au clic sur ◎** : vérifiez que la localisation est activée sur le
  téléphone et autorisée pour l'application.

---

## Contribuer aux données

Ce projet s'appuie sur OpenStreetMap. Si une brasserie manque ou si ses informations
sont incomplètes, vous pouvez les ajouter sur [openstreetmap.org](https://www.openstreetmap.org) :
elles apparaîtront ensuite dans l'application (et pour tout le monde).

---

*Licence : MIT.*
