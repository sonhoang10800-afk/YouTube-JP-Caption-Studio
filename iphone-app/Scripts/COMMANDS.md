# iPhone commands — YouTube JP Caption Studio

Ghi nhớ nhanh: **cập nhật code** → `deploy-iphone.sh` · **chữ ký hết hạn** → `renew-iphone-signing.sh` · **dữ liệu** → Backup Drive trong app. **Không xoá app** trên iPhone chỉ để update (mất sandbox).

Scripts: `iphone-app/Scripts/`. First-run chi tiết: `FIRST_RUN.md`.

Sibling iPad: `ipad-app/Scripts/` (Bundle ID khác — cài cùng lúc được).

---

## Chuẩn bị dữ liệu runtime (dict.sqlite)

`Resources/dict.sqlite` là **dữ liệu runtime** (không nằm trong git — xem AGENTS.md §8), nhưng
project Xcode khai báo nó là resource nên **build sẽ fail nếu file thiếu**:

```bash
# từ thư mục gốc repo
cp data/dict/dict.sqlite iphone-app/Resources/dict.sqlite
```

App vẫn chạy được nếu không có file (tra cứu từ điển offline sẽ tắt, log
`dict.sqlite missing from bundle`); CI chỉ dùng một file rỗng làm placeholder để compile.

## Lần đầu cài lên iPhone (Xcode signing, Trust)

Làm **một lần** trên Mac + iPhone (manual):

1. Mở `iphone-app/LanguageCaptioniPhone.xcodeproj` trong Xcode.
2. Chọn iPhone làm destination → **Automatic Signing** + **Team** (Apple ID). Giữ nguyên Bundle ID `com.example.LanguageCaption.iPhone`.
3. ⌘R. Trên iPhone: **Settings → General → VPN & Device Management → Trust** developer cert.
4. Smoke: xoay portrait ↔ landscape (layout đổi); Overlay / Side panel. Trong app: **Thư mục** → Connect Drive (OAuth). Cần iOS `client_id` trong `Info.plist` (`DRIVE_OAUTH_CLIENT_ID`) (cùng client với iPad nếu GCP đã đăng ký; hoặc thêm iOS client cho Bundle ID iPhone).

Free account: chữ ký ~7 ngày. Renew từ Mac — **không xoá app**.

---

## Deploy update nhanh từ Mac → iPhone thật

Incremental build + overwrite cùng Bundle ID. Không clean DerivedData. Không xoá app trên máy.

```bash
export DEVICE_UDID='YOUR-UDID'   # bắt buộc
# optional: PROJECT SCHEME BUNDLE_ID CONFIGURATION APP_PATH LOG

./iphone-app/Scripts/deploy-iphone.sh
```

Chỉ cài lại `.app` đã build (bỏ qua xcodebuild):

```bash
INSTALL_ONLY=1 DEVICE_UDID='YOUR-UDID' ./iphone-app/Scripts/deploy-iphone.sh
```

Alias gợi ý:

```bash
alias iphone-deploy='DEVICE_UDID=YOUR-UDID ~/Documents/YouTube\ JP\ Caption\ Studio/iphone-app/Scripts/deploy-iphone.sh'
```

Wireless: pair một lần (USB hoặc Xcode Devices), cùng Wi‑Fi, iPhone mở khoá — `id=$DEVICE_UDID` vẫn dùng được.

Log: `~/Library/Logs/LanguageCaption-iPhone-deploy.log`

---

## Auto renew chữ ký

Free cert hết hạn → renew (không dùng cho code update thường ngày). Skip nếu còn >48h.

```bash
export DEVICE_UDID='YOUR-UDID'
export TEAM='XXXXXXXXXX'   # hoặc DEVELOPMENT_TEAM
./iphone-app/Scripts/renew-iphone-signing.sh
```

### LaunchAgent (mỗi 12 giờ)

1. Sửa `DEVICE_UDID` / `TEAM` trong `com.languagecaption.iphone.renew.plist`.
2. Copy → `~/Library/LaunchAgents/`.
3. Load:

```bash
cp iphone-app/Scripts/com.languagecaption.iphone.renew.plist ~/Library/LaunchAgents/
# edit REPLACE_WITH_* trong plist trước khi load
launchctl load ~/Library/LaunchAgents/com.languagecaption.iphone.renew.plist
launchctl start com.languagecaption.iphone.renew
```

Logs: `~/Library/Logs/LanguageCaption-iPhone-renew.log` (+ `.launchd.out/err.log`).

> The plist runs `~/Documents/YouTube JP Caption Studio/...` — keep the repo in
> that folder (or edit the path in the plist before loading it).

Paid Developer Program: bỏ qua chu kỳ ~7 ngày free.

---

## OAuth Drive API (iPhone)

Cùng flow iPad: `ASWebAuthenticationSession` + PKCE + reverse-client-id redirect. URL scheme giữ nguyên với iPad (cùng `DRIVE_OAUTH_CLIENT_ID` trong `Info.plist`).

Nếu GCP iOS client chỉ gắn Bundle ID iPad, tạo thêm client iOS cho `com.example.LanguageCaption.iPhone` (hoặc thêm Bundle ID nếu console cho phép).

Chi tiết: mirror `ipad-app/Scripts/COMMANDS.md` mục OAuth. Folder Drive cố định: khai báo ở `DRIVE_FOLDER_ID` (`Info.plist`).

---

## Backup / Restore Google Drive (trong app)

Giống iPad — **Thư mục** / **Backup** / **Restore**. Script sync per-video folder; vocab/settings JSON LWW. Xoá app = mất sandbox local.

---

## Lấy UDID

```bash
xcrun xctrace list devices
# hoặc: xcrun devicectl list devices
# hoặc: Xcode → Window → Devices and Simulators → Identifier
```

---

## Env vars

| Biến | Dùng ở | Ghi chú |
|------|--------|---------|
| `DEVICE_UDID` | deploy, renew | **Bắt buộc** khi build/install lên máy thật |
| `TEAM` / `DEVELOPMENT_TEAM` | renew (+ LaunchAgent) | Apple Team ID; deploy dùng `-allowProvisioningUpdates` |
| `INSTALL_ONLY=1` | deploy | Skip build, chỉ `devicectl install` |
| `APP_PATH` | cả hai | Đường dẫn `.app` tường minh |
| `PROJECT` / `SCHEME` / `BUNDLE_ID` | cả hai | Default: xcodeproj trong `iphone-app/`, scheme `LanguageCaptioniPhone`, bundle `com.example.LanguageCaption.iPhone` |
| `CONFIGURATION` | deploy | Default `Debug` |
| `LOG` | deploy | Override log path |
