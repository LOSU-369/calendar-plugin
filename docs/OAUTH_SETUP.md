# Google OAuth Setup

This extension uses Chrome Identity and Google Calendar API.

## Local development

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Load `extension/dist`.
4. Copy the local extension ID.
5. In Google Cloud Console, create an OAuth client of type `Chrome Extension`.
6. Paste the local extension ID.
7. Copy the generated OAuth client ID.
8. Put it into both manifest files:
   - `extension/manifest.json`
   - `extension/public/manifest.json`
9. Rebuild the extension.

## Chrome Web Store release

The published extension may have a different extension ID than the local unpacked extension. After creating the item in the Chrome Web Store dashboard, confirm the published item ID and create or update the Google OAuth Chrome Extension client for that ID.

Then update the manifest `oauth2.client_id`, rebuild, package, and upload the final release ZIP.

## Required APIs and scopes

Enable Google Calendar API in the Google Cloud project.

The extension currently requests:

- `https://www.googleapis.com/auth/calendar.events`
- `https://www.googleapis.com/auth/calendar.calendarlist.readonly`

These scopes are used to list writable calendars, check nearby events, and create events after user confirmation.
