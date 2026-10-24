# Classic Notebook

Obsidian-Plugin mit einer klassischen Notizbuch-Oberfläche, inspiriert von OneNote. Aktueller Stand: **3.3.9**. Getestet unter Windows mit Obsidian 1.11.4 und 1.14.5.

Klassische Notizbuch-Oberfläche mit Abschnittsreitern oben und einer Seitenliste rechts. Unterstützt Abschnittsgruppen, Abschnittsfarben, eine Seitenhierarchie mit bis zu fünf Ebenen, Drag-and-drop und einklappbaren Unterseiten, native Canvas-Seiten, Anlegedatum, automatische Links und einen Hell/Dunkel-Schalter.

Beim Verschieben einer Seite bleiben ihre Unterseiten zusammen. Das Limit von fünf Ebenen gilt für den gesamten Zweig. Es gilt auch für neue Unterseiten und „Char anlegen“. Einrücken und Ausrücken ist per Drag-and-drop, Kontextmenü oder `Alt+Pfeil rechts/links` möglich.

„Seite umbenennen“ im Kontextmenü gleicht Dateiname und gespeicherten Anzeigetitel ab. Bei Canvas lässt sich außerdem direkt auf den großen Seitentitel klicken: Enter oder ein Klick außerhalb speichert, Escape verwirft die Änderung. Bisherige Namen bleiben als Aliase auffindbar. Anlegedatum, Unterseiten, Karten, Positionen und ungespeicherte Kartenänderungen bleiben erhalten.

„Seite löschen …“ ist über das Kontextmenü der rechten Seitenliste, die Entf-Taste bei fokussiertem Seiteneintrag und den Befehl „Seite löschen“ in der Befehlspalette erreichbar. Ein Dialog bestätigt den betroffenen Seitennamen. Die Datei wird immer in den Vault-Papierkorb `.trash` verschoben. Direkte Unterseiten übernehmen die Elternseite des gelöschten Eintrags; deren Nachkommen bleiben zusammen. Der Befehl unterstützt Markdown und native Canvas-Seiten und bezieht sich bei Canvas auf die geöffnete Seite, auch wenn eine eingebettete Dateikarte ausgewählt ist.

Ganz links oben blendet ein Schalter die schmale Obsidian-Symbolleiste ein oder aus. Die gewählte Sichtbarkeit bleibt nach einem Neustart erhalten. Ein Klick auf den Vault-Namen öffnet oder schließt weiterhin den Dateiexplorer.

An freien Flächen der oberen Abschnittsleiste lässt sich das Desktop-Fenster verschieben. Tabs, die horizontal scrollbare Tab-Liste und die Schaltflächen bleiben bedienbar. Ein Doppelklick auf eine freie Fläche maximiert das Fenster beziehungsweise stellt es wieder her.

Neue Seiten über „Seite hinzufügen“ werden als native `.canvas`-Dateien angelegt. Markdown-Seiten lassen sich über den Befehl „Neue Textseite (Markdown)“ anlegen. Bestehende Seiten werden nicht konvertiert.

Bereits in Canvas umgewandelte Notizbücher können ausschließlich native Canvas-Seiten verwenden. Jeder übernommene Textkasten bleibt eine normale Canvas-Textkarte: verschieben, Größe ändern, doppelklicken zum Bearbeiten und am Rahmen markieren, um sie mit Entf zu entfernen. Die Originalpositionen, Schriftgrößen und Absatzabstände werden übernommen. Metadaten liegen im zusätzlichen `notebook`-Objekt der Canvas-Datei; Obsidian erhält dieses Objekt beim Speichern. Es ist keine besondere Kartenart nötig. Die Notebook-Erweiterung ergänzt nur die ursprüngliche Typografie, Kartenbeschriftungen und das Anlegedatum.

Canvas-Aliase werden bei `[[`-Linkvorschlägen berücksichtigt. Der Befehl „Seite öffnen“ findet Seitennamen und Aliase auch dann, wenn die Zielseite Canvas ist. Ihm lässt sich beispielsweise Strg+O zuweisen. Ein Notizbuch kann mit `nativeCanvasOnly` die alten Markdown- und Gesamtansicht-Befehle ausblenden. Gemeinsame Aufgabenlisten bleiben intern einzelne Markdown-Datenquellen und werden als native Dateikarten angezeigt, damit jedes Erledigt-Häkchen nur einmal gespeichert ist.

Beim Wechsel zwischen Abschnittsreitern oder Seiten merkt sich das Plugin pro Canvas-Seite die Position auf der Fläche, den Zoom und die Scrollstelle innerhalb langer Textkarten. Beim erneuten Öffnen wird diese Ansicht wiederhergestellt. Ein gezielter Link oder Suchtreffer führt weiterhin an seine Textstelle; die native Vor-/Zurück-Historie behält ihre eigene Ansicht. Neue Seiten ohne gespeicherte Position beginnen wie bisher am Anfang. Die Positionen liegen unter `pagePositions` in den Vault-Einstellungen des Plugins, bleiben beim Umbenennen erhalten und werden beim Löschen der Seite entfernt. Die Canvas-Dateien werden für diese Funktion nicht geändert.

Native Canvas-Seiten können mit `notebook.anchors` Sprungziele für Überschriften und Blockkennungen speichern. Ein Link zur betreffenden Stelle öffnet die vollständige Canvas-Seite und zeigt die zugeordnete Karte an. Gelöschte Karten werden dabei nicht wiederhergestellt. Karten mit `appearance: "native"` behalten Obsidian-Schrift und Absatzabstände; importierte Originaltypografie bleibt weiterhin unterstützt.

Der Befehl „Import-Marker aus Canvas-Texten entfernen“ verschiebt zugeordnete `^src-…`-Markierungen vollständig in diese Metadaten. Vor der Änderung legt er eine Sicherung der betroffenen Seiten unter `.obsidian/plugins/classic-notebook/backups/` an, einschließlich offener Kartenentwürfe. Bestehende Linkkennungen bleiben erhalten. Die zusätzlichen Markerzeilen entfallen beim Bearbeiten. Normale Blockkennungen für TODOs sowie Codebeispiele bleiben bestehen. Die Sprungbereiche werden bei nativen Canvas-Speichervorgängen an Textänderungen angepasst; die Zuordnung setzt das aktivierte Plugin voraus. Das Entfernen von Karten legt keine neuen Karten an.

Mit „Textstelle verknüpfen“ wird markierter Text zum Link auf eine Seite, Canvas-Karte, Überschrift oder einen einzelnen Absatz beziehungsweise Aufzählungspunkt. Den Text markieren, `Strg+P` drücken und „Textstelle verknüpfen“ auswählen. Die gemeinsame Suche durchsucht Seitennamen, Aliase, Kartenbeschriftungen und Text. Mehrere Wörter lassen sich kombinieren, zum Beispiel ein Personenname und ein Begriff aus dem gesuchten Satz. Jeder Treffer zeigt seine Art, Seite, Karte und einen Textausschnitt. Ein Klick oder Enter verknüpft die Auswahl; die Pfeiltasten wechseln den Treffer. Der Befehl steht auch im Text-Kontextmenü bereit.

Canvas-Ziele erhalten bei Bedarf eine unsichtbare Kennung in `notebook.anchors`. Der Zieltext bleibt unverändert, vorhandene Kennungen für denselben Bereich werden wiederverwendet. Aufzählungspunkte werden beim Öffnen direkt angesteuert. Markdown-Ziele unterstützen ganze Seiten und Überschriften ohne zusätzliche Marker. Native Obsidian-Linkeinstellungen werden berücksichtigt. Farbige und fette Textteile behalten ihre Formatierung, bestehende Links lassen sich umleiten. Die Auswahl bleibt beim Öffnen der Befehlspalette und beim Schließen des temporären Canvas-Editors erhalten. Zwischenzeitlich geänderte oder gelöschte Quell- und Zielstellen werden erkannt. Der Befehl verändert dann keinen veralteten Quelltext; „Suche aktualisieren“ lädt die Ziele neu.

Seiten mit gespeichertem Textkasten-Layout öffnen immer in der Gesamtansicht, auch aus der Suche, über Links, in neuen Tabs und nach einem Neustart. Alle Textkästen und Randnotizen behalten ihre Position. Suchtreffer führen zum betroffenen Textkasten; die übrigen Kästen bleiben auf derselben Fläche verfügbar. Native Canvas-Seiten und Markdown-Seiten ohne Layout behalten ihre normale Ansicht.

`Strg+Umschalt+M` schaltet auf einer Markdown-Seite zwischen Gesamtansicht und Textansicht um. Der Befehl heißt „Gesamtansicht / Textansicht umschalten“ und ist auch über `Strg+P` erreichbar. „Textansicht“ in der Werkzeugleiste öffnet den Quelltext vorübergehend. Beim nächsten Öffnen der Seite erscheint wieder die Gesamtansicht. Der Shortcut lässt sich unter Einstellungen → Tastenkürzel ändern.

Importierte Textkästen können ihre ursprüngliche Schriftart, Schriftgröße, Zeilenhöhe und Absatzabstände mitbringen. Dabei bleibt die Textbreite aus dem Original zusätzlich zum Rahmen und Innenabstand verfügbar. Auch mehrere ursprüngliche Leerzeilen werden in der Darstellung wiederhergestellt, wenn Markdown sie zusammengefasst hat. So bleiben Randnotizen neben dem zugehörigen Verlauf. Die Wiederherstellung verändert keine Notiztexte und verschiebt keine bereits manuell platzierten Textkästen.

Über das Palettensymbol oben lässt sich markierter Text einfärben. Eine Standardfarbe oder eigene Farbkachel anklicken, um sie direkt anzuwenden. Die Vorschau zeigt die gewählte Farbe. Eigene Farben lassen sich über Farbwähler oder Hex-Wert anlegen, optional benennen und mit „Als Kachel speichern“ oder „Speichern & anwenden“ im Vault sichern. Das kleine Kreuz entfernt eine eigene Kachel aus der Palette. Bereits eingefärbter Text behält dabei seine Farbe. Ohne Textauswahl lässt sich die Palette zum Verwalten der eigenen Farben öffnen.

Die Auswahl bleibt beim Öffnen der Palette auch dann verfügbar, wenn Canvas seinen temporären Texteditor schließt. Sichtbare Textauswahlen in gerenderten Canvas-Textkarten werden anhand ihrer Textknoten eindeutig dem Quelltext zugeordnet. Kann komplexes Markdown nicht eindeutig zugeordnet werden, die Karte per Doppelklick bearbeiten und dort markieren. Eine zwischenzeitliche Textänderung wird vor dem Anwenden erkannt.

Abschnittsnamen, Reihenfolge, Farben, Seitenhierarchie und Linkregeln werden pro Vault in `data.json` gespeichert. Es sind keine Kampagnen, Figuren, Abschnitte oder Linkzuordnungen vorbelegt. Optionale lokale Importprofile `reference-links.json`, `spatial-import.json`, `spatial-typography.json` und `import-settings.json` gehören ausschließlich zum jeweiligen Vault und sind in diesem Paket nicht enthalten.

Neue Canvas-Seiten beginnen mit einer leeren nativen Textkarte oben links bei 100 % Zoom. Auch Seiten, die andere Plugins über die Seitenschnittstelle anlegen, starten links oben. Danach bleibt der manuell gewählte Bildausschnitt erhalten: Wiederholte Darstellungsaktualisierungen, Größenänderungen und das Bearbeiten langer Karten lösen kein automatisches Zentrieren oder Einpassen aus. Die nativen Zoomknöpfe und gezielte Sprünge über Links und Suchtreffer bleiben verfügbar. Beim Neuladen des Plugins bleibt die Ansicht bereits geöffneter Seiten bestehen.

Die Canvas-Suche markiert die exakten sichtbaren Zeichen eines Treffers, auch innerhalb einer Tabelle und über mehrere fette oder farbige Textteile hinweg. Die Ansicht springt direkt zum gefundenen Wort. Gleiche Wörter in verschiedenen Tabellenzeilen werden anhand der Quellposition unterschieden. Die native Markierung des gesamten Blocks wird für diesen Treffer unterdrückt. Die Hervorhebung verändert weder den Notiztext noch das Layout und bleibt bis zum nächsten Seitenwechsel, Suchtreffer oder Bearbeiten der Karte sichtbar.

Native Canvas-Textkarten verwenden in Leseansicht und Live Preview dieselbe Textbreite, Innenabstände, Schrift, Zeilenhöhe und Listeneinrückung. Überschriften im Editor erhalten die Zeilenhöhe der Leseansicht. Leere Quellzeilen teilen sich den entsprechenden Absatz- oder Überschriftenabstand, statt zusätzliche volle Zeilen und Überschriftenpolster aufzusummieren. Dabei werden ausschließlich Editor-Dekorationen und Darstellungsregeln verwendet. Der Text und die Rückgängig-Funktion bleiben nativ. Explizit importierte Textkarten mit eigenen Originalmaßen behalten ihre bisherige Darstellung. Markdown-Syntax auf einer aktiven Zeile und komplexe native Widgets können weiterhin Unterschiede zwischen den Modi verursachen.

Zurück und Vorwärts verwenden auch bei Fokus im Suchfeld der rechten Seitenliste den Verlauf des aktuellen Haupttabs. Die Seitenliste leitet dazu ausschließlich ihre eigenen Verlaufsaktionen an diesen Tab weiter. Obsidian-Befehle und Maus-Seitentasten nutzen denselben nativen Verlauf; die Notizverläufe werden nicht ersetzt. Fehler beim zusätzlichen Speichern einer Seitenposition verhindern keinen Seitenwechsel.

Abschnittsreiter und Abschnittsgruppen lassen sich oben mit der Maus vor oder hinter einen anderen Reiter ziehen. Eine senkrechte Markierung zeigt die Zielposition. Alternativ verschiebt Strg+Umschalt+Pfeil links/rechts den fokussierten Reiter. Die Reihenfolge bleibt pro Gruppe erhalten, ohne Dateien zu verschieben oder die geöffnete Seite zu wechseln.

Die genaue Canvas-Suchmarkierung berücksichtigt den eigenen Markdown-Embed-Container einer nativen Textkarte. Fremde eingebettete Inhalte innerhalb der Karte bleiben ausgeschlossen. Der Befehl „Zusätzliche Canvas-Tabs rechts schließen“ speichert offene Inhalte und schließt ausschließlich Canvas-Ansichten der rechten Seitenleiste. Beim Laden konvertierter Dateien behalten Gliederung, Rückverweise und ausgehende Links ihren ursprünglichen Ansichtstyp.

Die native Iconzeile über der rechten Seitenliste wird ausgeblendet, solange die Notizbuch-Seitenliste sichtbar ist. Wird über einen Obsidian-Befehl eine andere Seitenleistenansicht geöffnet, erscheint deren Tab-Leiste wieder.

Das Anlegedatum nutzt bei Markdown die Eigenschaft `created`, sonst die erste erfasste Erstellungszeit der Datei. Die Anzeige verwendet standardmäßig die lokale Zeitzone. Neue Canvas-Seiten speichern Titel, Anlegedatum und Aliase zusätzlich in ihren portablen Notizbuch-Metadaten. Die Dateien bleiben native Canvas-Seiten.

## Installation

Die drei Dateien `main.js`, `manifest.json` und `styles.css` aus dem Repository in `.obsidian/plugins/classic-notebook/` des gewünschten Vaults kopieren. Obsidian neu laden und das Plugin unter Einstellungen → Externe Erweiterungen aktivieren. Die erzeugten Dateien im Repository sind direkt installierbar.

Persönliche Einstellungen, Notizen und lokale Importprofile sind nicht enthalten. Alle Einstellungen werden pro Vault gespeichert.

## Entwicklung

Node.js ab Version 22:

```sh
npm run build
npm test
```

Build und Tests benötigen keine zusätzlich installierten npm-Pakete. Obsidian und CodeMirror werden zur Laufzeit von Obsidian bereitgestellt. `src/` enthält Plugin-Code, Styles und das ursprüngliche Manifest; `shared/` enthält die beim Build eingebundenen Module. `main.js`, `manifest.json` und `styles.css` im Wurzelverzeichnis sind die erzeugten Installationsdateien. Tests verwenden neutrale Beispieldaten.

## Status

Private Arbeitsfassung, kein veröffentlichter Community-Plugin-Release. Vor einer öffentlichen Veröffentlichung sind unter anderem endgültiger Name, Autor, Lizenz und die Obsidian-Review-Anforderungen festzulegen. Es wurde noch keine Open-Source-Lizenz vergeben.

## GM-Integration

Die separaten [GM Schnellbefehle](https://github.com/SetupCoding/obsidian-gm-shortcuts) ergänzen Formatierung, Charakterseiten und TODOs. Classic Notebook stellt dafür `getNotebookPageParents`, `createNotebookPage` und `appendNotebookPageEmbed` bereit.
