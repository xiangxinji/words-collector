# Project notes

- The project owner is X.
- This repository is a plain Chrome Manifest V3 extension. Load its root directory as an unpacked extension; do not introduce a bundler or remote service for the current scope.
- `popup.js` manages the `collectionEnabled` and `translationEnabled` switches and local Baidu credentials. `content.js` observes trimmed selections but accesses neither storage nor network directly; `background.js` saves words under independent `word:<text>` keys in `chrome.storage.local`.
- Keep collection and translation off by default, ignore editable fields, and never log selected text or credentials. Only when both switches are enabled and the user clicks Collect may the current selection be sent to Baidu for translation. Otherwise keep collection local. Never commit API credentials.
- Run `node --test` before claiming changes are complete. Document any behavior changes in `README.md`.

## Mandatory UI design standard

These are requirements for every future popup or on-page collection UI change, not optional visual inspiration:

- Keep a compact, content-first, Fluent 2-inspired **native HTML/CSS** interface. Do not add a component library, bundler, remote fonts/assets, glass effects, gradients, or decorative emoji. This is not an official Fluent UI implementation.
- Preserve the popup hierarchy: product header, collection switch, collected-word list, then optional translation settings. Keep the popup about 360–380 px wide and at most 600 px tall; let a long word list scroll independently so the translation entry point remains reachable.
- Keep Baidu credentials inside a keyboard-accessible disclosure that is collapsed by default. Its configuration entry must remain reachable regardless of switch state. The notice that selected text goes to Baidu **only after clicking Collect** must remain visible outside the disclosure; never hide that privacy condition to save space.
- Use `popup.css` variables as the popup's color source of truth: neutral canvas/surfaces, restrained blue primary actions, red errors and destructive hover states, and green success feedback. Keep the on-page button in `content.js` visually consistent with those colors, spacing, corners, and focus treatment; its Shadow DOM cannot inherit popup styles. Do not use an error color for success or rely on color alone to convey state.
- Use real labels and semantic native controls. Switches must remain keyboard operable with visible focus; setting rows should provide at least a 40 px click area and destructive word actions at least 44 × 44 px. Keep ordinary text contrast at least 4.5:1, retain visible focus indicators, and respect `prefers-reduced-motion` when adding transitions.
- For any UI change, check empty and populated lists, expanded credentials, error/success feedback, and keyboard access in a browser using sample data only. Update relevant tests, run `node --test`, and document behavior changes in `README.md`. Never use real selected text or API credentials in screenshots or logs.
