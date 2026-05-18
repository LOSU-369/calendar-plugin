# Privacy Policy

Effective date: May 18, 2026

Event Extractor to Google Calendar helps users extract event details from a web page and create Google Calendar events after user review and confirmation.

## Data the extension handles

The extension may process the following data when you use it:

- The visible text from the current browser tab.
- A temporary screenshot of the visible page area, used only to improve event extraction.
- Text that you explicitly select and send through the context menu.
- Event candidate details shown for review, such as title, date, time, location, description, source URL, and confidence/duplicate hints.
- Google Calendar account information required to list writable calendars and create events in the calendar you choose.
- Extension settings stored locally, such as backend URL, timezone, locale, debug mode, and selected target calendar.

## How data is used

The extension uses page content only to extract event candidates and show them to you for review. It creates Google Calendar events only after you click the create button.

Google Calendar access is used only to:

- Request an OAuth token through Chrome Identity.
- List writable calendars so you can choose a target calendar.
- Check nearby events for possible duplicates.
- Create events in the calendar you selected.

## Data sharing

The extension sends event extraction payloads to the configured backend service. The payload can include visible page text, selected text, page metadata, source URL, and a temporary visible-area screenshot.

If the backend is configured with an OpenAI API key and local parsing does not find candidates, the backend may send the extraction payload to OpenAI for AI-assisted parsing.

The extension does not sell user data and does not use user data for advertising, credit-worthiness, or unrelated profiling.

## Storage and retention

The extension stores settings and the latest pending review session in `chrome.storage.local` on your device. It does not intentionally store Google Calendar event contents on a remote server.

Backend operators should avoid retaining request payloads unless needed for debugging with user consent. If logs are enabled in a deployment, they should avoid storing page text, screenshots, OAuth tokens, or calendar contents.

## Security

Google Calendar authentication is handled through Chrome Identity and Google OAuth. The extension does not store Google passwords. Production backend deployments should use HTTPS.

## Google API Limited Use

The use of information received from Google APIs will adhere to the Chrome Web Store User Data Policy, including the Limited Use requirements.

## Your choices

You can:

- Review and edit extracted event details before creating events.
- Unselect event candidates you do not want to create.
- Change the target calendar in the extension UI.
- Change backend and timezone settings in the options page.
- Revoke the app's Google access from your Google Account permissions page.
- Remove locally stored extension data by uninstalling the extension or clearing extension storage.

## Contact

For questions or issues, open an issue at:

https://github.com/LOSU-369/calendar-plugin/issues
