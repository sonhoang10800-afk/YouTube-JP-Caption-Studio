# Language Caption Bridge (macOS)

Menu-bar app: double-click → chạy `local-bridge` (port **8765**), không cần Terminal.

## Build / chạy

```bash
cd macos-bridge-app
./build.sh
open "dist/Language Caption Bridge.app"
```

Cài vào Applications:

```bash
INSTALL=1 ./build.sh
open -a "Language Caption Bridge"
```

## Menu

| Mục | Việc |
| --- | --- |
| Trạng thái | `/health` sẵn sàng hay đang bootstrap |
| Mở Bridge Docs | `http://127.0.0.1:8765/docs` |
| Mở Saved Items | `http://127.0.0.1:3000` |
| Khởi động lại | stop + `./start.sh` lại |
| Mở thư mục log | `local-bridge/.bridge-app.log` |
| Thoát | dừng uvicorn + Saved Items |

App ghi đường dẫn bridge lúc build vào `Contents/Resources/bridge_root.txt`. Đổi chỗ clone repo → build lại.

Icon: lấy cùng `AppIcon.png` của iPad (`ipad-app/.../AppIcon.appiconset`) → `AppIcon.icns` (Finder) + `MenuIcon.png` (menu bar).

Yêu cầu: macOS 13+, Xcode (hoặc toolchain Swift khớp SDK), Python venv như khi chạy `./start.sh` tay.
