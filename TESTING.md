# Testing

## Automated tests (Vitest)

Run the full unit and API test suite:

```bash
npm test
```

Watch mode during development:

```bash
npm run test:watch
```

### What is covered

| Area | Test file |
|------|-----------|
| Form normalization (names, email, phone, HubSpot yes/no) | `src/lib/signup/format-fields.test.ts` |
| Event list sorting | `src/lib/programs/sort.test.ts` |
| HubSpot field mappers (SMS consent IDs, association parsing) | `src/lib/hubspot/field-mappers.test.ts` |
| HubSpot config (`config/hubspot.json` loads correctly) | `src/lib/hubspot/config.test.ts` |
| Training object → app event mapping | `src/lib/programs/events.test.ts` |
| Program config (MHFA/QPR pipelines from config) | `src/lib/programs/config.test.ts` |
| Schedule / event end date helpers | `src/lib/dates/format-schedule.test.ts` |
| Unregister token signing | `src/lib/unregister/token.test.ts` |
| One-active signup rule (program scope, end date) | `src/lib/signup/active-registration.test.ts` |
| Signup API validation and error paths (mocked HubSpot) | `src/app/api/signup/route.test.ts` |

Shared signup payloads live in `src/test/fixtures/signup.ts`.

### Adding tests

- Prefer testing **pure functions** in `src/lib/` without network calls.
- For API routes, **mock** `@/lib/hubspot/api` and `@/lib/programs/events` (see `route.test.ts`).
- Do not call the real HubSpot API in CI or local `npm test`.

---

## Manual / integration testing (HubSpot)

Requires `.env.local` with at least:

```env
HUBSPOT_API_KEY=...
UNREGISTER_TOKEN_SECRET=...
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Optional for real emails: `RESEND_API_KEY`, `RESEND_FROM_EMAIL`.

Pipeline and property wiring comes from **`config/hubspot.json`** (not env vars).

### Signup

1. `npm run dev`
2. Open `/mhfa` or `/qpr` (root `/` redirects to the marketing site)
3. Confirm events load from HubSpot (not empty unless pipeline stage in `config/hubspot.json` is wrong)
4. Open an event → submit the form with a **new** email
5. Confirm redirect to `/{program}/events/{id}/success`
6. Check confirmation email (or server console log in dev)
7. Submit again with the **same** email → should show “already registered” (409)
8. Try a **different** open session in the **same** program → blocked (whether registered or waitlisted elsewhere)
9. After that session’s end datetime (day 2 if present, else day 1), signup for another session in the same program should succeed
10. An active MHFA registration/waitlist should **not** block QPR signup (and vice versa)
11. In HubSpot, verify contact properties and `registrant` training association

### Unregister

1. Open `/unregister?program=mhfa`
2. Enter email with an active registration → **Check for Registrations** → session appears
3. **Email me a confirmation link** → open link → **Yes, cancel my registration**
4. In HubSpot: `registrant` removed (or `unregistered` label if `relabel` mode)
5. Sign up again with same email → should succeed (no duplicate-label issue)
6. Past trainings should **not** appear in unregister lookup

### Pipeline troubleshooting

If no events appear, compare HubSpot training `hs_pipeline_stage` IDs with `programs.mhfa` / `programs.qpr` in **`config/hubspot.json`**.

---

## Removed dev-only surfaces

The following were removed in favor of automated tests and real HubSpot manual checks:

- `/preview` UI page
- `/api/mock-signup`
- In-memory `_mockData` and mock event fallback
