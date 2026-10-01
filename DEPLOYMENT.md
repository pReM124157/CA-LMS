# Deployment

Set required secrets in Render: `DATABASE_URL`, dashboard credentials, LMS URLs, and optionally AI provider credentials. Attach persistent storage at `/data` when offered. Run `npx prisma migrate deploy` as the release migration step. The provided `render.yaml` provisions a web service and PostgreSQL; it intentionally contains no secrets.
