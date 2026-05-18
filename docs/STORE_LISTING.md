# Chrome Web Store Listing Draft

## Name

Event Extractor to Google Calendar

## Short description

Extract event details from web pages and create Google Calendar events after review.

## Detailed description

Event Extractor to Google Calendar helps you turn event pages, ticket pages, and selected text into Google Calendar events.

Open the extension on a page, review the extracted event candidates, choose the correct event, and create it in your selected Google Calendar. The extension keeps the review step in your hands, so you can adjust the title, date, time, location, timezone, and description before anything is created.

Key features:

- Extract event candidates from the current page.
- Review and edit details before creating calendar events.
- Quickly select only the event you want.
- Choose the target Google Calendar.
- Check possible duplicates before creating.
- Open the created event day directly in Google Calendar.
- Supports selected-text extraction from the right-click menu.

Privacy summary:

The extension processes the current page only when you request extraction. It sends extraction payloads to the configured backend to identify event details. Google Calendar access is used only to list writable calendars, check nearby events, and create events that you approve.

This is an open-source project:

https://github.com/LOSU-369/calendar-plugin

## Single purpose

Extract event details from user-selected web pages or selected text and create Google Calendar events after explicit user review.

## Permission justifications

### activeTab

Used to access the current tab only after the user opens the extension or triggers extraction.

### scripting

Used to run the content extraction script on the active tab when the user requests a scan.

### storage

Used to save extension settings, selected target calendar, and the latest pending review session locally.

### tabs

Used to identify the active tab, read page metadata needed for the review session, and open the full review page when extraction is triggered from selected text.

### contextMenus

Used to add a right-click action for extracting event details from selected text.

### identity

Used for Google OAuth through Chrome Identity so the extension can list calendars and create events after user approval.

### host permission: <all_urls>

Used because event details can appear on many event, ticket, venue, and article sites. The extension scans page content only after user action.

### host permission: https://www.googleapis.com/*

Used to call the Google Calendar API after user authentication.

## Data usage disclosure draft

Data collected or processed:

- Website content: visible page text, selected text, source URL, and temporary visible-area screenshot for event extraction.
- Authentication information: Google OAuth token handled by Chrome Identity.
- User activity within the extension: selected calendar, settings, and pending review session.
- Calendar data: writable calendar list and nearby events used for duplicate checks.

Data use:

- Provide event extraction and calendar creation features.
- Improve event extraction results through backend parsing.
- Do not sell data or use it for ads.

## Screenshot plan

Use screenshots at 1280x800 or 640x400:

1. Popup showing compact event candidates.
2. Expanded event review form.
3. Successful creation with Google Calendar day link.
4. Target calendar picker.
5. Options page with backend/timezone settings.
