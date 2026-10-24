# Handling roadmap

The classic OneNote 2013 arrangement remains the product direction: section tabs above the workspace, a right-side page hierarchy and native Canvas pages. The [Fluent OneNote assessment](FLUENT-COMPARISON.de.md) records the research behind these priorities.

## Implemented infrastructure

- One canonical source checkout per plugin, with a shared deployment command for multiple vaults.
- Canonical common formatting modules in Classic Notebook, validated companion copies in GM Shortcuts.
- Read-only drift checks, validation before installation, private backups and rollback of partial runtime updates.
- Separate vault-local settings, import profiles and note content.

## Pending product work

1. **Complete branch moves between sections.** The current context-menu move moves only the selected file. Preserve descendants, hierarchy, ordering and view state; preflight target filename conflicts and avoid partial moves. This is a robustness fix before additional navigation polish.
2. **F2 rename in the page list.** Use the focused row and the existing central rename implementation. Enter saves; Escape cancels. Keep title, filename, aliases, date and unsaved content consistent.
3. **Continuous edge scrolling while dragging.** Keep scrolling while the pointer is stationary near a list/tab-strip edge; cancel on drop, Escape, blur and unload. The current scroll behavior depends on pointer movement.
4. **Recent pages in the existing page opener.** Show a short list with group/section context, preserve Canvas and alias support, and avoid another permanent navigation panel.
5. **Visible search scope.** Current section or all sections, with clear context for duplicate names. Preserve the existing full-text search behavior.
6. **Optional background tabs.** Support middle-click/background opening without moving the current reading position.

These items are proposals and known gaps, not shipped features. The sync workflow distributes the currently implemented code. Changes should be implemented once, regression-tested, reviewed and then deployed to every configured vault.

## Evaluation limits

The Fluent assessment used its published 1.0.11 bundle in isolated API and browser fixtures. It is not a live Obsidian compatibility or performance benchmark. Broad claims about relative speed or reliability are intentionally excluded. Our additional Canvas integrations also carry maintenance costs and require in-app testing.
