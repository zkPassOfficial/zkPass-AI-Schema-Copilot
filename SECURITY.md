# Security Policy

## Reporting a vulnerability

Please do **not** open a public GitHub issue for security vulnerabilities.

Instead, report privately using GitHub's **"Report a vulnerability"** feature under the repository's **Security** tab (Security Advisories). Include:

- A description of the issue and its impact.
- Steps to reproduce or a proof of concept.
- Affected version (see the extension version in `manifest`/`package.json`).

We will acknowledge your report, investigate, and coordinate a fix and disclosure timeline with you.

## Scope and data-handling notes

This extension can capture authenticated traffic across eligible tabs through broad background listeners and talks to a user-configured AI provider. Evaluate the implemented boundaries, not an assumption that capture is restricted to the selected tab:

- AI configuration, including the API key, is stored in `chrome.storage.local` and used for provider requests. The storage is not an encrypted credential vault; provider/proxy handling is outside this review.
- Captures and scratchpads use `chrome.storage.session`; service-worker suspension does not itself clear it. Chrome clears this area on extension disable/reload/update or browser restart. See the [official storage lifecycle](https://developer.chrome.com/docs/extensions/reference/api/storage#session). Application cleanup paths still need verification.
- The analysis prompt summary omits direct capture headers/bodies, but includes URLs, selected samples, lookup hints, user intent, and conversation history. Heuristic masking does not guarantee that these inputs contain no sensitive information.
- The HTML export is generated locally and can contain raw request data; handle it as sensitive. Other actions separately send LLM prompts, lookup requests, schemas, or SDK verification traffic.
- Request replay can include the original method/body and page credentials and may repeat write effects. Do not evaluate capture against sensitive or production workflows without explicit authorization.

Reports about strengthening data minimization, masking, or storage access scope are welcome.

## Supported versions

Security fixes target the latest released version. Please upgrade to the newest version before reporting.

## Verification scope

No security test, browser capture, provider request, or live verification was performed for this documentation review. Private-reporting instructions and support policy above are preserved; availability of GitHub private vulnerability reporting for this repository was not checked. Do not include live credentials, private captures, or personal data in a report; use a minimized synthetic reproduction where possible.
