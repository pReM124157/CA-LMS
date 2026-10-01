# YouTube remote-CDP compatibility

`youtube_test` reads only `window.__YT_TEST_STATE__` from the controlled parent page. It does not enumerate frames, use frame locators, access iframe content, or subscribe to YouTube iframe events from Playwright.

The remote connection uses `connectOverCDP(..., { noDefaults: true })` to avoid applying Playwright default-context overrides to the provider-owned browser context. If Playwright throws an internal process assertion while the provider attaches an OOPIF, the service treats the browser state as corrupted: it logs a redacted `PLAYWRIGHT_INTERNAL_FAILURE`, clears browser references, closes safely where possible, and exits for Render to restart. It must not continue the canary with that process.

No low-level CDP fallback is enabled: an assertion within Playwright frame attachment happens during its CDP connection lifecycle, before a safe Playwright-backed session exists. A raw CDP fallback would be a separate control stack requiring provider-specific validation, and is intentionally not introduced without a reproducible provider test.
