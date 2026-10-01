# Security and integrity

This application does not fabricate completion, watch time, attendance, heartbeats, webcam or facial verification. It does not bypass CAPTCHA, anti-bot controls, server-side validation, or participation requirements.

Production answers require human confirmation. Autosubmit requires both `AUTO_SUBMIT=true` and an explicit hostname in `AUTOSUBMIT_ALLOWED_HOSTS`; the included fake LMS is the intended local target. Credentials and authenticated browser data must be supplied through environment variables or the browser’s normal login flow and are redacted from logs.
