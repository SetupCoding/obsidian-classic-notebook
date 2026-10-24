# Source and distribution rules

- Develop Classic Notebook in `src/` and `shared/`. Generate the root `main.js`, `manifest.json` and `styles.css` with `npm run build`.
- Installed vault copies and the historical combined workspace are deployment outputs. Do not develop or patch code there directly.
- `shared/inline-text-formats.js` and `shared/color-edit.js` are canonical here. GM Shortcuts keeps generated copies for independent builds. Use the shared sync action and test both plugins after changing them.
- See `docs/ROADMAP.md` for pending handling work. Research notes do not imply implemented features.
- Use `docs/VAULT-SYNC.md` for validated multi-vault deployment. Keep vault-specific configuration, notes, import profiles and backups private and out of Git.
- Deploy only the three runtime files. Never replace a vault's `data.json`, enabled-plugin list, workspace or notes with values from another vault.
- Run `npm test`, `npm run lint` and the companion integration tests for relevant changes. Use the browser appearance check for styling changes.
- Before a release, validate the actual packaged runtime and the intended in-app behavior; distinguish simulated tests from application tests.

# Authorship and writing

- The user is the sole author. Never add AI attribution, AI co-author trailers or generated-by credit to commits, pull requests, issues or comments.
- Do not use em dashes in commits, pull requests, issues or comments.
