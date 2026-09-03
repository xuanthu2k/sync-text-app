# Sync Text App

React SPA + Cloudflare Worker + D1 for one shared BlockNote document. The fixed username is `xuanthuphan2k`; passwords are never committed or sent to the client bundle.

## Local setup

1. Copy `.dev.vars.example` to `.dev.vars` and provide `AUTH_PASSWORD` plus a random `SESSION_SECRET` of at least 32 bytes.
2. Create a D1 database (or replace the placeholder ID in `wrangler.jsonc` with the generated ID).
3. Run `npm run cf-typegen`, then `npx wrangler d1 migrations apply DB --local`.
4. Start the app with `npm run dev`.

## Deploy

After logging in to Cloudflare, run the following interactively. Do not put secret values in any file committed to Git.

```sh
npx wrangler d1 create sync-text-db
# Replace database_id in wrangler.jsonc with the returned UUID.
npm run cf-typegen
npx wrangler d1 migrations apply DB --remote
npx wrangler secret put AUTH_PASSWORD
npx wrangler secret put SESSION_SECRET
npm run deploy
```

The placeholder D1 ID is intentionally invalid for deployment. It must be replaced with the ID from the account that will own the database.
