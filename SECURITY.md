# Security Policy

## Reporting a vulnerability

Please do **not** open a public GitHub issue for security vulnerabilities.

Instead, report privately using GitHub's **"Report a vulnerability"** feature under the repository's **Security** tab (Security Advisories). Include:

- A description of the issue and its impact.
- Steps to reproduce or a proof of concept.
- Affected version (see the extension version in `manifest`/`package.json`).

We will acknowledge your report, investigate, and coordinate a fix and disclosure timeline with you.

## Scope and data-handling notes

This extension observes authenticated web traffic on sites the user chooses, and it talks to a user-configured AI provider. When evaluating or reporting issues, note the intended security model:

- The AI configuration, including the API key, is stored in `chrome.storage.local` and is only transmitted to the AI endpoint the user configures.
- Captured request data is stored in `chrome.storage.session` and cleared when the service worker unloads.
- Only a compact, masked summary of captured API responses is sent to the AI provider — not raw cookies, `Authorization` headers, or full bodies.
- The locally generated HTML export may contain raw request data and is never uploaded; it is the user's responsibility to handle that file securely.

Reports about strengthening data minimization, masking, or storage access scope are welcome.

## Supported versions

Security fixes target the latest released version. Please upgrade to the newest version before reporting.
