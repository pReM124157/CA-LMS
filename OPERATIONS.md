# Operations

Start locally with `npm run fake-lms` in one terminal and `npm run dev` in another. Open `http://localhost:3000` and authenticate with dashboard credentials. Start, pause, resume, and stop using the dashboard.

When a session expires, complete login through the normal browser flow, then restart the runner. A deployment shutdown pauses the worker, saves browser storage, and closes Chromium. Do not enable autosubmit for third-party production hosts.

### Controlled HLS compatibility canary

Set `TARGET_MODE=hls_test`, `HLS_TEST_URL` to an operator-selected public HTTPS
`.m3u8` manifest, and `HLS_TEST_MAX_SECONDS=20` (default). Point `LMS_BASE_URL`
to your deployed fake-LMS service, which serves `/hls-test` and a locally bundled
hls.js script. Deploy both services from this revision. The stream must permit
cross-origin access for hls.js; codec support depends on the connected browser.
No default external stream is selected.

The runner passes the source through CDP into the dedicated page, never through
its navigation query string. Native HLS is preferred; hls.js uses Media Source
Extensions otherwise. Status samples the real HTMLVideoElement, including
`readyState` and `networkState`. The `hls.sourceUrlHost` field contains only the
hostname; source paths, signatures, and query parameters are omitted from status
and runner error logs.

Observed currentTime progression is required. Native ended completes once;
otherwise the elapsed canary limit pauses the actual video and reports
`PLAYBACK_VERIFIED`. A ten-second interval without advancement fails with
`HLS_PLAYBACK_NOT_ADVANCING`. Fatal errors stop polling with a structured code.
COMPLETED and ERROR remain terminal for the runner instance; restart the runner
service for a fresh run. HLS mode disables all question submission flows and is
for controlled compatibility testing only.

### ICAI login-only compatibility canary

Set `TARGET_MODE=icai_test`, `ICAI_SRN` to your authorized SRN, and optionally
`ICAI_LOGIN_URL` (default `https://lms.icai.org/login`). The URL must use exactly
the `https://lms.icai.org` origin without embedded credentials. This mode forces
`AUTO_SUBMIT=false` and `REQUIRE_HUMAN_CONFIRMATION=true` regardless of configured
values. It uses the existing browser backend, including Browserless CDP.

Start opens the configured login page and uses the site's normal SRN/OTP controls.
It stops at `OTP_REQUIRED` with no polling timer. Submit the human-received OTP
through authenticated `POST /api/icai/otp` with JSON `{"otp":"123456"}`. The OTP
must be a string of 4–8 digits. Avoid putting real OTPs in shell command history.
The endpoint uses existing dashboard Basic Auth and returns `Cache-Control:
no-store`. It removes the OTP from the parsed request body and retains no runner
OTP field or database record. The adapter clears any remaining visible OTP input
after the operation. A lost browser session fails instead of opening a new session.

Selectors prefer accessible textbox names, labels, and placeholders, then
SRN/OTP name/id attributes and `autocomplete=one-time-code`. Controls use button
and link roles with normal Login with OTP, Send/Request OTP, Verify, Login, and
Submit names. Authentication requires dashboard heading/navigation evidence,
a visible Logout/Sign out control, and disappearance of the OTP input, all on
the ICAI origin. URL changes alone do not prove login.

Success transitions `OTP_REQUIRED → DASHBOARD → PAUSED` and stops. Start/Resume
will not resend OTP or advance the authenticated session. Inspect the dashboard
manually. No course, lecture, video, question, webcam, attendance, or completion
controls are automated. Security challenges are left intact; unsupported layouts
or an unconfirmed login fail after bounded waits. Restart the service for a new
attempt after a terminal error.

Status exposes only `icai.stage`, `srnConfigured`, `loginOrigin`, structured error
codes, and (only when controls are missing) bounded diagnostic metadata. Diagnostics
contain input type/name/id/placeholder/associated labels and visible control text,
with configured SRN/OTP and recognizable numeric secrets redacted. They never read
input values, cookies, headers, or browser storage. Raw Playwright errors are not
returned or logged. SRN/OTP fields are also covered by logger redaction.

The automated ICAI tests use intercepted browser fixtures and send no live OTP
requests. Real ICAI layout and live authentication require a separate authorized
operator canary; they are not established by the fixture tests.
