# First run on physical iPhone

Device install is manual — do this once on your Mac + iPhone:

1. Open `iphone-app/LanguageCaptioniPhone.xcodeproj` in Xcode (run `xcodegen` in `iphone-app/` if missing).
2. Select your iPhone as the run destination; enable **Automatic Signing** and pick your Apple ID **Team**. Keep Bundle ID `com.example.LanguageCaption.iPhone`.
3. ⌘R. On the iPhone: **Settings → General → VPN & Device Management → Trust** the developer cert.
4. Smoke: rotate portrait ↔ landscape (stacked vs split); Overlay / Side panel. Then in-app: **Thư mục** → Connect Drive (OAuth).

Signing expires ~7 days on free accounts; renew from Mac (`renew-iphone-signing.sh`) — do **not** delete the app on the iPhone (that wipes sandbox; backup lives in the Drive folder).
