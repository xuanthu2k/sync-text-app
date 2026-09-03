# Sync Text App

React SPA + Cloudflare Worker + D1 for one shared BlockNote document. The fixed username is `xuanthuphan2k`; passwords are never committed or sent to the client bundle.

## Local setup

1. Copy `.dev.vars.example` to `.dev.vars` and provide `AUTH_PASSWORD` plus a random `SESSION_SECRET` of at least 32 bytes.
2. Create a D1 database (or replace the placeholder ID in `wrangler.jsonc` with the generated ID).
3. Create an R2 bucket named `sync-text-images`.
4. Run `npm run cf-typegen`, then `npx wrangler d1 migrations apply DB --local`.
5. Start the app with `npm run dev`.

## Deploy

After logging in to Cloudflare, run the following interactively. Do not put secret values in any file committed to Git.

```sh
npx wrangler d1 create sync-text-db
# Replace database_id in wrangler.jsonc with the returned UUID.
npx wrangler r2 bucket create sync-text-images
npm run cf-typegen
npx wrangler d1 migrations apply DB --remote
npx wrangler secret put AUTH_PASSWORD
npx wrangler secret put SESSION_SECRET
npm run deploy
```

The placeholder D1 ID is intentionally invalid for deployment. It must be replaced with the ID from the account that will own the database.

## Images

Paste a screenshot or image file directly into the editor, or choose **Add image** from its slash menu. Images are stored in the private `sync-text-images` R2 bucket and served only through an authenticated `/api/images/:id` endpoint. PNG, JPEG, WebP, and GIF are accepted up to 5 MiB each; SVG and remote-image URL importing are intentionally not supported. The Worker enforces a 500 MiB total image-storage limit before writing to R2, so uploads cannot exceed the app's configured storage budget.

When an image is removed from the saved document, it becomes eligible for deletion after seven days. A daily Cron Trigger at 03:00 UTC checks that the image is still unreferenced, deletes it from R2, and the D1 delete trigger releases its quota. Newly uploaded images are also cleaned up after seven days if they never reach a successful document save.
