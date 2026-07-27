# HubSpot configuration

**Who this is for:** Developers (or HubSpot admins working with a developer) when pipeline stages, property names, or association labels change.

Portal wiring for this app lives in **`config/hubspot.json`**. It is committed to git — it is not secret. Only API keys and email secrets stay in `.env.local` / Vercel (see `.env.template`).

## What lives here

| Section | Purpose |
|---------|---------|
| `training` | Custom training object ID, properties fetched from HubSpot, schedule/cutoff field names |
| `associations` | Contact → training labels (`registrant`, `unregistered`, `waitlist`, optional type IDs) |
| `programs.mhfa` / `programs.qpr` | Pipeline type, open stage, and closed-for-registration stage IDs |
| `contactProperties` | Maps signup form fields to HubSpot contact property internal names |
| `smsConsent` | SMS consent property name and yes/no option values |
| `signupWorkflowFlag` | Contact property + value set on every training signup (for HubSpot workflow enrollment) |
| `unregister.mode` | `remove` or `relabel` after cancellation (see `UNREGISTER.md`) |

Loaded by `src/lib/hubspot/config.ts`. Do not duplicate these values in environment variables.

## Common changes

### Events not showing on `/mhfa` or `/qpr`

1. In HubSpot, open a training record and note `hs_pipeline` and `hs_pipeline_stage` IDs.
2. Update `programs.mhfa` or `programs.qpr` in `hubspot.json` so `pipelineType`, `pipelineStage`, and `closedPipelineStage` match.
3. Commit, push, deploy.

### Signup form field not saving to HubSpot

1. In HubSpot → Settings → Properties → Contact, find the property’s **internal name**.
2. Update the matching key under `contactProperties` in `hubspot.json`.
3. Deploy.

### Unregister / association label errors

1. Confirm labels exist in HubSpot (Settings → Objects → Training → Associations).
2. Update `associations.registrant` and `associations.cancelled` to match HubSpot internal names.
3. If v4 API needs numeric type IDs, add `registrantTypeId` / `cancelledTypeId` under `associations`.

### Adding a property to training fetches

Add the HubSpot internal name to `training.properties` (e.g. a new datetime field used on event pages).

## After editing

```bash
npm test
npm run build
```

Deploy to Vercel. No env var changes needed unless you only rotated secrets.

## Related docs

- [`MAINTENANCE.md`](../MAINTENANCE.md) — ops runbook
- [`UNREGISTER.md`](../UNREGISTER.md) — cancel registration flow
- [`content/README.md`](../content/README.md) — user-facing copy (not HubSpot wiring)
