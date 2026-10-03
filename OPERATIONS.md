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
