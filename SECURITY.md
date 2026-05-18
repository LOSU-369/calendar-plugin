# Security Policy

## Supported versions

Security fixes target the latest version on the `main` branch until formal releases are introduced.

## Reporting a vulnerability

Please do not disclose security issues publicly before they are fixed. Open a private GitHub security advisory or contact the maintainer through the repository:

https://github.com/LOSU-369/calendar-plugin/security/advisories

Include:

- A short description of the issue.
- Steps to reproduce.
- Impact and affected component.
- Any suggested fix, if known.

## Security expectations

- Do not commit API keys, OAuth client secrets, Google tokens, screenshots containing private data, or production environment files.
- Keep the backend behind HTTPS in production.
- Use the narrowest Chrome permissions and Google OAuth scopes needed for the feature.
- Avoid retaining page text, screenshots, calendar data, or OAuth tokens in backend logs.
