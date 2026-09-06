# Clubbit → iOS & Android (Capacitor)

This wraps the existing web app (`public/`) into native apps for the App Store and
Play Store. The Node backend (`server.js`) is **not** inside the app — it runs on a
public server, and the app calls it over the internet.

```
┌─────────────────────────┐        HTTPS         ┌──────────────────────────┐
│  Clubbit app (Capacitor)│  ───────────────────▶│  Hosted backend          │
│  bundles public/ (UI)   │   /api  /media       │  node server.js (24/7)   │
└─────────────────────────┘                      └──────────────────────────┘
```

---

## Prerequisites (one-time)
- **Node 18+** installed.
- **Android Studio** (Windows/Mac/Linux) — for the Android build. ✅ works on your Windows PC.
- **iOS build:** Apple only allows iOS builds on macOS. On Windows you have two options:
  - **Cloud build (recommended, no Mac needed):** [Codemagic](https://codemagic.io) or GitHub Actions
    macOS runners build + sign + upload to the App Store from your repo. See "iOS on Windows" below.
  - **Rented cloud Mac:** MacinCloud / MacStadium — remote into a Mac and use Xcode normally.
- **Apple Developer account** ($99/yr) and **Google Play Developer account** ($25 once) — required regardless of build method.
- A host for the backend (steps below use **Render**).

> **Do the Android app on your Windows PC now; do iOS via Codemagic when you're ready.**

---

## 1 · Host the backend (permanent URL)
The app needs the backend reachable at a stable HTTPS URL.

**Render (simple):**
1. Push this repo to GitHub (already at `nicknaz85-web/gmbx-ai-audit`).
2. Render → **New → Web Service** → connect the repo.
3. Settings:
   - **Root Directory:** `radar`
   - **Build Command:** *(leave empty — zero dependencies)*
   - **Start Command:** `node server.js`
   - **Instance:** Starter ($7/mo) if you want data to persist (see disk below).
4. **Environment variables** (Dashboard → Environment) — set these instead of committing `.env`:
   - `AUTH_SECRET` = a long random string (❗ set this so logins survive restarts even without a disk)
   - `RESEND_API_KEY`, `MAIL_FROM` (email codes)
   - `GOOGLE_PLACES_KEY`, `BESTTIME_PRIVATE_KEY`, `BESTTIME_PUBLIC_KEY`
5. **Persistent disk** (so accounts + uploaded photos survive deploys): add a Disk mounted at
   `/opt/render/project/src/radar/.data` (1 GB is plenty). Without it, `.data` resets on each deploy.
6. Deploy. Note your URL, e.g. `https://clubbit.onrender.com`.

> Any host that runs Node works the same (Railway, Fly.io, a VPS). The server reads `PORT` from
> the environment automatically.

---

## 2 · Point the app at your backend
Edit **`public/config.js`** and set your hosted URL:

```js
window.CLUBBIT_API = 'https://clubbit.onrender.com';
```

(Leave it `''` only when the web frontend is served by the backend itself.)

---

## 3 · Install Capacitor & add the native projects
From the `radar/` folder (Windows PowerShell or terminal):

```bash
npm install
npx cap add android
npx cap sync android
```

This creates the `android/` project. **Skip `cap add ios` on Windows** — the iOS project needs
CocoaPods (macOS). The cloud build (step 5) runs `cap add ios` on a Mac for you. Commit the
`android/` folder to git.

---

## 4 · App icon & splash
A source icon lives at `public/clubbit-icon.png`. Generate all sizes:

```bash
npx capacitor-assets generate --iconBackgroundColor "#120a22" --splashBackgroundColor "#120a22"
```

(If the source is small, drop a 1024×1024 PNG at `assets/icon.png` first — `@capacitor/assets` reads `assets/`.)

---

## 5 · Android — do this on your Windows PC (Android Studio)
```bash
npx cap open android
```
1. Add permissions to `android/app/src/main/AndroidManifest.xml` if not present:
   `ACCESS_FINE_LOCATION` (INTERNET is default).
2. Confirm the app ID `com.clubbit.app` in `android/app/build.gradle` (`applicationId`).
3. **Build → Generate Signed Bundle / APK → Android App Bundle (.aab)**; create a keystore and **back it up**
   (you need the same keystore for every future update).
4. **Play Console** → create the app → upload the `.aab` → fill listing + Data Safety form → submit.

## 6 · iOS on Windows — cloud build with Codemagic (no Mac)
Apple requires macOS to compile iOS, so use a hosted Mac. **Codemagic** has a free tier and can build,
sign, and upload to the App Store straight from your GitHub repo.

**One-time Apple setup (from any browser):**
1. In the **Apple Developer** portal, register the App ID / Bundle ID `com.clubbit.app`.
2. In **App Store Connect → Users and Access → Integrations → App Store Connect API**, create an
   **API Key** (role: App Manager). Download the `.p8` file and note the **Key ID** and **Issuer ID**.
3. In **App Store Connect**, create the app record (name, bundle id, etc.).

**Codemagic:**
1. Sign up at codemagic.io, connect the GitHub repo, pick this project.
2. Set **project/root path** to `radar` and choose the **Capacitor** / iOS workflow.
3. Add your **App Store Connect API key** (`.p8` + Key ID + Issuer ID) in Codemagic → Teams → Integrations
   (Codemagic auto-manages the signing certificate & provisioning profile from it).
4. Build steps the workflow should run (Codemagic's Capacitor template does most of this):
   ```bash
   npm ci || npm install
   npx cap add ios
   npx cap sync ios
   cd ios/App && pod install
   ```
   then archive `ios/App/App.xcworkspace`, scheme `App`, and **publish to App Store Connect / TestFlight**.
5. Add the iOS usage strings (Codemagic can't guess them). Easiest: create `ios/App/App/Info.plist` keys via
   a small script, or add them once from a rented Mac. Required or Apple rejects:
   - `NSLocationWhenInUseUsageDescription` = "Clubbit uses your location to show nightlife near you."
   - `NSCameraUsageDescription` / `NSPhotoLibraryUsageDescription` = "To add a profile photo and report the vibe."

> Prefer owning the toolchain? **Rent a cloud Mac** (MacinCloud ~$20/mo), remote in, and follow the normal
> Xcode flow: `npx cap add ios` → `npx cap open ios` → set Team + Bundle ID + usage strings → Product → Archive →
> Distribute to App Store Connect.

I can also generate a **`codemagic.yaml`** for you so the iOS build is one click — just say the word.

---

## Updating the app later
- **Backend change** (venues, fixes, API): redeploy the host → live instantly for web *and* installed apps.
- **Frontend change** (UI in `public/`): `npx cap sync` then rebuild + resubmit. For no-native JS/CSS
  tweaks you can add an OTA layer (e.g. Capacitor live updates) to skip store review — ask and I'll wire it.
- Bump `version` in `capacitor.config`/Xcode/Gradle for each store release.

---

## ⚠️ Security note
`radar/.env` currently contains real API keys. If this GitHub repo is public, **rotate those keys**
(Resend, Google Places, BestTime) and keep them only as host env vars. `.gitignore` now excludes `.env`,
but already-committed history still has them until you rotate.
