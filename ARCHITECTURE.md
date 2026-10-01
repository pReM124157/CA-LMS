# LMS Cloud Runner architecture

The runner is a single Node.js service containing an authenticated control API, a Playwright worker, and a PostgreSQL-backed state store. A single database lease prevents two workers from controlling the same browser session.

The browser uses a persistent Playwright context stored under `/data`. On startup it restores that context, verifies the actual LMS page, and resumes only from LMS-visible state. It never fabricates progress, attendance, media time, or completion.

The runner moves through an explicit finite state machine. Every transition is persisted as a `RunnerEvent`. The adapter layer isolates generic LMS discovery from orchestration. The included fake LMS is the sole default autosubmit target; all other hosts require an operator confirmation.

Question flow: detector polls frames for an accessible dialog/question, parser extracts labels and stable option identifiers, solver validates AI JSON, then a dashboard/notification requests confirmation. The auto-submit policy allows submission only when `AUTO_SUBMIT=true` and the page hostname is explicitly allowlisted.

Recovery is conservative: browser/page failure returns the runner to recovery, reloads the lesson, and rechecks the LMS UI. The service captures sanitized structured logs and optional debug screenshots. Secrets, cookies, tokens and passwords are redacted before logging.
