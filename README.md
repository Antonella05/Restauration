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
  db.js             Connexion SQLite + schéma
  seed.js           Données de démonstration (comptes staff + menu) — idempotent
  auth.js           JWT, rôles et middlewares d'autorisation
  realtime.js       Hub WebSocket (diffusion des événements de commande)
  routes/
    auth.js         Connexion client (nom+tél) et staff (login+mdp)
    menu.js         Menu public (catégories + produits disponibles)
    orders.js       Création, liste, détail, changement de statut des commandes
    products.js     Gestion du catalogue (développeur / admin)
public/
  index.html        Application client
  staff.html        Application staff (login + tableaux de bord par rôle)
  js/common.js      Auth (localStorage), appels API, WebSocket, toasts
  js/client.js      Logique de l'interface client
  js/staff.js       Logique des interfaces staff
  css/styles.css    Styles
```

### Statuts de commande

`En attente` → `Acceptée` → `En préparation` → `En livraison` → `Livrée` (ou `Annulée`).

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
