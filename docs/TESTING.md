# Beta validation and remaining work

## 3.4.1 footer checks

The browser suite exercises the actual bundle's native-footer relocation, preserved click handlers, keyboard activation, collapsed/expanded sidebar, hidden ribbon, narrow viewport, dark styling, repeated setup and unload restoration (including a temporarily detached native sidebar). Live application verification is recorded separately from these simulated Obsidian objects.

## 3.4.0 validation scope

The packaged `main.js`, not only the source modules, is loaded by 18 Node test files. They exercise text formatting, five-level hierarchy, deletion/rename and stale targets, navigation/history, viewport persistence, exact search ranges, section ordering, native Canvas metadata, text links, import typography, settings and disable/re-enable cleanup. The companion GM plugin adds one standalone suite and two integration files using both real plugin bundles with synthetic notes.

These tests use simulated Obsidian objects. They do not replace testing inside the application. A separate headless Chromium check uses the actual stylesheet and bundle to verify light/dark colors, theme color opt-out and dynamic custom-color stylesheet cleanup. It is a browser fixture, not an Obsidian application test. Run `npx playwright install chromium` once, then `npm run test:browser`.

The new lifecycle regression also fails against the preceding 3.3.9 bundle.

| Environment | Evidence | Limit |
| --- | --- | --- |
| Windows, Node 22+ | Local build and packaged-bundle tests | Simulated app objects |
| Windows, Obsidian 1.14.5 | Existing 3.3.9 navigation, history, section ordering and Canvas table search manually checked during development | New 3.4.0 preferences and reload correction still need live beta feedback |
| Windows/Linux, Node 22 and 24 | CI matrix configured | Check the actual Actions run; configuration is not proof of a passing run |
| macOS/Linux Obsidian | Not tested | Desktop support remains provisional |
| Mobile | Not supported | Desktop-only manifest |
| Third-party themes/Canvas plugins | Not systematically tested | Theme color opt-out is available; internal hook conflicts are possible |

## Release checks

```sh
npm ci
npm run build
npm run check
npm run lint
npm test
npm run test:browser
git diff --exit-code -- main.js manifest.json styles.css
```

Run the GM repository's integration tests with the Classic Notebook checkout beside it. A release ZIP contains only the runtime files and license. Verify it extracts into the matching plugin ID folder, then run the tests against the extracted `main.js` using `NOTEBOOK_PLUGIN` for lifecycle/navigation tests.

The local lint configuration uses ESLint core recommended rules plus a selected set of official `eslint-plugin-obsidianmd` checks. It is **not** the full type-checked recommended configuration and **not** Obsidian's automated security/release scan. An official review can find additional issues.

## Known limitations

- Main interface and commands are currently German. Full localization is pending.
- Reading and editing are separate Markdown renderers. Markdown syntax and complex widgets can still shift layout.
- Exact search supports rendered text in Canvas text cards, including tables; foreign embeds and ambiguous/stale source mappings may fall back to native behavior. Use native Find if needed.
- Some navigation, selection, metadata preservation and history integrations use internal app APIs. They need testing after Obsidian updates.
- Freehand drawing and a general OneNote export importer are not included.

## Before community submission

1. Test the release in a disposable vault in Obsidian 1.14.5: install, enable, disable/re-enable, reload, then uninstall.
2. Try both new-page formats, both color modes, light/dark, a second theme, section groups, drag sorting, rename/delete, links and search inside a table. Check unsaved cards and rapid back/forward navigation.
3. Test with a second vault open and a pop-out window; test macOS/Linux if claiming support.
4. Add clean real-app screenshots and finish UI localization or clearly limit supported languages.
5. Run the official [Obsidian submission workflow](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin), including its current automated review. Address findings before requesting a directory listing.

No community-directory approval or external beta-testing results are claimed by this release.
