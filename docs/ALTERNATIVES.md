# Related plugins

Research date: 2026-10-25. This comparison describes each project's published documentation and the official community catalog. The other plugins were not installed for a runtime comparison. Features and maintenance can change.

| Plugin | Documented focus | Relationship to Classic Notebook |
| --- | --- | --- |
| [Fluent OneNote](https://github.com/2607044640/fluent-onenote) | OneNote-style notebooks, sections and pages; two-column sidebar or popup, nested pages and drag ordering. MIT. | The closest navigation alternative. Worth trying before choosing a separate notebook interface. Classic Notebook focuses on top section tabs, the page list on the right, and native Canvas page behavior. |
| [Notebook Navigator](https://github.com/johansan/notebook-navigator) | A substantial two-pane note browser with folders, tags, properties, colors, sorting and mobile support. GPL-3.0. | A broader navigation tool with a different layout. Do not assume Classic Notebook is more mature or more capable. |
| [On2Od / OneNote2Obsidian](https://github.com/Lalogeorgi/OneNote2Obsidian) | Alpha `.one`/`.onepkg` spatial import, a PixiJS `.onecanvas.json` view and synchronized Markdown projection. MIT. | Relevant when preserving a OneNote export's spatial layout is the priority. Classic Notebook uses native `.canvas` and does not ship a general importer. |
| [File Tree Alternative](https://github.com/ozntel/file-tree-alternative) | Separate folder and file panes for browsing. | Simpler navigation overlap. |
| [Advanced Canvas](https://github.com/Developer-Mike/obsidian-advanced-canvas) | Native Canvas enhancements, styling, flowcharts and presentations. GPL-3.0. | Different focus; compatibility with Classic Notebook's internal Canvas hooks is unverified. |
| [Ink](https://github.com/daledesilva/obsidian_ink) | Drawing and handwriting embedded between note paragraphs. | Relevant for freehand input. Classic Notebook itself does not add a drawing tool. |

Primary discovery source: [Obsidian's community plugin catalog](https://github.com/obsidianmd/obsidian-releases/blob/master/community-plugins.json). Fluent OneNote, Notebook Navigator and On2Od are already cataloged there. No implementation from these alternatives was copied into this repository.

The case for publishing Classic Notebook is a preference for this particular combination of classic horizontal tabs, right-side page hierarchy and native Canvas pages. It is not a claim that notebook-style navigation is new.
