# Project notes

- The project owner is X.
- This repository is a plain Chrome Manifest V3 extension. Load its root directory as an unpacked extension; do not introduce a bundler or remote service for the current scope.
- `popup.js` manages the `collectionEnabled` switch; `content.js` saves trimmed double-click selections under independent `word:<text>` keys in `chrome.storage.local`.
- Keep collection off by default, ignore editable fields, and never log selected text or send it over the network.
- Run `node --test` before claiming changes are complete. Document any behavior changes in `README.md`.
