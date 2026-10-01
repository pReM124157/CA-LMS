# Fake LMS Render canary deployment

Create a second Render Web Service from `pReM124157/CA-LMS`, branch `main`.

- Runtime: **Node** (22.x)
- Build command: `npm ci --include=dev && npm run build`
- Start command: `npm run start:fake-lms`
- Health path: `/health`
- Plan: Free is acceptable for canary testing.

After it is live, set the main service secrets to its public URL:

```text
LMS_BASE_URL=https://<fake-lms-service>.onrender.com
LMS_LOGIN_URL=https://<fake-lms-service>.onrender.com/login
```

This is a controlled test environment only. Do not configure real-LMS credentials or disable the main service's human-confirmation policy.
