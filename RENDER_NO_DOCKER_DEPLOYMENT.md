# Native Render deployment with remote Chromium

This deployment model is **GitHub → Render Web Service → remote Chromium → Playwright → LMS**. It does not build or run a local browser in Render and it does not require Docker.

## GitHub setup

Push this project to a private GitHub repository. Do not commit `.env`, browser state, credentials, remote-browser URLs, or API keys. Connect Render to the chosen branch and enable deploys only after the checks below are complete.

## Render and PostgreSQL setup

1. Create a Render PostgreSQL instance.
2. Create a Node Web Service from the GitHub repository.
3. Render reads `render.yaml`: build is `npm ci && npx prisma generate && npm run build`; the pre-deploy migration command is `npx prisma migrate deploy`; start is `npm start`.
4. Add the database's internal connection string as `DATABASE_URL`.

The current runner does not yet persist operational state in PostgreSQL. Do not rely on its local filesystem for critical production state; implement database-backed sessions, questions, events, and a runner lease before production operation.

## Remote browser setup

Create a Browserbase, Browserless, or comparable provider session that supplies a Playwright CDP WebSocket URL. Store that URL only as Render's `REMOTE_BROWSER_WS_URL` secret. It may contain credentials and must never be logged or committed.

With `REMOTE_BROWSER_WS_URL` present, `BrowserManager` uses `chromium.connectOverCDP`. Without it, local development continues to launch local Chromium and runs the fake-LMS browser test.

## Render environment variables

Required now: `DATABASE_URL`, `LMS_BASE_URL`, `LMS_LOGIN_URL`, `REMOTE_BROWSER_WS_URL`, `DASHBOARD_USERNAME`, and `DASHBOARD_PASSWORD`.

Safety defaults: `REQUIRE_HUMAN_CONFIRMATION=true`, `AUTO_SUBMIT=false`, and a restrictive `AUTOSUBMIT_ALLOWED_HOSTS`. Never add a third-party production LMS to the autosubmit list.

Optional future integrations: `GEMINI_API_KEY`, `GEMINI_MODEL`, `TELEGRAM_BOT_TOKEN`, and `TELEGRAM_CHAT_ID`—only once their production implementations are completed and tested.

## First deployment procedure

1. Run `npm run typecheck && npm run lint && npm test && npm run build` locally.
2. Push the reviewed commit to GitHub.
3. Configure all Render secrets in the dashboard, not in Git.
4. Trigger a deploy and check `/health`. It currently returns `degraded` until database health checks exist.
5. Point the runner only at the controlled fake LMS first and verify the remote browser connects.
6. Do not connect a real LMS until a site-specific adapter is reviewed and human confirmation remains enabled.

## Rollback

Use Render's previous-deploy rollback to restore the last known good Git commit. If a migration is incompatible, first restore a database backup or apply an explicit forward migration; do not blindly revert schema history. Disable the runner via its dashboard before rollback when possible.

## Troubleshooting

- **Remote connection fails:** verify the provider CDP URL, session expiry, provider region/network allowlist, and secret configuration. Do not log the full URL.
- **Authentication expires:** complete normal assisted login. CAPTCHA/OTP bypass is unsupported.
- **Service idles/restarts:** Render free services and remote-browser sessions are unsuitable for continuous production work. Use an always-on plan and durable database storage.
- **Migration fails:** run the same `npx prisma migrate deploy` against a staging database first and inspect migration history.
