# End-to-end tests (spec §16 critical path)

Not yet implemented. This directory + `playwright.config.ts` are wired so the
suite can be added without further setup.

## Critical path to cover
1. Install / authenticated app fixture.
2. Complete onboarding (default location, catalog sync).
3. Add a supplier (manual CSV).
4. Upload `fixtures/sample-supplier-feed.csv`.
5. Map columns; see the 20-row normalized preview.
6. Review exact matches; manually map one unmatched row on `/app/mappings`.
7. Configure a pricing rule.
8. Generate the preview (run the feed).
9. Confirm `ABC-102` / `ABC-103` / `ABC-104` are **blocked**; matched rows **safe**.
10. Approve the safe changes.
11. Observe `completed` / `partially_completed`.
12. Verify the audit history (`AuditEvent` rows) and that a replay does not
    re-apply succeeded `ChangeItem`s.

## Prerequisites
- Web + worker running against a test Postgres/Redis.
- A development store with matching and non-matching SKUs.
- An authenticated session (offline token) seeded into the `Session` table, or a
  Playwright storage-state captured after a manual install.
- `E2E_BASE_URL` pointed at the running web process.
