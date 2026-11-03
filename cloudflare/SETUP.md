# Cloudflare storage for the app: setting it up

The app keeps uploaded files (pop-up banners, stories, profile photos) in a Cloudflare R2 bucket on the church's own
Cloudflare account. A small Cloudflare Worker (`uploads/`) checks who is uploading and puts the file in the bucket for them.
Everything here stays inside Cloudflare's free allowance for a church app.

There are no secrets to create or keep: the Worker reaches the bucket through a binding named in `uploads/wrangler.toml`, and
expired story records are removed by the church's hourly Apps Script job (`apps-script/Votd.js`), which already writes to
Firestore as the script owner. Nothing in this repository, or in Cloudflare, holds a key.

**Where things stand (4 Nov 2026):** the account exists (hello@lifecentre.sg, account id `cea7dea349ddbdadca0d69ee74bd7965`),
the bucket `lifecentre-uploads` is created with the 2-day lifecycle for `stories/`, public access is on at
`https://pub-6e5175904733427ab0e9528a3c78c10e.r2.dev`, and the Worker is deployed at
`https://lifecentre-uploads.lifecentre-app-prototype.workers.dev` (it answers `ok`). Nothing else is needed.

## Part 1: the account (you do this; it needs the church's card)

1. Go to https://dash.cloudflare.com/sign-up and create the account with **hello@lifecentre.sg**. Verify the email.
2. In the dashboard, open **R2 Object Storage** in the left menu and click **Purchase R2 plan** (or "Enable R2"). Add the card.
   R2 is free up to 10 GB stored and 10 million reads a month; nothing is charged below that. Cloudflare asks for a card anyway.

## Part 2: the bucket (run from the repository folder, signed in as hello@)

```
npx wrangler@4 login                                   # opens the browser; sign in as hello@lifecentre.sg
npx wrangler@4 whoami                                  # shows the account and its id
npx wrangler@4 r2 bucket create lifecentre-uploads
npx wrangler@4 r2 bucket lifecycle add lifecentre-uploads --name stories-2-days --prefix stories/ --expire-days 2
npx wrangler@4 r2 bucket lifecycle list lifecentre-uploads
npx wrangler@4 r2 bucket dev-url enable lifecentre-uploads   # public reads; prints the https://pub-….r2.dev address
```

The bucket needs no CORS rules: browsers never write to it directly (uploads go through the Worker), and pictures, video and
sound are read with plain `src` addresses. (A custom domain such as `media.lifecentre.sg` can replace the r2.dev address later.)

## Part 3: the Worker

Put the bucket's public address in `cloudflare/uploads/wrangler.toml` as `PUBLIC_BASE_URL`, then:

```
npx wrangler@4 deploy --config cloudflare/uploads/wrangler.toml
```

The deploy prints the Worker's address (`https://lifecentre-uploads.<something>.workers.dev`). Put that address in
`app/js/uploads.js` as `UPLOAD_API`, and push the app.

## Checks after deploying

- `curl https://lifecentre-uploads.<something>.workers.dev/` answers `ok`.
- In the app, signed in as an admin, choose a banner on the staff page's Pop-ups form: it is uploaded first, and the preview
  then shows it from the bucket's public address.
- Cloudflare dashboard > Workers > lifecentre-uploads > **Triggers** shows no cron schedule (the clean-up runs in Apps Script).

## What each account may do

The Worker checks the signed-in Google account's Firebase token against Google's public keys, then reads that account's own
entry on the staff list. Admins and staff upload pop-up banners; admins and anyone with "Can post stories" upload stories;
anyone on the staff list uploads a profile photo. Files over 60 MB and unknown file types are refused.

## Taking it down

Delete the Worker in the dashboard (Workers > lifecentre-uploads) and the bucket (R2 > lifecentre-uploads, after emptying it).
There is no key to revoke.
