# Changelog

## 3.5.0 desktop beta

- Canvas text cards grow while you type and fit their rendered text after editing, never below their size before editing. Cards below move with them and keep their distance; cards beside or deliberately overlapping stay. Resizing and saving use the native Canvas history. A manual resize ends automatic fitting.
- Keep the caret visible when a growing card extends below the visible area.
- Text that does not fit a card that cannot grow (read-only Canvas, untouched cards) now overflows visibly with all of its preview rendered, instead of being clipped or hidden behind a scrollbar. Opening a page never rewrites untouched cards.
- Editing a card keeps text where reading view shows it. Obsidian 1.14 edits cards in an iframe that the plugin's card styles did not reach; editors now receive the card styles, the app's rem size and imported OneNote typography, and line spacing, paragraph fonts, list indents, rules and images are matched to the measured preview when editing starts.
- New setting, on by default: transparent Canvas card backgrounds, so overlapping cards and images stay visible.
- Resolve the Canvas card of an editor inside the 1.14 iframe. Text colors use the same lookup; their behavior in the iframe editor still needs a live check.

## 3.4.2 desktop beta

- Move the native vault switcher, help and settings footer to the bottom right, including with the left sidebar expanded.
- Keep the status bar visible beside the footer and restore its placement when disabling the plugin.

## 3.4.1 desktop beta

- Keep Obsidian's native vault switcher, help and settings controls reachable at the bottom left when the left sidebar is collapsed, including with the ribbon hidden.
- Reserve footer space instead of covering the editor. Restore the native sidebar placement when expanded and on plugin unload.
- Add keyboard access, accessible labels and browser checks for narrow layouts, native actions and cleanup.

## 3.4.0 desktop beta

- Publish the existing classic notebook interface as a separate MIT-licensed project.
- Add searchable settings for new-page format, classic/theme colors, automatic links and startup explorer collapse.
- Restore Canvas ephemeral-state hooks when disabling the plugin; ignore queued search work after disable and stale successive searches.
- Keep native navigation working if optional Canvas target resolution fails.
- Remove the bundled default keyboard shortcut; existing personal assignments are unchanged.
- Keep dynamic custom-color rules in a removable constructed stylesheet.
- Add English entry documentation, alternative-plugin research, fictional examples, release validation and CI.

This is the first public beta, not a community-directory release. Existing notes are not converted by this update.
