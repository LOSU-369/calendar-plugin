# Release Checklist

## Before Chrome Web Store upload

- [ ] Confirm the production backend URL is deployed over HTTPS.
- [ ] Set `VITE_BACKEND_BASE_URL` for the extension release build.
- [ ] Confirm Google OAuth consent screen is configured for production.
- [ ] Confirm the OAuth Chrome Extension client ID matches the published extension ID.
- [ ] Confirm `extension/manifest.json` and `extension/public/manifest.json` have the same `oauth2.client_id`.
- [ ] Confirm the privacy policy URL is available publicly.
- [ ] Confirm screenshots and store listing copy are ready.
- [ ] Confirm no real `.env`, API keys, OAuth tokens, private screenshots, or calendar data are committed.
- [ ] Run extension typecheck and build.
- [ ] Package `extension/dist` contents as a ZIP.

## Build

For local testing:

```powershell
cd extension
npm.cmd run build
```

For a store release, set the production backend URL first:

```powershell
$env:VITE_BACKEND_BASE_URL="https://your-production-backend.example.com"
cd extension
npm.cmd run package
```

The release ZIP will be created in `release/`.

## Chrome Web Store dashboard

- Upload the ZIP.
- Fill out store listing copy.
- Fill out privacy practices and permission justifications.
- Add privacy policy URL.
- Upload screenshots and promotional assets.
- Submit as unlisted first for testing.
- Test install from Chrome Web Store.
- Move to public release when OAuth and extension review are clean.
