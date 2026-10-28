# Le Bon Plat — MVP Web (Gestion des commandes & livraisons)

Application **web** de gestion des commandes et livraisons pour un restaurant.
Ce dépôt correspond au **MVP (Phase 1)** du cahier des charges, en **version web
uniquement**, avec **tous les acteurs** connectables et une **interface dédiée par rôle**.

> Le cahier des charges recommande à terme Flutter + Firebase (mobile). Pour livrer un
> MVP web démontrable immédiatement — sans dépendance à un projet cloud externe — la
> stack retenue est **Node.js + Express + SQLite + WebSocket**. L'architecture reste
> migrable vers Firebase/cloud en Phase 2 (le temps réel et l'auth sont déjà isolés).

## Acteurs & interfaces

| Acteur | Connexion | Interface |
|---|---|---|
| **Client** | Nom + téléphone (simplifié, conforme MVP) | Accueil, menu dynamique par catégories, fiches produits, panier + commentaire, formulaire de commande, choix du mode de paiement (Cash / Mobile Money affiché), **suivi de commande en temps réel** |
| **Gestionnaire de commandes / Call center** | Identifiant + mot de passe | Réception des commandes en **temps réel** (notification), détail, boutons **Accepter / Annuler**, compteurs par statut |
| **Gérant** | Identifiant + mot de passe | Liste des commandes + **mise à jour du statut** (en attente → préparation → livraison → livrée), tableau de bord (compteurs, recettes livrées, produits les plus commandés) |
| **Administrateur** | Identifiant + mot de passe | Accès complet : commandes, tableau de bord **et** gestion du catalogue |
| **Développeur** | Identifiant + mot de passe | **Gestion du catalogue produits** (catégories + produits : ajout / modification / suppression / disponibilité) |

## Périmètre couvert (MVP du cahier des charges)

Côté client : page d'accueil, authentification simplifiée, menu dynamique chargé depuis
la base, fiches produits, panier, formulaire de commande, suivi de commande temps réel,
affichage du mode de paiement (Cash / Mobile Money — enregistré en « paiement à la
livraison », **sans** transaction automatisée, comme prévu pour le MVP).

Côté back-office : liste des commandes, mise à jour du statut.

Côté call center : notification de nouvelle commande (push temps réel via WebSocket),
consultation et validation (Accepter / Annuler), suivi temps réel partagé entre tous les rôles.

Côté développeur : mise à jour du catalogue produits.

> Les fonctionnalités marquées « Phase 2 » dans le cahier des charges (paiement Mobile
> Money réel, billetterie/réservation, offres spéciales, avis, publication sur les stores…)
> ne sont volontairement pas incluses dans ce MVP.

## Démarrage

```bash
npm install      # installe les dépendances
npm start        # démarre le serveur (port 3000 par défaut)
```

Puis ouvrir :

- **Espace client** : http://localhost:3000/
- **Espace staff** : http://localhost:3000/staff.html

La base SQLite (`data/restaurant.db`) et les données de démonstration (menu + comptes)
sont créées automatiquement au premier démarrage.

## Comptes de démonstration (staff)

| Rôle | Identifiant | Mot de passe |
|---|---|---|
| Administrateur | `admin` | `admin123` |
| Gérant | `gerant` | `gerant123` |
| Call center | `callcenter` | `call123` |
| Développeur | `dev` | `dev123` |

Le **client** se connecte simplement avec un nom et un numéro de téléphone.

## Architecture

```
server/
  index.js          Serveur Express + service statique + init WebSocket
  db.js             Connexion SQLite + schéma (+ migrations douces des bases existantes)
  settings.js       Paramètres du restaurant (identité, accueil, règles de retrait)
  seed.js           Données de démonstration (comptes staff + menu) — idempotent
  auth.js           JWT, rôles et middlewares d'autorisation
  realtime.js       Hub WebSocket (diffusion des événements de commande)
  routes/
    auth.js         Connexion client (nom+tél) et staff (login+mdp)
    menu.js         Menu public (catégories + produits disponibles)
    orders.js       Commandes : création, statuts, modification par le call center, statistiques
    products.js     Gestion du catalogue (développeur / admin)
    settings.js     Lecture publique / mise à jour (admin, développeur) de la personnalisation
public/
  index.html        Application client
  staff.html        Application staff (login + tableaux de bord par rôle)
  js/common.js      Auth (localStorage), appels API, WebSocket, toasts
  js/client.js      Logique de l'interface client
  js/staff.js       Logique des interfaces staff
  css/styles.css    Styles
```

### Statuts de commande

- **Livraison** : `En attente` → `Acceptée` → `En préparation` → `En livraison` → `Livrée`
- **Retrait sur place** : `En attente` → `Acceptée` → `En préparation` → `Prête à retirer` → `Retirée`
  (ou `Non récupérée` si le client ne vient pas)
- À tout moment avant la clôture : `Annulée`.

- Le **call center** peut *accepter* ou *annuler* une commande en attente.
- Le **gérant / admin** fait *avancer* la commande jusqu'à la livraison, ou l'annule.
- Le **client** voit chaque changement en **temps réel** (frise de suivi).

### Sécurité

- Authentification par **JWT** ; mots de passe staff hachés avec **bcrypt**.
- **Autorisation par rôle** sur chaque route sensible (un client ne peut pas accéder au
  back-office, le call center ne peut pas passer une commande en préparation, etc.).
- Le **total** d'une commande est recalculé côté serveur à partir des prix en base
  (jamais fait confiance au montant envoyé par le client).

## Variables d'environnement (optionnel)

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `3000` | Port d'écoute |
| `JWT_SECRET` | valeur de dev | Secret de signature des tokens (à définir en production) |
| `DB_PATH` | `data/restaurant.db` | Emplacement de la base SQLite |

## Évolutions suite à la démonstration du 3 septembre 2026

| Chantier | Où | Fonctionnement |
|---|---|---|
| Personnalisation (logo, nom, accueil) | Staff → **Personnalisation** (admin, développeur) | Nom, slogan, logo (import d'image ou URL), couleur principale, textes et photo de l'accueil, téléphone, adresse, horaires. Les plats affichés dans « Nos incontournables » se choisissent dans le **Catalogue** (case « Mettre en avant »). |
| Livraison ou retrait sur place | Tunnel de commande client | Choix du mode ; activation de chaque mode dans la personnalisation. |
| Adresse + géolocalisation | Tunnel de commande client | Adresse libre (quartier, repères) et/ou bouton « Utiliser ma position actuelle ». Le staff voit l'adresse et un lien « Voir sur la carte ». La géolocalisation exige **https** (ou localhost). |
| Commandes récurrentes | Profil client | Nom, téléphone, adresse, position et mode préféré sont mémorisés (case « Mémoriser ») et pré-remplis à la commande suivante. |
| Commandes à retirer | Client + gérant | Retrait « dès que possible » ou à une heure précise (commande à l'avance). Le client est prévenu quand la commande est **prête**, avec les consignes et le délai de conservation. Le gérant clôture en « Retirée » ou « Non récupérée » ; un badge signale le dépassement du délai. |
| Alertes nouvelles commandes | Staff (call center, gérant, admin) | Carillon sonore **répété toutes les 20 s** tant que la commande n'est pas prise en charge, bandeau rouge clignotant, carte surlignée, titre d'onglet clignotant, notification du navigateur (si autorisée). À la connexion, les commandes arrivées en votre absence déclenchent l'alerte. Bouton « Son activé / coupé ». |
| Modification d'une commande | Staff → bouton « Modifier la commande » | Remplacer un produit (ex. Coca-Cola → Panta), ajouter, retirer, changer les quantités. Le produit de remplacement est facturé à son prix ; le total est recalculé côté serveur. L'**accord du client** doit être coché. Historique conservé. |
| Information du client | Espace client « Mes commandes » | Notification temps réel + bandeau « Votre commande a été modifiée » (détail, ancien/nouveau total) avec bouton « J'ai pris connaissance ». Le staff voit si le client a lu la modification. |
| Statistiques quotidiennes | Staff → **Tableau de bord** (gérant, admin) | Pour une date choisie : commandes livrées, retirées sur place, non récupérées, annulées, recettes, commandes reçues par mode, top produits, et historique des 7 derniers jours. |

**Points restant à valider avec chaque restaurant** (paramétrables, non figés dans le code) :
délai de conservation et règle en cas de commande non récupérée (champs de la personnalisation),
étapes exactes du retrait, et comportement des alertes quand aucun membre du staff n'est connecté
(aujourd'hui : l'alerte se déclenche à la prochaine connexion ; une alerte hors ligne type SMS
nécessiterait un service externe).

> Note navigateur : le son ne peut être joué qu'après une première interaction avec la page
> (règle des navigateurs). Après une connexion, c'est automatique ; après un simple rechargement,
> un bandeau invite à cliquer une fois sur la page.
