# Render deployment checklist

Do not deploy until the fake-LMS long-run, recovery, persistence, and Docker checks are complete.

## Required variables

- `DATABASE_URL` — Render PostgreSQL connection string.
- `LMS_BASE_URL` and `LMS_LOGIN_URL` — the user-authorized LMS endpoints.
- `DASHBOARD_USERNAME` and `DASHBOARD_PASSWORD` — management endpoint access.

## Optional variables

- `RUNNER_DATA_DIR=/data` — persistent browser-state directory.
- `GEMINI_API_KEY`, `GEMINI_MODEL`, or another future supported provider configuration.
- `TELEGRAM_*` — only when notification support is implemented and verified.

## Service checks

- The Docker image is pinned to Playwright 1.63.0, matching the package lock.
- Startup runs `prisma migrate deploy`, then starts the process.
- `/health` intentionally returns `degraded` until database persistence is implemented; it must not be used as proof of database health.
- No secrets are stored in `render.yaml`.

## Current blocker

Docker is unavailable on this development machine, so local image and Render-runtime validation remain untested.
