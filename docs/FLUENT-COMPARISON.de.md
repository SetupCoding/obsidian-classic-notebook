# Fluent OneNote und Classic Notebook: Bedienungsvergleich

Stand: 25.10.2026. Verglichen wurden Fluent OneNote 1.0.11 (Tag-Commit `9fecdbf2c22980aa10e4e6e8ea7cd0695aabe400`) und Classic Notebook 3.4.0 (`fe12e603d3c9928d8797f40deafa060a322d7158`).

## Ergebnis

Für eine Oberfläche nach OneNote 2013 mit Abschnittsreitern oben, Seitenhierarchie rechts, Abschnittsgruppen mit eigener Reiterleiste und räumlichen Canvas-Seiten passt Classic Notebook deutlich besser. Fluent OneNote eignet sich eher als ergänzender Navigator für Markdown-Notizen mit einem per Tastenkürzel geöffneten Popup. Die ähnliche Produktbeschreibung bedeutet keine funktionale Gleichwertigkeit für diesen Anwendungsfall.

## Prüfung und Grenzen

Das veröffentlichte `main.js` von Fluent wurde aus dem Release geladen und gegen seinen angegebenen SHA256 geprüft. Es stimmt mit dem Bundle im Tag überein. Neun Funktionsszenarien wurden mit dem echten Bundle in einer Node-VM und einer simulierten Obsidian-Dateiverwaltung nachvollzogen. Sieben weitere Szenarien verwenden die echte ausgelieferte Svelte-Oberfläche im Chromium-Browser mit fiktiven Notizen und simulierten Obsidian-Schnittstellen. Ein gesonderter Test prüft das entsprechende Abschnittsverschieben in unserem tatsächlichen Bundle.

Dies ist kein Langzeittest in einem laufenden Obsidian-Vault und kein Leistungsbenchmark. Verhalten von Obsidian-Verlauf, Linkaktualisierung, Betriebssystem-Papierkorb und Drittplugins lässt sich daraus nicht vollständig ableiten. Die echten Vaults und installierten Plugins wurden nicht verändert. Ein `PASS` in den Prüfskripten bedeutet, dass eine Beobachtung reproduziert wurde; es ist keine allgemeine Qualitätsbewertung des beobachteten Verhaltens.

## Unterschiede für diesen Workflow

| Bedienweg | Fluent OneNote 1.0.11 | Classic Notebook 3.4.0 |
| --- | --- | --- |
| Grundaufbau | Notebook-Auswahl, Abschnittsspalte links, Seitenspalte rechts; hauptsächlich Popup, zusätzlich Sidebar | Abschnittsreiter über dem Arbeitsbereich, Seitenhierarchie rechts |
| Abschnittsgruppen | Scanner baut nur eine Abschnittsebene; tiefere Ordner werden Elternseiten | Eigene Sammlung von Reitern und Zurück-Schalter |
| Native Canvas-Seiten | Normale Seitensammlung filtert auf `.md`; eine normale `.canvas`-Datei fehlt im Test | Canvas als normale Notizbuchseite mit frei platzierten Karten |
| Seiten einrücken | Drag sortiert nur Geschwister; andere Hierarchieebenen werden zurückgewiesen | Davor, dahinter oder hinein ziehen; fünf Ebenen mit vollständigem Zweig innerhalb eines Abschnitts |
| Erste Unterseite | Legt einen gleichnamigen Ordner an und verschiebt die ursprüngliche Markdown-Datei hinein | Speichert Eltern-Kind-Zuordnung in Notizbuch-Metadaten; Einrücken verschiebt nicht automatisch Dateien |
| Abschnitt auswählen | Wechselt die Seitenliste, öffnet keine zuletzt verwendete Seite | Öffnet die gemerkte Seite; Canvas-Positionen und Kartenscroll werden zusätzlich verwaltet |
| Schnellsuche | Namen und Pfade, aktuelles oder alle Notizbücher; keine Inhalts-/Alias-Suche im untersuchten ViewModel | Seitenöffner mit Namen/Alias; Inhaltsrecherche über Obsidian-Suche und eigene Canvas-Zielauflösung |
| Aufgeklappte Unterseiten | Nach vollständigem Rescan wird eine zuvor aufgeklappte Elternseite im Test wieder geschlossen; Sidebar löst solche Scans auch bei Dateiänderungen aus | Eingeklappter Zustand wird pro Seite gespeichert |
| Textlayout | Bearbeitung bleibt beim vorhandenen Obsidian-Editor | Zusätzliche Canvas-Formatierung, Datumszeile, Anker und Positionsverwaltung; dadurch mehr Abhängigkeiten von internen App-Schnittstellen |

## Sinnvolle Bedienideen zum Übernehmen

1. **F2 auf dem fokussierten Seiteneintrag.** Direkt in der rechten Liste umbenennen, Enter speichert, Escape bricht ab. Unser vorhandener zentraler Umbenennungsweg sollte weiterverwendet werden, damit Dateiname, Canvas-Titel, Aliase und offene Entwürfe zusammenpassen. Fluent bindet F2 auch an Hover; bei uns besser eindeutig auf den Fokus begrenzen.
2. **Kontinuierliches Scrollen am Rand beim Ziehen.** Fluent verwendet eine Animationsschleife: Auch eine still gehaltene Maus am Listenrand scrollt weiter. Unser vorhandenes Scrollen wird nur von Zeigerbewegungen angestoßen. Das ist ein konkreter, kleiner Komfortgewinn für lange Seitenlisten; auch bei horizontalen Reitern sinnvoll.
3. **Zuletzt verwendete Seiten im vorhandenen Seitenöffner.** Fluent speichert bis zu 50 aktuelle Seiten. Bei uns wären etwa 10 bis 20 Einträge mit Abschnitt/Gruppe sofort verfügbar und könnten dann wie bisher nach Namen/Alias durchsucht werden. Keine zusätzliche dauerhafte Seitenleiste erforderlich.
4. **Sichtbarer Suchbereich und Kontext.** Fluent schaltet im Popup zwischen aktuellem und allen Notizbüchern um und zeigt Herkunftsangaben an. Unser Seitenöffner könnte entsprechend aktueller Abschnitt / alle Abschnitte anbieten und bei doppelten Titeln Gruppe und Abschnitt anzeigen. Die Volltextsuche über Strg+E bleibt ein eigener Bedienweg.
5. **Mittelklick für einen Hintergrundtab.** In Fluent öffnet Strg+Klick im Popup einen Tab und lässt das Popup offen. Bei uns ist ein neuer Tab bereits möglich, wird jedoch aktiv geöffnet. Für das Nachschlagen während einer Szene wäre optionales Öffnen im Hintergrund nützlich.

Export und Import der Anordnung sind als spätere Erweiterung interessant. Eine große technische Übernahme der Svelte-UI oder ihrer Ordnerhierarchie ist für diese Verbesserungen nicht nötig. Virtualisierung sollte erst nach Messungen mit realistischen großen Listen ergänzt werden.

## Zuerst zu prüfende Robustheit

Bei Fluent wurde eine Elternseite mit Unterseite von Abschnitt A nach B gezogen. Nur `Parent.md` wurde verschoben; `Child.md` blieb im bisherigen Ordner. Dieses Verhalten ist bei räumlich zusammengehörigen Seiten überraschend.

Der Vergleich deckt eine ähnliche Lücke bei uns auf: Der Kontextmenübefehl **Verschieben nach** verschiebt ebenfalls nur die ausgewählte Datei. Der Test mit `Parent.canvas` und `Child.canvas` bestätigt das. Die korrekte Zweigverschiebung innerhalb einer Seitenliste darf daher nicht als vollständige Lösung für Abschnittswechsel dargestellt werden. Vor einem weiteren öffentlichen Release sollte ein Abschnittswechsel den vollständigen Zweig samt Hierarchie, Zielkonflikten und gespeicherten Ansichten kontrolliert behandeln.

Ein weiterer Browserbefund bei Fluent: Rechts-Pfeil auf einer Elternseite im Popup klappt die Unterseiten im geprüften Szenario nicht auf, obwohl die README diese Tastaturbedienung allgemein aufführt. Die dokumentierte Tastaturabdeckung sollte daher nicht ungeprüft als vollständig übernommen werden.

Fluents geringerer Eingriff in den Editor ist ein Vorteil für die Wartbarkeit. Unser größerer Funktionsumfang ist kein Beweis höherer Stabilität: Canvas-interne Schnittstellen, verzögerte Navigation und Änderungen an offenen Karten benötigen weiterhin gezielte Tests in Obsidian.

## Priorität

Zuerst vollständiges Verschieben eines Seitenzweigs zwischen Abschnitten absichern. Danach F2 und kontinuierliches Scrollen beim Ziehen ergänzen. Anschließend den vorhandenen Seitenöffner um zuletzt verwendete Seiten und einen sichtbaren Suchbereich verbessern. Die klassische Oberfläche bleibt erhalten.

## Nachweise

- [Fluent Release 1.0.11](https://github.com/2607044640/fluent-onenote/releases/tag/1.0.11)
- [README und Bedienkonzept](https://github.com/2607044640/fluent-onenote/blob/1.0.11/README.md)
- [Scanner und Hierarchie](https://github.com/2607044640/fluent-onenote/blob/1.0.11/src/services/VaultScanner.ts)
- [Suche, Drag-Regeln und kontinuierliches Scrollen](https://github.com/2607044640/fluent-onenote/blob/1.0.11/src/store/OneNoteViewModel.ts)
- [Physisches Verschieben](https://github.com/2607044640/fluent-onenote/blob/1.0.11/src/DragDropHelper.ts)
- [Popup-Tastaturbedienung](https://github.com/2607044640/fluent-onenote/blob/1.0.11/src/OneNoteModalView.svelte)
- [Inline-Umbenennen](https://github.com/2607044640/fluent-onenote/blob/1.0.11/src/PageTreeItem.svelte)
- [Zuletzt verwendete Seiten](https://github.com/2607044640/fluent-onenote/blob/1.0.11/src/RecentPagesModal.ts)
- [Unsere Oberfläche und Abschnittswechsel](https://github.com/SetupCoding/obsidian-classic-notebook/blob/3.4.0/src/classic-notebook.js)
Die isolierten Prüfungen wurden mit fiktiven Daten durchgeführt. Dieses Dokument enthält keine echten Vault-Notizen oder persönlichen Einstellungen.

Alle Empfehlungen beziehen sich auf Bedienideen. Es wurde kein fremder Implementierungscode in Classic Notebook übernommen.
