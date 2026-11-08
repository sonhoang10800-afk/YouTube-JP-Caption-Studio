# First run on physical iPad

Device install is manual — do this once on your Mac + iPad:

1. Open `ipad-app/LanguageCaption.xcodeproj` in Xcode.
2. Select your iPad as the run destination; enable **Automatic Signing** and pick your Apple ID **Team**. Keep the Bundle ID fixed.
3. ⌘R. On the iPad: **Settings → General → VPN & Device Management → Trust** the developer cert.
4. Smoke: Overlay / Side panel. Then in-app: **Chọn thư mục** → Files → Google Drive → a folder (e.g. `YouTube JP Caption Studio`).

Signing expires ~7 days on free accounts; renew from Mac (see `renew-ipad-signing.sh` when available) — do **not** delete the app on the iPad (that wipes sandbox; backup lives in the Drive folder).
