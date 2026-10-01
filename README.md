# LMS Cloud Runner

A safety-constrained Playwright LMS assistant. It navigates a compatible LMS, uses normal player controls, detects questions, recommends an answer, and waits for confirmation on non-allowlisted hosts. It never fakes completion or bypasses LMS protections.

## Verified status

Working: persistent Playwright browser control, local fake-LMS navigation, question detection and parsing, human-confirmed answer submission, host-gated autosubmit policy, state transitions, and lint/type/unit/browser-integration checks.

Not yet verified: PostgreSQL persistence and runner leases, recovery after crashes, real-LMS selectors, long-duration stability, Docker image execution, and Render deployment. Do not treat this as production-ready until those checks are complete.

## Quick start

1. `cp .env.example .env`
2. `npm install && npx playwright install chromium && npx prisma generate`
3. Start PostgreSQL with `docker compose up postgres -d` and run `npm run prisma:migrate`.
4. In separate terminals run `npm run fake-lms` and `npm run dev`.
5. Visit `http://localhost:3000`.

The fake LMS is a controlled development target. Set `AUTO_SUBMIT=true` only for it or another explicitly user-controlled staging hostname. See [SECURITY.md](SECURITY.md), [ARCHITECTURE.md](ARCHITECTURE.md), and [OPERATIONS.md](OPERATIONS.md).

For the native Render + remote-browser route, see [RENDER_NO_DOCKER_DEPLOYMENT.md](RENDER_NO_DOCKER_DEPLOYMENT.md). It is documented for staged deployment only; this project must not be deployed as a production LMS worker yet.
