# Browser Event Extractor (Chrome/Edge) + Backend

## Project structure

```text
.
├─ extension/
│  ├─ manifest.json
│  ├─ package.json
│  ├─ tsconfig.json
│  ├─ vite.config.ts
│  ├─ public/
│  │  └─ manifest.json
│  └─ src/
│     ├─ background/
│     │  └─ service-worker.ts
│     ├─ content/
│     │  └─ content-script.ts
│     ├─ popup/
│     │  ├─ index.html
│     │  ├─ main.tsx
│     │  ├─ ReviewApp.tsx
│     │  └─ styles.css
│     ├─ review/
│     │  ├─ index.html
│     │  └─ main.tsx
│     ├─ options/
│     │  ├─ index.html
│     │  └─ main.tsx
│     ├─ lib/
│     │  ├─ backend-api.ts
│     │  ├─ background-client.ts
│     │  ├─ chrome-async.ts
│     │  ├─ dedupe.ts
│     │  ├─ google-calendar.ts
│     │  └─ storage.ts
│     └─ types/
│        └─ index.ts
└─ backend/
   ├─ .env.example
   ├─ package.json
   ├─ tsconfig.json
   └─ src/
      ├─ index.ts
      ├─ routes/
      │  └─ extract.ts
      ├─ services/
      │  └─ extract-service.ts
      ├─ parsers/
      │  └─ rule-parser.ts
      ├─ providers/
      │  └─ ai-provider.ts
      ├─ schemas/
      │  └─ extract.ts
      └─ utils/
         └─ date-time.ts
```

## 1) Start backend

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

## 2) Start extension build

```bash
cd extension
npm install
npm run build
```

Then load extension in Chrome/Edge:

1. Open `chrome://extensions` (or `edge://extensions`)
2. Enable Developer mode
3. Click `Load unpacked`
4. Select folder: `extension/dist`

## 3) Google OAuth setup (required)

1. Create Google Cloud project
2. Enable Google Calendar API
3. Configure OAuth consent screen
4. Create OAuth Client ID for Chrome Extension
5. Put that client ID into:
   - `extension/manifest.json` -> `oauth2.client_id`
   - `extension/public/manifest.json` -> `oauth2.client_id`
6. Rebuild extension: `npm run build`

## 4) Backend environment variables

`backend/.env`:

- `PORT`: backend port (default `8787`)
- `OPENAI_API_KEY`: optional, used for AI fallback parsing
- `OPENAI_MODEL`: optional, default `gpt-4.1-mini`

## 5) Flow implemented

- Click extension popup:
  - Scans current visible viewport text
  - Captures visible area screenshot (temporary, not persisted)
  - Sends payload to backend `/extract`
  - Shows multiple editable candidates
  - User selects events and confirms creation
- Right click selected text:
  - Context menu triggers extraction
  - Opens same review UI (`review.html`)
  - User confirms before creation
- Google Calendar:
  - First use: choose writable calendar
  - Saved in `chrome.storage.local`
  - Can change calendar from popup
- Dedup:
  - Checks nearby events in chosen calendar
  - Marks possible duplicates (does not auto-skip)

## 6) Notes

- Timezone default: `Europe/Zurich`
- Date without time -> all-day
- Start time without end time -> auto end = +2h
- No AI secrets inside extension
- Backend validates I/O with zod
