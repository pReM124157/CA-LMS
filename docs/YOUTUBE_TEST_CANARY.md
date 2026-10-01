# Controlled YouTube playback canary

This mode tests external streaming only. It does not navigate to an LMS, scan courses, parse questions, or submit answers.

1. Choose a harmless, public, embeddable YouTube video.
2. Copy only its 11-character video ID.
3. In Render set `TARGET_MODE=youtube_test`, `YOUTUBE_TEST_VIDEO_ID=<id>`, and optionally `YOUTUBE_TEST_MAX_SECONDS=60`.
4. Deploy, then authenticated `POST /api/runner/start`.
5. Read `GET /api/status`; confirm `youtube.ready`, `youtube.currentTime`, and `youtube.advancing`.
6. Optionally wait for native YouTube completion, then `POST /api/runner/stop`.
7. Restore `TARGET_MODE=fake` after testing.

Some public videos are unavailable, region-blocked, age-restricted, or embedding-disabled. Select another operator-approved public test video if the iframe reports an error.
