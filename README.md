# Wedding timeline

Builds wedding-day photography timelines for Mary Anna Photography and publishes each one as a private page for the couple.

- **Builder** (`/admin`): Mary keys in the Dubsado questionnaire answers, adjusts the day, and publishes numbered versions. Protected by Cloudflare Access.
- **Couple's page** (`/t/<token>`): read-only, phone first, always shows the latest published version. The link is the only key, so treat it like a password.
- **Data**: Cloudflare D1 (`wedding-timeline`). `weddings` holds Mary's working draft; `versions` holds frozen published copies.

The product spec and the review of past timelines live in the Mary Anna Photography project in Claude (`claude/timeline-tool-spec`, `knowledge-base/13-wedding-day-timelines`).

## Layout

| Path | What it is |
|---|---|
| `src/worker.js` | Routes, sign-in check, database reads and writes |
| `public/static/core.js` | Time chaining, row generation from answers, sunset, version changes. Pure functions |
| `public/static/app.js` | The builder and the couple's page |
| `public/static/styles.css` | Styles and brand tokens |
| `public/_shell/*.html` | Page shells the Worker serves |
| `schema.sql` | Database tables (already applied to the production database) |
| `test/core.test.cjs` | Unit tests for `core.js` (`npm test`) |

## First-time setup in Cloudflare

1. **Deploy from this repository.** In the Cloudflare dashboard, open Workers & Pages, create an application by importing this repository, and keep the default deploy command (`npx wrangler deploy`). Every push to `main` then deploys. `wrangler.jsonc` attaches the Worker to `timeline.maryannaphotography.com` and creates the DNS record.
2. **Protect the builder with Access.** In Zero Trust, add a self-hosted Access application for domain `timeline.maryannaphotography.com` with path `admin`. Add one Allow policy that lists Mary's and Ben's email addresses and nobody else.
3. **Tell the Worker about that application.** Copy the application's Audience (AUD) tag and your team domain (`https://<team-name>.cloudflareaccess.com`) into `vars` in `wrangler.jsonc` as `POLICY_AUD` and `TEAM_DOMAIN`, then commit. Neither value is a secret. Until both are set, the Worker refuses every `/admin` request.
4. **Check it.** `https://timeline.maryannaphotography.com/admin` should ask you to sign in, then show the wedding list. In a private browser window the same address must not show the list.

The Worker verifies the Access token itself on every `/admin` request, so a mistake in the Access setup closes the builder; it does not open it.

## Working on it locally

```
npm install
npm run db:local                      # creates the tables in a local database
echo DEV_SKIP_ACCESS=1 > .dev.vars    # local only; ignored outside localhost
npx wrangler dev --host localhost
npm test
```

Then open `http://localhost:8787/admin`.

## Not built yet

- Couple approval and change requests on the page (the code is present but switched off).
- Emails sent by the app. Mary sends the link herself.
- Looking up sunset from the ceremony address. The builder uses a short list of areas.
- PDF export, planner view-only links, archiving or deleting a wedding.
