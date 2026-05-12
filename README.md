# Opquast Desktop 2026 - Extension Firefox RGAA 4.1.2

Ce dossier est le paquet complet de diffusion de l'extension Firefox signee par
Mozilla AMO en mode non liste.

## Installation rapide

1. Ouvrir Firefox.
2. Ouvrir `extension/opquast-rgaa-4.1.2-firefox-signed.xpi`.
3. Confirmer l'installation.
4. Ouvrir une page a auditer.
5. Cliquer sur l'icone Opquast Desktop, puis sur `Analyser la page`.

## Contenu du dossier

- `extension/` : XPI signe, XPI non signe de test et copie originale AMO.
- `source/` : sources WebExtension correspondant a l'extension.
- `docs/` : documentation d'installation, d'utilisation, de distribution et de
  maintenance.
- `licenses/` : licences et notices tierces.
- `checksums/` : empreintes SHA-256 des fichiers diffuses.

## Fichiers principaux

- `extension/opquast-rgaa-4.1.2-firefox-signed.xpi` : fichier a partager.
- `source/opquast-rgaa-4.1.2-firefox-source.zip` : sources archivees.
- `docs/01-installation.md` : installation utilisateur.
- `docs/04-confidentialite-permissions.md` : permissions et donnees.
- `docs/07-distribution-et-signature-amo.md` : signature et diffusion.
- `docs/06-validation-technique.md` : controles effectues.

## Statut

- Version extension : `2.0.4.2026`
- Referentiel par defaut : `RGAA 4.1.2`
- Signature : Mozilla AMO `unlisted`

- Collecte/transmission de donnees : aucune declaree dans le manifeste

## Limite

Ce paquet fournit une aide a l'audit et automatise ce qui peut l'etre depuis la
page rendue dans Firefox. Il ne remplace pas un audit RGAA humain complet,
notamment pour les criteres qui dependent du sens, de l'intention editoriale, de
la pertinence des alternatives ou de parcours utilisateur complexes.


## Remerciements

Merci à Mickaël Hoareau et plus largement à l'équipe TEMESIS qui oeuvrent depuis longtemps à rendre les sites web plus accessibles et inclusifs
