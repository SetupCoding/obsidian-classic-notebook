# One source, several vault installations

Classic Notebook and GM Shortcuts are developed in their two source repositories. A vault contains installed runtime files and its own configuration, not an independent development copy. The Classic Notebook repository coordinates installation of both plugins into any explicitly configured vaults.

```text
Classic Notebook src/ + shared/ ── build and tests ─┐
                                                 ├─ tested runtime ── Vault A
GM Shortcuts src/ + vendored shared/ ── tests ──────┘                 └─ Vault B
```

The shared `inline-text-formats.js` and `color-edit.js` modules have one authoring location: **Classic Notebook's `shared/` directory**. GM Shortcuts keeps generated copies so it can still build and install independently. The sync checks stop on a difference; `npm run sync:shared` deliberately refreshes the companion copies. Review, build and commit both repositories after changing those modules.

## Configure a machine

1. Clone both repositories, normally into sibling folders.
2. Run `npm ci` in Classic Notebook. Use Node.js 22.13+ and Git.
3. Copy `sync-vaults.example.json` to **`sync-vaults.local.json`** in this repository.
4. Edit the repository paths and the vault paths in that local file. Relative repository paths resolve from the configuration file. `configDir` supports a custom Obsidian configuration directory.

The local file is ignored by Git. Personal vault names, absolute paths, settings, import profiles and backups do not belong in the public repository. Backups default to the machine's local application-state directory under `ObsidianPluginSync/backups`. An explicit `backupDirectory` must be outside all vaults and source repositories.

## Everyday commands

Run these in the Classic Notebook checkout:

```sh
npm run vaults:plan
npm run vaults:sync
npm run vaults:check
```

- **plan** is read-only. It shows installed versions and which runtime files differ. It rejects stale generated source artifacts instead of rebuilding them silently.
- **sync** requires clean, committed source checkouts. It rebuilds, checks syntax, runs the plugin suites, Classic Notebook lint and the GM integration tests against the configured Classic Notebook checkout. It then backs up all changed installations, stages their updates and installs them. A final hash check confirms parity.
- **check** is read-only and exits unsuccessfully if any configured vault differs from the repository artifacts.

On Windows, double-click **`Sync-Vaults.cmd`** in the repository to run the tested sync. It uses the local configuration, works from another current directory and keeps its console visible for the result. No scheduled watcher or background updater is installed.

To select another local configuration:

```sh
node scripts/sync-vaults.cjs plan --config /path/to/local.json
```

Reload the affected Obsidian windows after a successful update. The installer does not interrupt running editors or change which plugins are enabled. A newly installed plugin still needs to be enabled manually in that vault.

## What is shared and what stays local

| Shared from source | Local to each vault |
| --- | --- |
| `main.js`, `manifest.json`, `styles.css` | `data.json`: ordering, groups, colors, hierarchy, remembered pages and positions, link rules and custom preferences |
| Plugin behavior and version | Notes, Canvas files, attachments, creation dates and card layouts |
| Shared formatting module implementation | Legacy import profiles and existing migration backups |

Only the three runtime filenames are deployed. Files are copied as ordinary files, so a vault stays portable and does not need a filesystem link back to the development checkout.

Before applying changes, the installer saves the previous runtime plus available local plugin settings/import profiles outside the vaults. An update failure restores already changed runtime files across the transaction. It never restores an old settings snapshot over an ongoing local edit. The backup's `deployment.json` records source commit IDs, versions, before/after hashes and installation paths. Treat these backups as private.

To recover an earlier runtime manually, use its backup directory and restore **only** `main.js`, `manifest.json` and `styles.css` into that same plugin installation, then reload Obsidian. Settings snapshots are for deliberate recovery of a vault; do not copy them between vaults. A later `vaults:check` will correctly report an older runtime as differing.

## Development workflow

1. Edit canonical source in `src/` and `shared/`, never an installed vault copy.
2. If a common formatting module changed, run `npm run sync:shared` and review the companion diff.
3. Build and test; update the tracked generated runtime files.
4. Commit the changes in the affected repositories and push them.
5. Run `npm run vaults:plan`, then `npm run vaults:sync`.
6. Reload and check the result inside the affected Obsidian vaults.

The distribution script itself does not publish releases, push commits, download code or synchronize adventure content. The installed plugin versions remain the versions declared by their manifests. Tooling-only changes do not imply new plugin features.

See [ROADMAP.md](ROADMAP.md) for the handling improvements derived from the Fluent OneNote comparison. Recording an idea there does not mark it as implemented.
