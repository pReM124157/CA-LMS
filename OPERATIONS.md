# Operations

Start locally with `npm run fake-lms` in one terminal and `npm run dev` in another. Open `http://localhost:3000` and authenticate with dashboard credentials. Start, pause, resume, and stop using the dashboard.

When a session expires, complete login through the normal browser flow, then restart the runner. A deployment shutdown pauses the worker, saves browser storage, and closes Chromium. Do not enable autosubmit for third-party production hosts.
