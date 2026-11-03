# Cloudflare storage for the app: setting it up

The app keeps uploaded files (pop-up banners, stories) in a Cloudflare R2 bucket on the church's own Cloudflare account.
A small Cloudflare Worker (`uploads/`) checks who is uploading and hands out short-lived upload addresses; a nightly schedule
on the same Worker removes expired story records. Everything here stays inside Cloudflare's free allowance for a church app.

No secret is ever written into this repository. Secrets are typed into `wrangler secret put` and live only in Cloudflare.

## Part 1: the account (you do this; it needs the church's card)

1. Go to https://dash.cloudflare.com/sign-up and create the account with **hello@lifecentre.sg**. Verify the email.
2. In the dashboard, open **R2 Object Storage** in the left menu and click **Purchase R2 plan** (or "Enable R2"). Add the card.
   R2 is free up to 10 GB stored and 10 million reads a month; nothing is charged below that. Cloudflare asks for a card anyway.
3. Still in R2, note the **Account ID** shown on the right of the R2 overview page (it is not a secret).
4. Create an **R2 API token**: R2 overview > **Manage R2 API Tokens** > **Create API token**.
   - Name: `lifecentre-uploads`
   - Permissions: **Object Read & Write**
   - Specify bucket: leave as "Apply to all buckets" for now (the bucket is created in Part 2), or come back and limit it to `lifecentre-uploads`.
   - TTL: forever.
   Click **Create API token** and keep the page open: it shows the **Access Key ID** and **Secret Access Key** once. You will paste
   them into `wrangler secret put` in Part 3. Do not paste them into chat, a file or an email.
5. A service account for the nightly clean-up (this is in Google, not Cloudflare). Do not use the key the Firebase console offers:
   that is the Admin SDK account, which can do anything in the project. Make a small one instead:
   Google Cloud console (project `lifecentre-app`) > **IAM & Admin** > **Service accounts** > **Create service account**, name
   `lifecentre-cleanup`, role **Cloud Datastore User** only. Open it > **Keys** > **Add key** > **Create new key** > JSON. It
   downloads a JSON file. Keep it somewhere private on this computer; it is pasted into one secret in Part 3 and then can be deleted.

## Part 2: the bucket (run from the repository folder, signed in as hello@)

```
npx wrangler@4 login                                   # opens the browser; sign in as hello@lifecentre.sg
npx wrangler@4 whoami                                  # shows the account and its id
npx wrangler@4 r2 bucket create lifecentre-uploads
npx wrangler@4 r2 bucket cors set lifecentre-uploads --file cloudflare/r2-cors.json   # (the file is in wrangler's shape; the dashboard's CORS editor uses a different one)
npx wrangler@4 r2 bucket lifecycle add lifecentre-uploads --name stories-2-days --prefix stories/ --expire-days 2
npx wrangler@4 r2 bucket lifecycle list lifecentre-uploads
```

Public reads: in the dashboard, R2 > `lifecentre-uploads` > **Settings** > **Public access** > **Allow Access** for the r2.dev
subdomain. Copy the public address (`https://pub-….r2.dev`). (A custom domain such as `media.lifecentre.sg` can replace it later.)

## Part 3: the Worker

Fill in `cloudflare/uploads/wrangler.toml`: `CF_ACCOUNT_ID` (from Part 1 step 3) and `PUBLIC_BASE_URL` (from Part 2).
Then the three secrets, each typed when asked (nothing goes into a file):

```
npx wrangler@4 secret put R2_ACCESS_KEY_ID --config cloudflare/uploads/wrangler.toml
npx wrangler@4 secret put R2_SECRET_ACCESS_KEY --config cloudflare/uploads/wrangler.toml
npx wrangler@4 secret put FIREBASE_SERVICE_ACCOUNT --config cloudflare/uploads/wrangler.toml   # paste the whole JSON file on one line
npx wrangler@4 deploy --config cloudflare/uploads/wrangler.toml
```

The deploy prints the Worker's address (`https://lifecentre-uploads.<something>.workers.dev`). Put that address in
`app/js/uploads.js` as `UPLOAD_API`, and push the app.

## Checks after deploying

- `curl https://lifecentre-uploads.<something>.workers.dev/` answers `ok`.
- In the app, signed in as an admin, upload a pop-up banner from the staff page: the preview shows and the saved pop-up's
  picture address starts with the bucket's public address.
- Cloudflare dashboard > Workers > lifecentre-uploads > **Triggers** shows the cron `0 19 * * *` (03:00 Singapore).

## Taking it down or rotating keys

- A leaked R2 token: R2 > Manage R2 API Tokens > roll or delete it, then `wrangler secret put` the new one and deploy again.
- The service-account key: Google Cloud console > IAM > Service accounts > Keys > delete it; generate a new one; `secret put`.
