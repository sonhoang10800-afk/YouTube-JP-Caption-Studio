# Language Caption

<p align="center">
  <img src="https://img.shields.io/badge/Chrome-Extension-4285F4?logo=googlechrome&logoColor=white" alt="Chrome Extension">
  <img src="https://img.shields.io/badge/FastAPI-Backend-009688?logo=fastapi&logoColor=white" alt="FastAPI">
  <img src="https://img.shields.io/badge/Next.js-Popup-000000?logo=next.js&logoColor=white" alt="Next.js">
  <img src="https://img.shields.io/badge/SwiftUI-iPad_iPhone-007AFF?logo=swift&logoColor=white" alt="SwiftUI iPad/iPhone App">
  <img src="https://img.shields.io/badge/Language_Caption-7B5CFF" alt="Language Caption">
</p>

[English](#english) | [日本語](#日本語) | [Tiếng Việt](#tiếng-việt)

**YouTube sentence MVP (experimental preview):** Original/Enhanced share source mapping and
authentic cue windows; Enhanced opens Original for edits, persists revision-bound Undo in a
disposable local sidecar, and saves sentence snapshots with provenance. One worker queue
translates; the sidepanel exports a local trace (readiness bounds, JP paint, HTTP attempts,
latency) and a JSON backup/restore. **Not verified end-to-end:** account billing, HTTP
dispatch/readiness at playback, per-flag native toggle checks and Drive/audio-gold round
trips — the trace is sampled state, not a release gate. See the
[current status](wiki/topics/youtube-sentence-enhancement-mvp.md), the
[default-mode review](review/youtube-sentence-mvp-enhanced-default-2026-10-11.md) and the
[walkthrough](walkthrough.md).

---

<a id="english"></a>
# 🇬🇧 English

**Language Caption** is a dual-caption learning tool for YouTube, ABEMA, Netflix, AnimeVietSub, and any http(s) page. It ships as a **Chrome Extension** (Desktop) and **Native iPad / iPhone Apps**. Source language is selectable (`auto` / `ja` / `en` / `vi`); Japanese primary still gets furigana (Sudachi / Apple NLP), JMdict, and JLPT colors. EN/VI targets use YouTube tracks, import, or Gemini.

**Overlay parity**: Dual-line overlay, authentic cue timelines, Gemini EN/VI translation, on-screen controls (replay `▶`, star `☆`/`★`, prev/next `<`/`>`, AP auto-pause `AP`, vertical position `↕`), and 3-tab sidepanel (`Subtitles`, `Words` grouped by frequency rank, `Saved`).

## 🌟 Key Features
1. **Smart Captions & Exact Timelines**: Intercepts Japanese timedtext directly from YouTube/Netflix/ABEMA, keeping authentic start and end times without artificial stretching across silence gaps.
2. **Vietnamese Translation via Gemini 3.8 Flash**: Fast batch translation using your Google AI Studio Gemini 3.8 Flash API key (configured in the in-page Settings modal `⚙`).
3. **Language Reactor 5.1.8 Overlay**: One Japanese card (`.lr-card-ja`) with a purple replay button `(▶)`, Romaji above colored tokens by rank and a 1-click star button `☆`/`★`; the Vietnamese and English translations are rendered as `.bar-vi` / `.bar-en` rows inside that same card. The legacy `.lr-card-vi` / `.lr-card-en` wrapper cards still exist in CSS but are `display: none !important` and are no longer rendered.
4. **On-Screen Navigation & Auto-Pause**: Left vertical navigation bar (`>`, `↻` with "Repeat ['S' key]" tooltip, `<`), hotkeys (S, A, D), right auto-pause switch (`AP`), and vertical shift button `↕`.
5. **3-Tab Side Panel**: `Subtitles` (timeline with playhead sync and star), `Words` (video vocabulary grouped by frequency rank brackets e.g. Rank 1-500, 501-1000), and `Saved` (all saved words and starred cues with context toggle).
6. **Player Bar Pill Toggle**: the controls pill `.hardsub-ytp-toggle` — an `LC` badge, an `ON`/`OFF` label and a `⚙` gear. ON hides native YouTube captions (`body.lr-hide-native-subs`) and shows the Language Caption overlay; OFF restores native captions. Clicking the gear opens the in-page Settings modal. Clicking the extension toolbar icon opens the dedicated full-page options in a tab.
7. **Furigana & Modern Mazii Dictionary**: Real-time 240k+ Mazii offline dictionary + JMdict. Desktop: Sudachi + local bridge `/dict` backed by Mazii offline DB (241k words, 116k examples, 12k kanji). Tap/hover a word → modern Mazii card with core Vietnamese meaning banner ("Nghĩa tiếng Việt cốt lõi" or accurate English fallback), Han Viet, JLPT level badge, real bilingual examples, formatted Vietnamese POS badges, and quick vocab learning status toolbar. Features **200ms Hover Transit Lock** and **Click-to-Pin** to eliminate annoying popup jumping when sweeping the mouse across intermediate tokens, alongside intelligent sense deduplication.
8. **JLPT / Frequency Coloring**: Tokens colored by difficulty band (N5→N1 / unknown) from the shared `freq_ja.json` rank map.
9. **Personal Vocabulary Tracker**: Mark Known / Learning / Ignore / Special, save words and starred sentences into `savedCues`.
10. **Native iPad / iPhone**: Standalone SwiftUI apps (`ipad-app/`, sibling `iphone-app/`) — hardsub, side panel, tokenize, dict popup, import/export.
11. **Drive Sync (PC ↔ iPad/iPhone)**: Shared `language-caption-backup.json` (dual-reads legacy `caption-studio-backup.json`) in the Drive folder `Language Caption`; vocab/settings files follow the same rename with dual-read.
12. **Bilingual Hover Sync & JLPT Coloring**: Hovering mapped words highlights their counterparts (`.tok-hover-sync`). The sentence MVP requires levels from corresponding Japanese tokens; unmapped words stay neutral. Group-level NLP/color verification is pending.
13. **Instant Overlay Dict & Cue Popover**: Hovering overlay tokens immediately opens dictionary definitions. Hovering any Play button `▶` reveals a sentence breakdown popover (JA with furigana, VI, EN).

## 🏗 System Architecture
The project supports two completely different stacks to cover both Desktop and Mobile (iPad/iPhone) experiences:

### 1. Desktop Architecture (Decoupled Client-Server)
Utilizes a decoupled architecture to bypass Chrome Extension limits and offload heavy NLP tasks.
* **Chrome Extension (MV3)**: Handles YouTube DOM manipulation, timedtext interception, UI rendering, and state sync.
* **Local Bridge (FastAPI `:8765`)**: The core engine written in Python. It handles NLP tokenization (Sudachi), dictionary lookups, local file I/O for subtitle storage, and macOS IME control. The bridge is the **only supported** IME path — `tools/ime-switch/` (Chrome Native Messaging host) is **frozen/legacy**: kept for reference, no new features, not tested.
* **Next.js Web App (`:3000`)**: A dedicated application for managing saved items and vocabulary, exported as a static popup for the extension. Settings (incl. JLPT level colors) open in a full tab from the side panel ⚙.

### 2. iPad / iPhone Architecture (Standalone SwiftUI)
Native iOS apps (`ipad-app/`, sibling `iphone-app/`) providing core Desktop flows without a backend. Separate Bundle IDs so both can install side by side; dict/freq assets are symlinked from iPad Resources.
* **WKWebView Player**: Embeds YouTube, intercepting events and cues natively.
* **SwiftUI Native Views**: Hardsub overlay (`TokenizedJAView` + `DictPopupView`) and Side Panel (`CueEditorRow`). iPhone: orientation-driven layout + compact top bar.
* **Native Apple NLP + freq map**: `NLPTagger` for tokenization/furigana; bundled `freq_ja.json` for JLPT colors (same ceilings as Desktop `vocab_freq.py`).
* **SwiftData & SQLite**: Bundled `dict.sqlite` for `/dict`-style VI+EN lookup; SwiftData for scripts and saved vocabulary.

## 🚀 Quickstart

### Option A: Desktop (Chrome Extension + Local Bridge)

**1. Clone the repository**
```bash
git clone https://github.com/sonhoang10800-afk/language-caption.git
cd language-caption
```

**2. Start the Local Bridge**
```bash
cd local-bridge
./start.sh
```
The Bridge will run on `http://127.0.0.1:8765`. 

**3. Bootstrap Dictionaries (First time only)**
Large dictionaries are **not** committed to Git. You must build/download them locally.
```bash
curl -X POST http://127.0.0.1:8765/bootstrap
curl -s http://127.0.0.1:8765/health
```
*Wait a few minutes until `models_loaded.sudachi` and dictionary flags turn `true`.*

**4. Build the Saved Items popup (first time / after changing `web/saved-items`)**
```bash
cd web/saved-items && npm ci && npm run build:extension
```
The popup chunks are committed, so a fresh clone already works — run this after pulling
changes to `web/saved-items/` and commit the regenerated `extension/popup/`.
`node scripts/verify_extension_popup.js` fails if the popup and its assets ever disagree.

**5. Install Chrome Extension**
1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode** (top right corner).
3. Click **Load unpacked** and select the `extension/` folder in this project.
4. Open a YouTube video with Japanese captions and enjoy!

After changing extension code, run `./scripts/reload-extension.sh` from the project root. It reloads the extension and refreshes the YouTube tab without the Reload button.

### Option B: iPad App (Native)
1. Open `ipad-app/LanguageCaption.xcodeproj` in **Xcode** (regenerate with `xcodegen` if you edit `project.yml`).
2. Select your iPad device or simulator as the target.
3. Build and Run (Cmd + R). Ensure `Resources/dict.sqlite` and `Resources/freq_ja.json` are in the app bundle.
4. Paste a YouTube URL → enable **Overlay** / **Side panel** → tap a colored word for the dict popup (VI+EN + sentence).

### Option C: iPhone App (Native)
1. Open `iphone-app/LanguageCaptioniPhone.xcodeproj` in **Xcode** (`cd iphone-app && xcodegen` if missing). Bundle ID: `com.example.LanguageCaption.iPhone`.
2. Select an iPhone simulator or device → Build and Run (Cmd + R).
3. Rotate: portrait = stacked player/panel; landscape = side-by-side. Deploy scripts: `iphone-app/Scripts/COMMANDS.md`.

### Verify everything before you commit
`scripts/verify_all.sh` runs every gate this repo expects — extension suites, anti-fake test gate, popup asset check, `freq_ja.json` parity, the sanity suite, wiki lint, the bridge pytest suite, the Swift store self-test (macOS), and the Saved Items typecheck — and prints `gates: N passed, M skipped, K failed` with a non-zero exit if anything failed.

---

<a id="日本語"></a>
# 🇯🇵 日本語

**YouTube JP Caption Studio** は、YouTubeを利用した日本語学習に特化した、Language Reactor 風のツールです。**デスクトップ用Chrome拡張機能**と**ネイティブiPad / iPhoneアプリ**で利用可能です。日本語 timedtext の取得、オーバーレイ、サイドパネル編集、ルビ（Desktop: Sudachi / iOS: NaturalLanguage）、JMdict（EN+VI）、JLPT色分け、EN/VI 手動インポート・編集を備えています。

OCR **不使用**。機械翻訳 **不使用**。翻訳は YouTube の EN/VI トラック（ある場合）、Import、または手動編集のみ。

## 🌟 主な機能
1. **スマート字幕**: YouTubeから日本語 timedtext を取得し、オーバーレイとサイドパネルに表示（JA/EN/VI切替、EN+VIは既定でON）。EN/VI トラックがある動画では ±0.35s で union-merge（不一致は orphan 行；Import/手動は上書きしない）。
2. **ルビ＆辞書**: 高精度オフライン Yomitan 和越辞書（漢越音 Hán-Việt バッジ付き）と綺麗な JMdict 英和フォールバック。複数トークンの慣用句マッチング（`気にする`, `足がつく`）対応。単語をタップ/クリックすると **漢字・ルビ・漢越音・高精度ベトナム語訳・英語補足** が表示されるポップアップ。
3. **JLPT / 頻度カラー**: `freq_ja.json` のランクから N5→N1 色分け（Desktop hardsub と iPad オーバーレイ/サイドパネル共通）。
4. **個人単語帳**: Desktop は Known / Learning / Ignore / Special をマーク。iPad は辞書ポップアップから単語を SwiftData に保存（状態マークUIは Desktop 先行）。
5. **手動編集**: サイドパネルで JA/EN/VI とタイムラインを編集。TXT/JSON 一括インポート/エクスポート。iPad の JA はトークン表示、「Sửa JA」で編集。
6. **ローカルデータ保存**: 手動翻訳・編集を優先してローカル保存。YouTube データで上書きされない。ブリッジの `script.txt` は各キューで常に `JA:` / `EN:` / `VI:` 行を出す（空でも可）。
7. **自動 IME 切り替え (macOS デスクトップのみ)**: 日本語編集時に日本語キーボードへ自動切替。
8. **ネイティブiPad / iPhone**: サーバー不要の SwiftUI アプリ（`ipad-app/`・`iphone-app/`）。iPhone は縦積み / 横分割レイアウト。Auto IME や状態マークは未対応。
9. **Drive同期 (PC ↔ iPad/iPhone)**: 共有 `caption-studio-backup.json`。拡張は OAuth + bridge；ネイティブは Files。詳細は `walkthrough.md` §3.5。

## 🏗 システム構成
本プロジェクトは、デスクトップとモバイル（iPad）の両方をカバーするため、2つの異なるアーキテクチャをサポートしています。

### 1. デスクトップアーキテクチャ (分離型クライアント・サーバー)
* **Chrome 拡張機能 (MV3)**: YouTubeのDOM操作、字幕データの取得、UIレンダリング、状態の同期。
* **ローカルブリッジ (FastAPI `:8765`)**: Pythonコアエンジン。NLPトークン化（Sudachi）、辞書検索、ファイルI/O、macOS IME制御。
* **Next.js Webアプリ (`:3000`)**: 単語帳や設定を管理するための専用アプリ（ポップアップとして機能）。

### 2. iPad アーキテクチャ (スタンドアロン SwiftUI)
* **WKWebView プレーヤー**: YouTubeを埋め込み、ネイティブでイベントと字幕を取得。
* **SwiftUI ネイティブビュー**: Hardsub（`TokenizedJAView` + `DictPopupView`）とサイドパネル。
* **Apple NLP + 頻度マップ**: `NLPTagger` で分割/ルビ、同梱 `freq_ja.json` で JLPT 色。
* **SwiftData & SQLite**: 同梱 `dict.sqlite` で VI+EN 検索、スクリプトと保存単語を永続化。

## 🚀 クイックスタート

### オプション A: デスクトップ (Chrome 拡張機能 + ローカルブリッジ)

**1. リポジトリのクローン**
```bash
git clone https://github.com/sonhoang10800-afk/language-caption.git
cd language-caption
```

**2. ローカルブリッジの起動**
```bash
cd local-bridge
./start.sh
```
ブリッジは `http://127.0.0.1:8765` で実行されます。

**3. 辞書のブートストラップ（初回のみ）**
大容量の辞書は Git に**含まれていません**。
```bash
curl -X POST http://127.0.0.1:8765/bootstrap
curl -s http://127.0.0.1:8765/health
```

**4. Chrome 拡張機能のインストール**
1. Chrome を開き、`chrome://extensions` にアクセス。
2. 右上の **デベロッパーモード** を有効に。
3. **パッケージ化されていない拡張機能を読み込む** をクリックし、`extension/` フォルダを選択。
4. YouTubeビデオを開いて完了！

拡張機能のコードを変更した後は、プロジェクトルートで `./scripts/reload-extension.sh` を実行します（Reload ボタン不要）。

### オプション B: iPad アプリ (ネイティブ)
1. **Xcode** で `ipad-app/LanguageCaption.xcodeproj` を開く（`project.yml` 変更時は `xcodegen`）。
2. iPad またはシミュレータを選択。
3. ビルド実行 (Cmd + R)。`Resources/dict.sqlite` と `freq_ja.json` がバンドルに含まれること。
4. YouTube URL を貼付 → Overlay / Side panel をON → 色付き単語をタップして辞書ポップアップ（VI+EN）。

### オプション C: iPhone アプリ (ネイティブ)
1. **Xcode** で `iphone-app/LanguageCaptioniPhone.xcodeproj` を開く（なければ `cd iphone-app && xcodegen`）。
2. iPhone シミュレータまたは実機 → ビルド実行。縦=積み / 横=分割。詳細: `iphone-app/Scripts/COMMANDS.md`。

---

<a id="tiếng-việt"></a>
# 🇻🇳 Tiếng Việt

**YouTube JP Caption Studio** là công cụ học tiếng Nhật qua YouTube kiểu Language Reactor. Nền tảng: **Chrome Extension** (Desktop) và **Native iPad / iPhone App**. Hỗ trợ bắt timedtext JA, overlay, Side Panel, furigana (Sudachi / NaturalLanguage), từ điển JMdict (gloss **EN + VI**), tô màu theo JLPT, import/export EN–VI thủ công.

Không dùng OCR. Bản dịch có thể lấy từ track EN/VI, Import, sửa tay hoặc Gemini tùy cấu hình API key trên Desktop. Luồng dịch câu của sentence MVP đang triển khai; chưa có số đo readiness/latency cho bản này. Extension cũng đọc phụ đề native của ABEMA và web video khác qua `<track>`/WebVTT/textTracks.

## 🌟 Tính năng chính
1. **Phụ đề thông minh**: Bắt timedtext JA từ YouTube (và phụ đề native từ ABEMA / web video khác qua textTrack/WebVTT) → overlay + Side Panel (toggle JA/EN/VI; EN+VI mặc định bật). Nếu video có track EN/VI trên YouTube thì union-merge (±0,35s; orphan thành cue mới; không ghi đè Import/sửa tay).
2. **Furigana & Từ điển Mazii**: JMdict (+ JA→VI / EN→VI) kết hợp cơ sở dữ liệu Mazii offline 240k từ. Chạm/hover từ → popup Mazii hiện đại với banner nghĩa cốt lõi, âm Hán Việt, cấp độ JLPT, ví dụ thực tế và từ loại tiếng Việt rõ ràng. Cơ chế **Hover Transit Lock (200ms)** và **Click-to-Pin** (ghim popup) chống nhảy từ khó chịu khi rê chuột qua các token trung gian, cùng thuật toán khử trùng lặp nghĩa (Sense Deduplication).
3. **Tô màu JLPT / tần suất**: Token màu N5→N1 / unknown từ `freq_ja.json` (chung Desktop và iPad).
4. **Từ vựng cá nhân**: Desktop đánh dấu Đã biết / Đang học / Bỏ qua / Đặc biệt. iPad: Lưu từ từ popup vào SwiftData (UI đánh dấu trạng thái vẫn ưu tiên Desktop).
5. **Sửa phụ đề**: Side Panel sửa JA/EN/VI + timeline; Import/Export `.txt`/`.json`. iPad: JA dạng token chạm được; **Sửa JA** để gõ.
6. **Lưu trữ Local (Data Ownership)**: Bản dịch/sửa ưu tiên lưu local; YouTube không đè lên. `script.txt` từ bridge luôn có đủ dòng `JA:` / `EN:` / `VI:` mỗi cue (được phép trống).
7. **Auto IME (chỉ macOS Desktop)**: Tự chuyển bàn phím Nhật khi sửa JA.
8. **App iPad / iPhone Native**: SwiftUI độc lập (`ipad-app/`, `iphone-app/`) — hardsub, dict popup, import/export — không cần server. iPhone: portrait xếp dọc / landscape chia đôi. Chưa đủ parity tuyệt đối (không Auto IME; chưa mark Known/Learning trên popup).
9. **Đồng bộ Drive (PC ↔ iPad/iPhone)**: Cùng file `caption-studio-backup.json` trong folder Drive cố định. Extension: OAuth + bridge `/backup/snapshot`; native: Files + auto-pull khi foreground. Setup: thay `client_id` trong `manifest.json`, Connect Drive, chọn cùng folder (xem `walkthrough.md` §3.5).
10. **Tự động inject kịch bản AnimeVietSub**: Tự động tra cứu AniList GraphQL & Jimaku.cc để tải kịch bản tiếng Nhật vào Chrome Side Panel khi xem phim trên AnimeVietSub (`animevietsub.best`, `.news`, `.tv`). Nút nổi `LR PANEL` trên video player mở nhanh Side Panel, đồng bộ 2 chiều (bắt timeupdate từ iframe player và seek khi click cue trong panel), giữ 0 overlay che video để không đè hardsub tiếng Việt. Cấu hình Jimaku API Key trong popup/modal Cài đặt.

## 🏗 Kiến trúc Hệ thống
Dự án được xây dựng với hai kiến trúc hoàn toàn khác nhau để tối ưu cho cả Desktop và Mobile:

### 1. Kiến trúc Desktop (Phân tách Client-Server)
* **Chrome Extension (MV3)**: Quản lý DOM của YouTube, chặn bắt phụ đề, render UI và đồng bộ trạng thái.
* **Local Bridge (FastAPI `:8765`)**: Backend cục bộ viết bằng Python. Tokenize (Sudachi), tra cứu từ điển SQLite, lưu trữ file I/O và điều khiển bộ gõ (IME) trên macOS.
* **Next.js Web App (`:3000`)**: Ứng dụng quản lý từ vựng và thiết lập, đóng gói thành Popup UI.

### 2. Kiến trúc iPad / iPhone (Ứng dụng Độc lập SwiftUI)
* **WKWebView Player**: Nhúng YouTube, bắt sự kiện và phụ đề qua JS bridge.
* **SwiftUI Native Views**: Hardsub (`TokenizedJAView` + `DictPopupView`) và Side Panel (`CueEditorRow`). iPhone: layout theo orientation + top bar gọn.
* **Apple NLP + freq map**: `NLPTagger` tokenize/furigana; `freq_ja.json` tô JLPT (cùng ceiling Desktop `vocab_freq.py`).
* **SwiftData & SQLite**: Bundle `dict.sqlite` tra VI+EN; SwiftData lưu script và từ đã lưu.

## 🚀 Hướng dẫn Cài đặt

### Lựa chọn A: Desktop (Chrome Extension + Local Bridge)

**1. Clone Source Code**
```bash
git clone https://github.com/sonhoang10800-afk/language-caption.git
cd language-caption
```

**2. Khởi chạy Local Bridge**
```bash
cd local-bridge
./start.sh
```
Server Local Bridge sẽ chạy tại `http://127.0.0.1:8765`.

Không muốn mở Terminal: build menu-bar app rồi double-click — `cd macos-bridge-app && INSTALL=1 ./build.sh` rồi `open "/Applications/Caption Studio Bridge.app"` (xem `macos-bridge-app/README.md`).

**3. Tải và Build Từ điển (Chỉ chạy lần đầu)**
Vì database từ điển rất nặng nên **không** được commit lên Git.
```bash
curl -X POST http://127.0.0.1:8765/bootstrap
curl -s http://127.0.0.1:8765/health
```

**4. Cài đặt Chrome Extension**
1. Mở Chrome, truy cập `chrome://extensions`.
2. Bật **Developer mode**.
3. Bấm **Load unpacked** và chọn thư mục `extension/`.
4. Mở một video YouTube và trải nghiệm!

Sau khi sửa code extension, chạy `./scripts/reload-extension.sh` từ thư mục project. Script tự reload extension và refresh tab YouTube, không cần bấm Reload.

### Lựa chọn B: Ứng dụng iPad (Native)
1. Mở `ipad-app/LanguageCaption.xcodeproj` bằng **Xcode** (đổi `project.yml` thì chạy `xcodegen`).
2. Chọn iPad hoặc Simulator.
3. Build and Run (Cmd + R). Bundle phải có `Resources/dict.sqlite` và `freq_ja.json`.
4. Dán URL YouTube → bật **Overlay** / **Side panel** → chạm từ màu để mở popup từ điển (VI+EN + dịch câu).

### Lựa chọn C: Ứng dụng iPhone (Native)
1. Mở `iphone-app/LanguageCaptioniPhone.xcodeproj` bằng **Xcode** (`cd iphone-app && xcodegen` nếu thiếu). Bundle ID: `com.example.LanguageCaption.iPhone`.
2. Chọn iPhone Simulator hoặc máy thật → Build and Run.
3. Xoay: portrait xếp dọc / landscape chia đôi. Deploy: `iphone-app/Scripts/COMMANDS.md`.
