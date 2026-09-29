# Project notes

- The project owner is X.
- This repository is a plain Chrome Manifest V3 extension. Load its root directory as an unpacked extension; do not introduce a bundler or remote service for the current scope.
- `popup.js` manages the `collectionEnabled` and `translationEnabled` switches and local Baidu credentials. `content.js` observes trimmed selections but accesses neither storage nor network directly; `background.js` saves words under independent `word:<text>` keys in `chrome.storage.local`.
- Keep collection and translation off by default, ignore editable fields, and never log selected text or credentials. Only when both switches are enabled and the user clicks Collect may the current selection be sent to Baidu for translation. Otherwise keep collection local. Never commit API credentials.
- Run `node --test` before claiming changes are complete. Document any behavior changes in `README.md`.
