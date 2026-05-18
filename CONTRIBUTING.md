# Contributing

Thanks for improving Event Extractor to Google Calendar.

## Development setup

Install and run the backend:

```bash
cd backend
npm install
cp .env.example .env
npm run dev
```

Build and load the extension:

```bash
cd extension
npm install
npm run build
```

Then open `chrome://extensions`, enable Developer mode, choose `Load unpacked`, and select `extension/dist`.

## Pull request checklist

- Keep permissions and OAuth scopes as narrow as possible.
- Do not commit real `.env` files, API keys, OAuth tokens, screenshots with private data, or calendar contents.
- Run `npm.cmd run typecheck` and `npm.cmd run build` in `extension`.
- Run backend checks when changing backend code.
- Update README or privacy notes when data handling changes.

## Code style

- Prefer the existing React and TypeScript patterns.
- Keep extension UI compact and review-first.
- Do not add remote executable code to the extension.
