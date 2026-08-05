# Maintenance guide (TCF Event Signup Site)

Plain-language reference for **non-developers** and developers. Technical details also live in `PLANNING.md`, `TESTING.md`, and `UNREGISTER.md`.

---

## What this site does

- Public signup for **MHFA** and **QPR** training sessions.
- **HubSpot** stores events (trainings), contacts, and registrations.
- **Resend** sends signup confirmation and unregister confirmation emails (when configured).
- There is **no admin panel** on this site — use HubSpot for event and contact management.

### Public URLs

| URL | Purpose |
|-----|---------|
| `/` | Redirects to the main TCF marketing page (`content/site.json` → `homeRedirectUrl`) |
| `/mhfa` | MHFA event list |
| `/qpr` | QPR event list |
| `/mhfa/events/{id}` | MHFA event detail + signup |
| `/qpr/events/{id}` | QPR event detail + signup |
| `/unregister` | Cancel a registration (lookup by email, then email confirmation link) |
| `/unregister/confirm?token=...` | Confirm cancellation (from email link) |

Link directly to `/mhfa` or `/qpr` from HubSpot or marketing pages.

---

## Changing wording (no code required)

**Edit JSON in the `content/` folder** — see [`content/README.md`](content/README.md).

| Change | File |
|--------|------|
| Footer, logo, main site link, page title, SMS policy links | `content/site.json` |
| Signup form labels, messages, confirmation email copy | `content/signup-form.json` |
| Event cards, event page, success page, unregister page wording | `content/pages.json` |
| MHFA intro / signup notice / success steps | `content/programs/mhfa.json` |
| QPR intro / signup notice / success steps | `content/programs/qpr.json` |

After editing: save, commit, push, and wait for Vercel to deploy (or ask a developer to deploy).

**Do not edit** `src/components/...` for routine copy — those read from `content/`.

---

## Changing HubSpot wiring (developers)

Pipeline stages, contact property names, association labels, and similar **portal-specific IDs** live in **`config/hubspot.json`** (not environment variables).

See [`config/README.md`](config/README.md) for section-by-section guidance.

Typical tasks:

| Task | Where to edit |
|------|----------------|
| MHFA/QPR pipeline or stage IDs | `config/hubspot.json` → `programs` |
| Contact field → HubSpot property mapping | `config/hubspot.json` → `contactProperties` |
| Registrant / unregistered association labels | `config/hubspot.json` → `associations` |
| Unregister: delete link vs keep audit label | `config/hubspot.json` → `unregister.mode` |

Commit and deploy after changes. Run `npm test` before pushing.

---

## Changing events (HubSpot)

Events on `/mhfa` and `/qpr` come from **HubSpot training records**, filtered by pipeline stage/type in `config/hubspot.json`.

In HubSpot you typically control:

- Title, dates, location
- Capacity and how many seats remain (`available_capacity` or equivalent property)
- Whether the session appears on the site (pipeline stage must match `programs.*.pipelineStage`)
- Whether registration is closed (move to `closedPipelineStage` or set `cutoff_time`)

If **no events show**:

1. Confirm trainings exist in HubSpot.
2. Compare the training’s `hs_pipeline_stage` ID to `programs.mhfa.pipelineStage` or `programs.qpr.pipelineStage` in `config/hubspot.json` (or ask a developer).
3. Trainings on the **closed** stage (`closedPipelineStage`) stay listed but show “Registration Closed” instead of “Full”.

---

## Confirmation & cancellation emails

Sent by the app via **Resend** when `RESEND_API_KEY` and `RESEND_FROM_EMAIL` are set in Vercel / `.env.local`.

| Email | When | Link behavior |
|-------|------|----------------|
| **Signup confirmation** | After successful registration | Includes a signed link to `/unregister/confirm?token=...` (valid until the training session ends) |
| **Unregister confirmation** | After user requests cancellation on `/unregister` | Link to `/unregister/confirm?token=...` (same expiry rule) |

Email **copy** for signup: `content/signup-form.json` → `confirmationEmail`.  
Unregister page copy: `content/pages.json` → `unregister`.

In local dev without Resend configured, email bodies (including links) are **logged to the server console**.

You do not need a separate HubSpot workflow for these transactional emails unless the team wants duplicate notifications from HubSpot as well.

---

## Cancel registration (`/unregister`)

Summary for staff:

1. User opens `/unregister`, picks program, enters email, clicks **Check for Registrations**.
2. If registrations exist, they pick a session and click **Email me a confirmation link**.
3. They open the email link and click **Yes, cancel my registration**.
4. Past sessions (after training end date) do not appear and cannot be cancelled online.

Full technical flow: [`UNREGISTER.md`](UNREGISTER.md).

---

## Testing after changes

### Copy-only changes (`content/`)

A developer runs `npm run dev` and checks `/mhfa`, `/qpr`, and `/unregister`.

### HubSpot config changes (`config/hubspot.json`)

```bash
npm test
npm run build
```

Then manual check: events load, signup works, unregister lookup finds the right sessions.

### Before a production release

See [`TESTING.md`](TESTING.md):

```bash
npm test          # automated checks (no real HubSpot calls)
```

Manual check with real HubSpot (valid `.env.local`):

1. `npm run dev`
2. Open `/mhfa` — events load
3. Submit signup with a **new** email → success page + confirmation email (or console log)
4. Submit again with same email → “already registered”
5. Different session same program → blocked until cancel or session end; other program still allowed
6. Verify contact + training link in HubSpot
7. `/unregister` → find registration → receive cancel link → confirm → registrant removed (or relabeled)

---

## Environment variables (secrets & deployment only)

Never commit secrets. Developers maintain these in Vercel and local `.env.local`. Template: `.env.template`.

| Variable | Purpose |
|----------|---------|
| `HUBSPOT_API_KEY` | HubSpot private app token |
| `UNREGISTER_TOKEN_SECRET` | Signs unregister confirmation links (long random string) |
| `RESEND_API_KEY` | Resend API key for transactional email |
| `RESEND_FROM_EMAIL` | From address for signup and unregister emails |
| `NEXT_PUBLIC_APP_URL` | Public site URL used in email links (e.g. `https://signup.example.com`) |

**Everything else** (pipelines, property names, association labels) is in **`config/hubspot.json`**.

---

## Deploy

Hosted on **Vercel** (typical flow):

1. Merge changes to the main branch.
2. Vercel builds and deploys automatically.
3. Confirm `/mhfa`, `/qpr`, and `/unregister` after deploy.

Developers: `npm run build` locally to catch build errors before push.

---

## Adding a form field (developer task)

1. `src/lib/signup/format-fields.ts` — data type + formatting
2. `src/components/signup/EventSignupForm.tsx` — UI
3. `src/app/api/signup/route.ts` — required-field validation
4. `config/hubspot.json` → `contactProperties` — HubSpot property internal name
5. `src/lib/hubspot/api.ts` — `mapContactProperties()` if a new mapping key is needed
6. `src/lib/signup/profile-store.ts` — if it should autofill
7. `src/test/fixtures/signup.ts` + tests

See `PLANNING.md` → “Adding form fields” for more detail.

---

## Adding a new training program (developer task)

Example: a third program beyond MHFA/QPR.

1. Add `content/programs/{id}.json` and wire it in `src/lib/content/index.ts`.
2. Add program to `src/lib/programs/config.ts` (`TRAINING_PROGRAMS`, `isTrainingProgramId`).
3. Add `programs.{id}` block in `config/hubspot.json` with pipeline IDs.
4. Update tests and this URL table.

---

## Branding (logo, favicon, nav)

- **Logo image:** add file to `public/` (developer), then set `content/site.json` → `logo.imageSrc` (e.g. `"/logo.png"`). Text fallback: `logo.text`.
- **Nav links:** edit `content/site.json` → `nav` array, e.g. `{ "label": "Main site", "href": "https://..." }`.
- **Favicon:** add `public/favicon.ico` (developer).

---

## Getting help

| Question | Where to look |
|----------|----------------|
| Product decisions & roadmap | `PLANNING.md` |
| Original requirements | `REQUIREMENTS.md` |
| Automated / manual tests | `TESTING.md` |
| Edit page copy | `content/README.md` |
| HubSpot IDs & property names | `config/README.md` |
| Cancel registration | `UNREGISTER.md` |
