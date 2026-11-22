# Resource Manager v1.1 — Android Back, status bar, negative balance fixes

This ZIP contains the **entire source project**. Extract it and copy the files into your existing GitHub repository, keeping their paths. This is source code, **not** an already compiled APK.

## Files changed/added

- `src/main.js` — navigation listener, explicit Strict/Flexible UI, negative balance display.
- `src/resource-engine.js` — debt carry-forward and replenishment-boundary correction.
- `src/style.css` — debt and validation styles.
- `src/navigation-logic.js` — pure navigation decision.
- `.github/workflows/apk.yml` — native patch step + tests + build.
- `android-patches/MainActivity.java` — Android native Back dispatcher and system bar WindowInsets.
- `scripts/patch-android.mjs` — installs native Java and manifest patch *after* Capacitor generates Android.
- `package.json` — version 1.1 + test script.
- `tests/*.test.mjs` — repeatable regression tests (14 tests).

Other files remain from the prior project to preserve existing features.

## Build

1. Upload all changed/new files into the **matching paths** in GitHub. Make sure you include the new `scripts` and `android-patches` folders, not just `src/`.
2. In GitHub, Actions → Build Android APK → Run workflow.
3. Check that **Apply native Android fixes** appears and succeeds. If that step does not appear, GitHub is still running the OLD workflow.
4. Download the `resource-manager-debug-apk` artifact, extract its ZIP, and install `app-debug.apk`.
5. In Settings → About confirm **Resource Manager v1.1**. If it says v1, you still have an older APK.

### IMPORTANT — Existing APK and data

The APK and PWA have separate IndexedDB storage. Before removing the previously installed APK, export Settings → Backup JSON. A newly generated GitHub debug APK can have a different signing key from the previous APK, so Android may refuse to upgrade over it. If this happens, export data first, uninstall the old APK, install the new one, then restore your backup. Uninstalling removes the APK's local data.

## Test

- Create/edit an active Money resource: initial 10000, monthly refill 10000, carry 100%, consumption limit **Flexible**, unit ₹. Save.
- Consume 12000: Home should show **Debt −₹2,000**. Analytics consumed can show 120% for that period.
- Test Strict separately: same amount should not be accepted, and the consumption panel should explain why.
- Resources → system Back: Home. Home → system Back: exit. Open Consume panel → Back: dismiss panel without exiting.
- Check battery/time/network on top system bar, and bottom navigation clear of gesture bar.
- Settings → send test notification, then schedule morning/evening as desired.

## Verification performed

`npm test` (14 pure-JS/native-patch wiring tests) and `node --check` pass. Native Android Java compilation, physical-device display, and an actual GitHub APK build cannot be verified in this container, so the GitHub workflow and phone tests remain necessary.
