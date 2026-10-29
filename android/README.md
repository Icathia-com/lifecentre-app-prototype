# Life Centre Android app

The Android app is the web app in a thin Android shell (a Trusted Web Activity). It opens
https://icathia.com/lifecentre-app-prototype/app/ full screen, with no browser bar. Everything is prepared here;
**nothing has been built or signed yet.** Package name: `sg.lifecentre.app`.

Run every command below in PowerShell, in this `android` folder:

```powershell
cd "C:\Users\Theersha Prawath\Documents\lifecentre-app-prototype\android"
```

## Before you start (once)

1. The new app files (manifest, icons, service worker) must be live. Check this returns `200`:
   ```powershell
   curl.exe -s -o NUL -w "%{http_code}" https://icathia.com/lifecentre-app-prototype/app/manifest.webmanifest
   ```
2. The app icon is the church logo in `appiconsicon-bethlehem-prism-white.png`. To change it, replace that file, run
   `node scripts/make-icons.mjs` from the main folder, then commit and publish the new icons.

## 1. Install Bubblewrap and its tools

```powershell
npm install
npx bubblewrap doctor
```

The first run asks to install a JDK and the Android SDK. Answer **Y** to both and accept the licences. This downloads
about 1 GB into `C:\Users\Theersha Prawath\.bubblewrap`.

## 2. Generate the Android project

```powershell
npx bubblewrap update
```

This reads `twa-manifest.json` (already written) and creates the Android project files here. They are ignored by git.

## 3. Create the signing key (this is the step I stopped before)

The key proves that updates come from Life Centre. **Keep `android.keystore` and both passwords somewhere safe, such as
a password manager. If they are lost, the app can never be updated.** Never commit them (git already ignores them).

```powershell
keytool -genkeypair -v -keystore android.keystore -alias lifecentre -keyalg RSA -keysize 2048 -validity 10000
```

It asks for a password and some details (name, organization: Life Centre, country: SG). The alias `lifecentre` matches
`twa-manifest.json`.

## 4. Build the app

```powershell
npx bubblewrap build
```

It asks for the keystore password and the key password. It makes two files here:

- `app-release-signed.apk`: to install straight onto a phone.
- `app-release-bundle.aab`: the file the Google Play Store wants.

## 5. Publish the link between the app and the website

Android only hides the browser bar if the website says it trusts the app. Get the file:

```powershell
npx bubblewrap fingerprint list
npx bubblewrap fingerprint generateAssetLinks
```

That writes `assetlinks.json` here (the layout is in `assetlinks.template.json`). It must be served at exactly
**https://icathia.com/.well-known/assetlinks.json**, at the root of the domain. This repository only serves the
`/lifecentre-app-prototype/` folder, so the file goes into the repository that serves the root of `icathia.com`:

1. Add the file at `.well-known/assetlinks.json`.
2. Also add an empty file named `.nojekyll` at the root. Without it GitHub Pages hides folders that start with a dot.
3. Publish, then check it. This must show the package `sg.lifecentre.app` and a fingerprint:
   ```powershell
   curl.exe -s https://icathia.com/.well-known/assetlinks.json
   curl.exe -s "https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://icathia.com&relation=delegate_permission/common.handle_all_urls"
   ```

Until this is live, the app still opens but shows a browser bar at the top.

## 6. Try it on a phone

Copy `app-release-signed.apk` to the phone and open it (allow installs from this source when asked), or, with USB
debugging on:

```powershell
& "$env:USERPROFILE\.bubblewrap\android_sdk\platform-tools\adb.exe" install app-release-signed.apk
```

## 7. Google Play (when you are ready)

Upload `app-release-bundle.aab` in the Play Console. If Play App Signing is on (it is by default), Play re-signs the
app with its own key: copy the "App signing key certificate" SHA-256 from Play Console > App integrity, then:

```powershell
npx bubblewrap fingerprint add <THE-SHA-256-FROM-PLAY>
npx bubblewrap fingerprint generateAssetLinks
```

and publish the new `assetlinks.json` (it now lists both keys). For every later release, raise `appVersionCode` in
`twa-manifest.json` by 1, run `npx bubblewrap update`, then `npx bubblewrap build`.

## Things to know

- **Staff sign-in in the app is untested.** Google sign-in opens a pop-up window, which can behave differently inside an
  Android app. Check it on a real phone before telling staff to use the app. Visitors and members are not affected.
- The app has no notifications (`enableNotifications` is false).
- Changing anything inside the web app needs no new Android build: the app always shows the live website.
