# NPF-Q400 — Guide de contexte pour Claude Code

## Qu'est-ce que ce projet

NPF-Q400 (Nearest Pélicandrome Finder) est une PWA opérationnelle, utilisée sur
iPad/Safari, fonctionnant majoritairement **hors ligne** (cartes, NOTAM, données SIA
embarquées). Navigation, cartographie, calculs de mission, trafic ADS-B en temps réel.

**C'est un outil opérationnel, pas un projet expérimental.** Beaucoup de comportements
ont été calés après des dizaines d'essais réels en vol (latences iPad, comportements
Safari spécifiques, stabilité IndexedDB). Un changement qui "semble" être une
amélioration peut casser un comportement validé sur le terrain.

## ⚠️ RÈGLES PRIORITAIRES — à lire avant toute action

Ces règles existent déjà, rédigées par l'utilisateur, en tête de `1_Modifications_vXX.XX.txt`
(section "0. RÈGLES DU CHAT / CONTRAT DE TRAVAIL"). **Elles priment sur tout le reste de
ce document.** Toujours relire cette section dans le fichier réel avant de commencer une
session — elle peut évoluer. Résumé de l'essentiel :

1. **Aucun code sans demande explicite.** Une question, une remarque, un DIAG ou une
   demande d'analyse n'autorise PAS à modifier le code. Rester au stade
   analyse/diagnostic/proposition tant que ce n'est pas explicitement demandé
   ("fais-le", "modifie", "corrige", "intègre", "donne-moi les .txt").
2. **Toujours travailler depuis les fichiers source réels** de la version courante —
   jamais reconstruire `Index`/`Script`/`SIA`/`Style`/`SW` de mémoire ou depuis un
   extrait. Si un fichier manque, le demander/lire avant de coder.
3. **Périmètre strict.** Modifier uniquement ce qui est demandé et strictement
   nécessaire. Pas de nettoyage ou refactorisation opportuniste pendant une correction
   ciblée. Le fonctionnement OFFLINE reste prioritaire en toutes circonstances.
4. **Version de travail stable pendant les itérations.** Ne pas incrémenter la version
   à chaque message — une nouvelle version n'est créée que lors d'une vraie livraison
   complète demandée.
5. **Livraison = 7 fichiers complets, toujours dans cet ordre, jamais de patchs :**
   `1_Modifications` → `2_Index` → `3_Manifest` → `4_Script` → `5_SIA` → `6_Style` → `7_Sw`.
   Ne jamais demander à l'utilisateur de modifier lui-même quelques lignes.
6. **`1_Modifications` est cumulatif, jamais tronqué.** Nouvelle entrée en tête,
   historique complet conservé en dessous, y compris essais ratés et abandons. Une
   remarque non codée doit porter un statut : `NON IMPLÉMENTÉ`, `À MESURER`, `À DÉCIDER`,
   `ABANDONNÉ`, `À REVOIR` ou `VALIDÉ`.
7. **Priorité carte :** la fluidité du fond NPF prime toujours sur les overlays
   (Routes/HT). Ne pas modifier le moteur de tuiles offline (lectures, caches,
   keepBuffer, timeouts, scheduler) sans demande explicite et éléments DIAG.
8. **Avant livraison :** vérifier la syntaxe JS des fichiers concernés, le JSON du
   Manifest, la cohérence des versions/URLs/`appv`/caches/SW, que la modification
   demandée est bien présente, qu'aucune fonction validée n'a disparu. Si `sia.js` n'est
   pas censé changer, vérifier qu'il est strictement identique à la référence.

## Workflow réel du projet

- Tous les essais se font sur une **version TEST** (`vXX.XX`, ex. `v17.26`)
- Une fois validée en vol/usage réel, une version est promue en **version pérenne**
  (numérotation séparée `v2026.NN`, ex. `v2026.67` actuellement)
- À chaque livraison complète demandée, fournir les **7 fichiers .txt complets**, dans
  l'ordre ci-dessus — `5_SIA` excepté, qui ne change presque jamais (vérifier qu'il reste
  strictement identique si aucune modif SIA n'est demandée)
- L'utilisateur copie-colle ensuite manuellement ces fichiers dans le repo GitHub —
  ce n'est pas (encore) Claude Code qui commite directement. Si un jour l'utilisateur
  veut que Claude Code commite/pousse lui-même, il faudra une demande explicite.

## Structure des fichiers

| Fichier livré | Fichier réel | Rôle |
|---|---|---|
| `1_Modifications_vXX.XX.txt` | — (journal) | Fiche de reprise + règles + historique cumulatif |
| `2_Index_vXX.XX.txt` | `index.html` | Page principale, charge les scripts dans l'ordre |
| `3_Manifest_vXX.XX.txt` | `manifest.json` | Manifest PWA |
| `4_Script_vXX.XX.txt` | `script.js` | **~54 500 lignes / ~2,9 Mo.** Logique applicative complète |
| `5_SIA_vXX.XX.txt` | `sia.js` | Moteur SIA — change rarement, vérifier l'identité stricte sinon |
| `6_Style_vXX.XX.txt` | `style.css` | Feuille de style |
| `7_Sw_vXX.XX.txt` | `sw.js` | Service Worker (cache offline, mise à jour de version) |

Ordre de chargement dans `index.html` (ne pas modifier sans raison explicite) :
```
leaflet.min.js → suncalc.js → jszip.min.js → sia.js → script.js
```
Chaque asset est versionné en query string (`?appv=v17.26`) pour forcer le
rechargement du cache au déploiement d'une nouvelle version.

## ⚠️ Ne jamais charger `script.js` en entier "par réflexe"

Avant de le lire : identifier la zone concernée, chercher la fonction/le bloc exact,
ne lire que la zone pertinente + son contexte immédiat. Ne proposer une lecture
intégrale que si explicitement demandé (ex. "vérifie la cohérence de tout le script").

## Carte des grandes zones de `script.js` (v17.26 — les lignes bougent à chaque version, à revérifier)

- **Variables globales** (~L.2010) — forte dépendance transversale, prudence maximale
- **Chat / notifications push** (~L.3062) — plutôt isolé
- **Fonctions utilitaires** (~L.4373) — helpers réutilisés partout
- **Logique principale de l'application** (~L.5371 →) — le plus gros bloc, contient :
  - Moteur de tuiles cartographiques offline (IndexedDB, cache, scheduler) — **zone la
    plus sensible et la plus souvent retravaillée récemment, cf. règle 7 ci-dessus**
  - Gestion des cartes offline / import PDF (~L.15000+)
  - Calque trafic ADS-B (~L.17800 et ~L.20800)
  - Lecteur FdS / GAAR NAS (~L.26300)
  - Calculateur de mission (`CALCULATOR_DATA`, ~L.40600)

## Ce qu'il ne faut PAS faire sans demande explicite

- Refactoriser, renommer, réorganiser "pour la propreté du code"
- Toucher au moteur de tuiles offline ou au séquenceur VFR/HT/Routes
- Modifier l'ordre de chargement des scripts dans `index.html`
- Changer le Service Worker sans comprendre l'impact sur le cache des utilisateurs
  déjà installés
- Réintroduire une piste marquée `ABANDONNÉ` sans nouvelle preuve DIAG
- Incrémenter la version à chaque échange au lieu de garder la version TEST stable

Au-delà du moteur de tuiles, il n'y a pas aujourd'hui de liste figée d'autres zones
"interdites" (formules réglementaires, fonctions gelées spécifiques...) — à
documenter ici au fil de l'eau si de tels cas apparaissent.

## ⚠️ Calculs (distances, carburant, temps, mission...)

- Ne **jamais modifier une formule ou une valeur de calcul** sans demande explicite de
  l'utilisateur, même si une meilleure façon de calculer semble évidente.
- Si une incohérence est détectée dans un calcul existant (résultat qui semble faux,
  formule contradictoire avec une autre partie du code, unité suspecte, etc.) :
  **signaler l'incohérence et demander confirmation avant de toucher au code** — ne
  jamais corriger silencieusement au passage d'une autre tâche.
- Cette règle s'applique à tout ce qui touche au calculateur de mission
  (`CALCULATOR_DATA` et fonctions associées), aux distances Base/Pélic/Feu, aux temps
  estimés, et plus généralement à toute formule numérique utilisée en opération réelle.

## Projet en cours : découpage du fichier source (pas encore fait)

Un découpage de `script.js` en fichiers sources plus petits est à l'étude (fichiers de
développement séparés, reconstitués automatiquement en un seul `script.js` final — la
livraison des 7 fichiers `.txt` complets resterait inchangée). **Pas encore réalisé.**
Si demandé : découpage physique d'abord (aucune ligne modifiée, juste déplacée),
vérification byte-for-byte de la reconstitution, vraie modularisation seulement bien
plus tard et si demandé.

## Environnement de test

Pas de suite de tests automatisés. Validation manuelle en vol/usage réel, consignée
dans `1_Modifications` (statuts `MESURÉ`, `À MESURER`, etc.). Ne pas supposer
l'existence de tests automatisés.
