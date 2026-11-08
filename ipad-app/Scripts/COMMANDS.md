# iPad commands — YouTube JP Caption Studio

Ghi nhớ nhanh: **cập nhật code** → `deploy-ipad.sh` · **chữ ký hết hạn** → `renew-ipad-signing.sh` · **dữ liệu** → Backup Drive trong app. **Không xoá app** trên iPad chỉ để update (mất sandbox).

Scripts: `ipad-app/scripts/`. First-run chi tiết: `FIRST_RUN.md`.

---

## Chuẩn bị dữ liệu runtime (dict.sqlite)

`Resources/dict.sqlite` là **dữ liệu runtime** (không nằm trong git — xem AGENTS.md §8), nhưng
project Xcode khai báo nó là resource nên **build sẽ fail nếu file thiếu**:

```bash
# từ thư mục gốc repo
cp data/dict/dict.sqlite ipad-app/Resources/dict.sqlite
cp data/dict/dict.sqlite iphone-app/Resources/dict.sqlite
```

App vẫn chạy được nếu không có file (tra cứu từ điển offline sẽ tắt, log
`dict.sqlite missing from bundle`); CI chỉ dùng một file rỗng làm placeholder để compile.

## Lần đầu cài lên iPad (Xcode signing, Trust)

Làm **một lần** trên Mac + iPad (manual):

1. Mở `ipad-app/LanguageCaption.xcodeproj` trong Xcode.
2. Chọn iPad làm destination → **Automatic Signing** + **Team** (Apple ID). Giữ nguyên Bundle ID.
3. ⌘R. Trên iPad: **Settings → General → VPN & Device Management → Trust** developer cert.
4. Smoke: Overlay / Side panel. Trong app: **Thư mục** → Connect Drive (OAuth). Cần iOS `client_id` trong `Info.plist` (`DRIVE_OAUTH_CLIENT_ID`) (xem mục OAuth bên dưới).

Free account: chữ ký ~7 ngày. Renew từ Mac — **không xoá app**.

---

## Deploy update nhanh từ Mac → iPad thật

Incremental build + overwrite cùng Bundle ID. Không clean DerivedData. Không xoá app trên máy.

```bash
export DEVICE_UDID='YOUR-UDID'   # bắt buộc
# optional: PROJECT SCHEME BUNDLE_ID CONFIGURATION APP_PATH LOG

./ipad-app/scripts/deploy-ipad.sh
```

Chỉ cài lại `.app` đã build (bỏ qua xcodebuild):

```bash
INSTALL_ONLY=1 DEVICE_UDID='YOUR-UDID' ./ipad-app/scripts/deploy-ipad.sh
```

Alias gợi ý:

```bash
alias ipad-deploy='DEVICE_UDID=YOUR-UDID ~/Documents/YouTube\ JP\ Caption\ Studio/ipad-app/scripts/deploy-ipad.sh'
```

Wireless: pair một lần (USB hoặc Xcode Devices), cùng Wi‑Fi, iPad mở khoá — `id=$DEVICE_UDID` vẫn dùng được.

Log: `~/Library/Logs/LanguageCaption-deploy.log`

---

## Auto renew chữ ký

Free cert hết hạn → renew (không dùng cho code update thường ngày). Skip nếu còn >48h.

```bash
export DEVICE_UDID='YOUR-UDID'
export TEAM='XXXXXXXXXX'   # hoặc DEVELOPMENT_TEAM
./ipad-app/scripts/renew-ipad-signing.sh
```

### LaunchAgent (mỗi 12 giờ)

1. Sửa `DEVICE_UDID` / `TEAM` trong `com.languagecaption.renew.plist`.
2. Copy → `~/Library/LaunchAgents/`.
3. Load:

```bash
cp ipad-app/scripts/com.languagecaption.renew.plist ~/Library/LaunchAgents/
# edit REPLACE_WITH_* trong plist trước khi load
launchctl load ~/Library/LaunchAgents/com.languagecaption.renew.plist
launchctl start com.languagecaption.renew
```

Logs: `~/Library/Logs/LanguageCaption-renew.log` (+ `.launchd.out/err.log`).

> The plist runs `~/Documents/YouTube JP Caption Studio/...` — keep the repo in
> that folder (or edit the path in the plist before loading it).

Paid Developer Program: bỏ qua chu kỳ ~7 ngày free.

---

## OAuth Drive API (iPad)

Chrome extension `client_id` **không** dùng được trên iOS — Google trả **Error 400: invalid_request** / “Yêu cầu … không hợp lệ”. App dùng `ASWebAuthenticationSession` + PKCE (S256) + reverse-client-id redirect (`com.googleusercontent.apps.<prefix>:/oauth2redirect`); không có `client_secret`.

Một lần trên GCP (cùng project với extension):

1. Credentials → Create OAuth client ID → kiểu **iOS** → bundle `com.example.LanguageCaption`.
2. Paste full `….apps.googleusercontent.com` vào `DRIVE_OAUTH_CLIENT_ID` trong `ipad-app/Info.plist` (và `ipad-app/project.yml` để xcodegen không mất) — **không** paste client của Chrome extension.
3. Đổi URL scheme trong `Info.plist` / `project.yml` thành reverse-client-id: `com.googleusercontent.apps.<prefix>` (bỏ `.apps.googleusercontent.com` khỏi client_id).
4. Consent Testing → thêm email Test users (vd. `sonhoang236@gmail.com`) nếu app chưa publish.

Scope: `https://www.googleapis.com/auth/drive`. Folder cố định: khai báo ở `DRIVE_FOLDER_ID` (`Info.plist`).

---

## Backup / Restore Google Drive (trong app)

**Primary vocab sync = OAuth Connect** → cùng file `caption-studio-backup.json` (Drive REST, LWW; push luôn `scripts: []`, chỉ áp Vocabulary). Files bookmark Backup/Restore vẫn là fallback offline/reinstall. Script sync: Drive REST per-video folder. Settings: `caption-studio-settings.json` (auto pull/push sau Connect).

**Folder dùng chung với Desktop extension:** [Drive folder](https://drive.google.com/drive/folders/1K8LPtKici0gVaq5FuTMDmYDWzPpBokFA) (`1K8LPtKici0gVaq5FuTMDmYDWzPpBokFA`).

| Nút toolbar | Việc làm |
|-------------|----------|
| **Thư mục** | Connect Drive (OAuth) nếu chưa token; có token thì sync video đang xem + settings + vocab LWW |
| **Backup** | Ghi snapshot qua Files bookmark (fallback; nếu đã chọn folder) |
| **Restore** | Đọc JSON Files → ghi đè SwiftData (scripts + vocab) |

### Script theo folder từng video (`<videoId>/cues.json` + `meta.json`)

Script không đi qua `caption-studio-backup.json`. Mỗi video là một subfolder trên Drive; iPad đồng bộ qua Drive API khi đổi video / foreground / nút **Thư mục**.

Mới/cũ so bằng `rev` (đồng hồ Lamport int trong `meta.json`), **không** dùng thời gian file — đồng hồ Mac/iPad lệch và mtime trên Drive là lúc sync. `rev` Drive lớn hơn → iPad nạp về; iPad có sửa thật → ghi lên với `rev + 1`.

Ghi ngược là **patch**: chỉ `start_media_time`/`end_media_time`/`source`/`en`/`vi` bị ghi đè, `tokens`/`mt_locked`/`translation_source` của PC giữ nguyên. Không sửa gì thì không ghi, nên `rev` không tự tăng qua lại.

Sau khi chọn folder: mỗi lần sửa tự backup (debounce ~1.5s). Khi app vào foreground → **auto-pull** nếu Drive `updatedAt` mới hơn (bỏ qua nếu đang dirty). App trống lúc mở → tự restore nếu có file. Timing wire: chỉ `start`; `duration` suy ra local. Xoá app = mất sandbox local; data vẫn ở Drive nếu đã backup.

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
| `PROJECT` / `SCHEME` / `BUNDLE_ID` | cả hai | Default: xcodeproj trong `ipad-app/`, scheme `LanguageCaption`, bundle `com.example.LanguageCaption` |
| `CONFIGURATION` | deploy | Default `Debug` |
| `LOG` | deploy | Override log path |
