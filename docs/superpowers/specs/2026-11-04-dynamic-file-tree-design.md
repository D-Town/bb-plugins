# BB Plugin Dynamic File Tree – MVP Design

Status: Draft for user review

## Ziel

`BB Plugin Dynamic File Tree` zeigt in der rechten Sidebar des aktuell aktiven
BB-Threads den Datei- und Ordnerbaum des zugehörigen Environments bzw.
Worktrees. Der Baum soll den Projektkontext des Threads sichtbar machen und
eine schnelle Navigation durch die wichtigsten Dateien ermöglichen.

Das Plugin ist von
[`data-goblin/claude-code-filetree`](https://github.com/data-goblin/claude-code-filetree)
inspiriert. Übernommene Codebestandteile oder Assets müssen ihre ursprünglichen
MIT- und Drittanbieter-Hinweise behalten.

## MVP-Umfang

Das erste Release umfasst:

- Integration als Panel in der rechten Thread-Sidebar
- Ermittlung des aktiven BB-Environments bzw. Worktrees aus dem Thread-Kontext
- Anzeige des Projektwurzelverzeichnisses als auf- und zuklappbaren Baum
- Navigation durch Ordner und Dateien
- Git-Status an Dateien und Ordnern, sofern das Environment ein Git-Repository
  enthält
- Auswahl einer Datei
- Preview für Textdateien, Markdown und Bilder
- verständliche Leer- und Fehlerzustände

Nicht Bestandteil des MVP sind Agentenaktivitäts-Animationen, Volltextsuche,
Treemaps, Datei- oder Ordnerschutz, Diff-Ansichten und zusätzliche
Dokumentformate. Diese Funktionen können auf dem MVP aufbauen.

## Benutzererlebnis

Das Panel folgt immer dem aktuell aktiven Thread. Beim Wechsel des Threads
werden Environment, Worktree, Branch und Dateiinhalt neu bestimmt.

Wenn kein Environment, kein Projekt oder kein Git-Repository vorhanden ist,
zeigt das Panel den jeweiligen Zustand statt eines leeren oder irreführenden
Baums.

Der Git-Status gehört zum Environment bzw. Worktree. Spätere
Agentenaktivitätsanzeigen müssen zusätzlich dem jeweiligen Thread zugeordnet
werden, damit parallele Threads nicht vermischt werden.

## Technischer Entwurf

Das Plugin wird als eigenständiges Paket unter
`plugins/dynamic-file-tree/` angelegt. Die Frontend-Integration nutzt die
BB-Plugin-SDK-Oberfläche für den Thread-Kontext bzw. die rechte Sidebar. Die
genauen SDK-Symbole werden beim Scaffolden gegen die aktuell installierten
BB-SDK-Deklarationen geprüft.

Die Darstellung bleibt im Plugin gekapselt. BB-eigene Navigation und
Environment-Informationen werden über die vom SDK vorgesehenen
Host-Schnittstellen bezogen; das Plugin dupliziert keine globale Thread- oder
Environment-Verwaltung.

Für Datei- und Preview-Inhalte gelten begrenzte Größen und sichere
Fehlerbehandlung. Nicht unterstützte oder zu große Dateien werden als solche
angezeigt, statt die Sidebar zu blockieren.

## Fehler- und Sicherheitsverhalten

- Keine Projektdatei wird ohne Benutzeraktion als Agentenkontext übertragen.
- Dateipfade werden auf das aktive Environment und die erlaubten Projektgrenzen
  beschränkt.
- Fehlende Berechtigungen, nicht erreichbare Dateien und ungültige Pfade
  erscheinen als lokaler Fehlerzustand im Panel.
- Binärdateien ohne unterstützte Preview werden nicht als Text interpretiert.
- Das Plugin erhält nur die BB-SDK-Rechte, die für Environment-, Datei- und
  Git-Anzeige erforderlich sind.

## Tests und Abnahmekriterien

Der MVP gilt als funktionsfähig, wenn:

1. das Panel im aktuellen Thread erscheint;
2. ein Wechsel zwischen Threads den korrekten Environment-/Worktree-Baum lädt;
3. Ordner geöffnet und geschlossen werden können;
4. Dateien ausgewählt werden können;
5. Text, Markdown und Bilder in der Preview erscheinen;
6. Git-Status sichtbar ist, wenn ein Repository vorhanden ist;
7. fehlende Environments und nicht unterstützte Dateien verständlich behandelt
   werden;
8. Typecheck, Tests und `bb plugin build` erfolgreich laufen.

## Spätere Ausbaustufen

Nach dem MVP können Suche, Diff-Ansichten, Agentenaktivität, Treemap,
Schutzmarkierungen, Kontextübergabe und weitere Dokumentformate als getrennte
Erweiterungen ergänzt werden.

