# Event Extractor to Google Calendar

Open-source Chrome/Edge extension for extracting event details from web pages or selected text, reviewing the result, and creating Google Calendar events.

The extension keeps the final decision with the user: extracted candidates are editable, selectable, and only created after explicit confirmation.

## Features

- Scan the active page for event candidates.
- Extract from selected text with a right-click context menu.
- Review and edit title, date, time, timezone, location, and description.
- Quickly choose only the event you want.
- Select a writable Google Calendar target.
- Check nearby calendar events for possible duplicates.
- Open the created event day in Google Calendar.
- Optional backend AI fallback when local parsing finds no candidate.

## Repository Structure

```text
.
|-- extension/       Chrome extension source and build config
|-- backend/         Express extraction API
|-- docs/            Store listing, OAuth, and release notes
|-- scripts/         Release check and packaging scripts
|-- PRIVACY.md       Privacy policy draft for publication
|-- LICENSE          MIT license
```

## Local Development

### Backend

```bash
cd backend
npm install
cp .env.example .env
npm run dev
```

Health check:

```bash
curl http://localhost:8787/health
```

### Extension

```bash
cd extension
npm install
cp .env.example .env
npm run build
```

Load it in Chrome or Edge:

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable Developer mode.
3. Click `Load unpacked`.
4. Select `extension/dist`.

## Google OAuth Setup

The extension uses Chrome Identity and Google Calendar API. You need an OAuth client ID of type `Chrome Extension`.

For local development:

1. Load the unpacked extension.
2. Copy its extension ID from `chrome://extensions`.
3. In Google Cloud Console, enable Google Calendar API.
4. Configure the OAuth consent screen.
5. Create a Chrome Extension OAuth client using the extension ID.
6. Copy the generated client ID into both:
   - `extension/manifest.json`
   - `extension/public/manifest.json`
7. Rebuild the extension.

For Chrome Web Store release, use the published extension ID, not only the local unpacked ID. See [docs/OAUTH_SETUP.md](docs/OAUTH_SETUP.md).

## Configuration

### Backend `.env`

```env
PORT=8787
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
EVENT_RANKER_MODEL_PATH=
ALLOWED_EXTENSION_ORIGINS=
```

`ALLOWED_EXTENSION_ORIGINS` can be a comma-separated list such as:

```env
ALLOWED_EXTENSION_ORIGINS=chrome-extension://your-extension-id
```

Leave it blank for local development. In production, valid Chrome extension
origins are accepted and this list may be used for any additional trusted
browser origin that should reach the API.

### Extension `.env`

```env
VITE_BACKEND_BASE_URL=http://localhost:8787
```

For public release, build with an HTTPS production backend:

```powershell
$env:VITE_BACKEND_BASE_URL="https://your-production-backend.example.com"
cd extension
npm.cmd run build
```

## Release Build

Run checks:

```powershell
cd extension
npm.cmd run typecheck
npm.cmd run build
npm.cmd run release:check
```

Package for Chrome Web Store:

```powershell
cd extension
npm.cmd run package
```

The release ZIP is written to `release/`. Upload the ZIP contents directly through the Chrome Web Store Developer Dashboard.

More details:

- [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md)
- [docs/STORE_LISTING.md](docs/STORE_LISTING.md)

## Privacy

See [PRIVACY.md](PRIVACY.md).

Short version: the extension processes page content only when the user requests extraction, sends extraction payloads to the configured backend, and uses Google Calendar access only to list calendars, check duplicates, and create events after confirmation.

## Open Source

This project is licensed under the MIT License. See [LICENSE](LICENSE).

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Security

Please report vulnerabilities responsibly. See [SECURITY.md](SECURITY.md).
