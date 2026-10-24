# Data and uninstall behavior

- Notes remain `.md` or `.canvas` files in the vault. No remote service is required and the runtime initiates no network requests.
- The plugin's vault-local `data.json` stores section order/groups/colors, page hierarchy, collapsed state, last pages, saved viewports, custom color swatches and automatic-link rules. It is not part of the public repository.
- Canvas files may carry an additional `notebook` object with creation date, title, aliases, card labels, original typography and invisible text anchors. The plugin preserves these values during native Canvas saves. Other editors or core Canvas used after disabling the plugin may discard unknown fields on save. Back up a converted notebook before removing this support.
- Markdown creation dates use `created` frontmatter where available; otherwise the first observed creation time is stored. This cannot reconstruct an original OneNote date if no source metadata was retained.
- Reordering and nesting pages changes plugin hierarchy metadata. Creating a section/group creates a folder. Renaming changes the real file/folder name through Obsidian and follows its link-update behavior.
- Page/section deletion asks for confirmation and moves the item into the vault trash. Deleting a section includes its folder contents. Keep ordinary vault backups; trash is not version control.
- Explicit text-link and formatting actions edit the selected note content. Display-only automatic links do not. Some migration commands deliberately write notes and first create backups inside the plugin directory; review the command's confirmation.
- Optional `import-settings.json`, `reference-links.json`, `spatial-import.json` and `spatial-typography.json` are local legacy profiles. None are included. Do not upload real profiles in bug reports.
- Disabling removes notebook UI and its registered hooks. It does not convert or delete note files. Export or preserve the plugin configuration before uninstalling if you want to retain ordering and hierarchy. Remove installed runtime files and settings only after making that copy.

Desktop-only compatibility is deliberate. Canvas targeting, selection and viewport behavior use internal Obsidian interfaces; they are not a stable public Canvas API. A future app update can require a plugin fix.
