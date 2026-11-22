<!-- date: 2026-11-22 -->
<!-- source: chat:goal · user: quét toàn bộ codebase, nêu điểm chưa hợp lý -->

# Quét codebase 2026-11-22 — điểm chưa hợp lý

Quét đọc code trên disk. Mười sáu subagent chia vùng (extension content / side panel / background, local-bridge API / tokenize / ASR / persistence / tests, web saved-items, iPad+iPhone, ios-shared, macOS+tools, scripts+CI, tests+fixtures, security, docs↔code). Parent đọc lại từng trích dẫn P0/P1 bên dưới trước khi ghi. Không chạy app, không chạy pytest, không sửa product code.

Nhãn: **[FACT]** là dòng đang có trên disk. **[INFERENCE]** là mức độ ảnh hưởng. Không có P0 “mất dữ liệu đã chứng minh bằng runtime”.

## Tóm tắt

| Mức | Số cụm đã parent xác nhận | Ý nghĩa |
|-----|---------------------------|---------|
| P0 | 1 | Trang web bất kỳ điều khiển được content script: ghi API key, đọc phụ đề, gọi Gemini |
| P1 | 12 | Sai hành vi người dùng thấy, lệch dữ liệu, hoặc lỗ hổng local |
| P2 | nhóm | Nợ thiết kế, test không khóa hành vi, wiki lệch disk |

Phần khỏe, không cần đụng: `script_store` chặn `video_id` lạ và chỉ ghi tên file cố định; SQL saved-items dùng placeholder; không có `shell=True` trên bridge; script deploy iPad/iPhone ghi đè cài đặt, không xóa app; `renderBilingualHtml` không tô JLPT cả câu khi không có token Nhật.

## P0

### P0-1. `postMessage` từ trang web ghi key và kéo Gemini

**[FACT]** Content script lắng nghe `window.message` trước khi kiểm tra `e.source` / capability token. Handler timedtext phía dưới mới gọi `capAcceptsReply`. Manifest inject content script lên `http://*/*` và `https://*/*`.

```6649:6717:extension/content/content.js
    window.addEventListener("message", (e) => {
      if (e.data?.type === "AVS_DEBUG_PING") {
        // ... postMessage AVS_DEBUG_PONG với snippet key, cue JA/VI/EN, target "*"
      }
      if (e.data?.type === "AVS_TEST_TRANSLATE") {
        // translateCues(..., { force: true }) rồi postMessage kết quả, target "*"
      }
      if (e.data?.type === "AVS_SET_JIMAKU_KEY" && typeof e.data.key === "string") {
        chrome.storage.local.set({ jimakuApiKey: key });
      }
      if (e.data?.type === "AVS_SET_GEMINI_KEY" && typeof e.data.key === "string") {
        globalThis.HardsubGeminiTranslate?.saveApiKey(key)
      }
```

**[INFERENCE]** Script trên trang (quảng cáo, XSS site) gửi được ba message này. Hệ quả: đổi key Jimaku/Gemini, đọc vài cue và hình dạng key, gọi dịch có tính phí.

Sửa nhỏ: xóa ba handler khỏi bản người dùng, hoặc chỉ nhận khi `e.source === window` cộng token giống `pageCapToken`, và không `postMessage(..., "*")`.

## P1 — đã đọc lại trên disk

### P1-1. Capability token rỗng thì reply giả được nhận

**[FACT]** `capAcceptsReply` trả true khi `expected` rỗng và `provided` khác rỗng. Comment trong file ghi đúng cửa sổ này: reload content script thấy sẵn `#hardsub-ocr-page-script` thì không mint token mới.

```181:188:extension/content/content.js
  function capAcceptsReply(expected, provided) {
    if (!provided) return false;
    return !expected || provided === expected;
  }
  function injectPageScript(force = false) {
    const existing = document.getElementById("hardsub-ocr-page-script");
    if (existing && !force) return;
```

Wiki `codebase-audit-2026-10-22` ghi A-4 **đã sửa**. Phần “thiếu token thì từ chối” đúng (`!provided`). Phần “token rỗng thì nhận mọi reply có cap” vẫn mở. Sửa: mint token trước `return`, rồi bỏ `!expected`.

### P1-2. Side panel thay cả cache tab bằng payload thiếu cue

**[FACT]** `publishSidePanelPartial` gửi `SP_STATE` không có `cues` và không có `videoId` (`content.js` 4233–4248). Listener ghi đè:

```2585:2586:extension/sidepanel/sidepanel.js
      tabStates.set(msg.tabId, { ...(msg.payload || {}), tabId: msg.tabId });
```

Đổi tab chỉ dùng cache khi `cached.videoId === activeVid` (`sidepanel.js` 2637–2639). Payload partial không có `videoId` nên cache trượt, UI xóa list rồi mới `get_state`.

Cùng file, comment nói bỏ payload cue cũ nhưng code chỉ ghi `lastCueSeq`, không so sánh:

```1794:1797:extension/sidepanel/sidepanel.js
    // Drop stale full cue payloads (async publish race). Partial updates omit cues.
    if (Array.isArray(incoming.cues) && typeof incoming._seq === "number") {
      lastCueSeq = incoming._seq;
    }
```

Sửa: merge cache (`{ ...cũ, ...mới }`, đừng xóa `cues`/`videoId` khi payload không gửi); nếu `_seq < lastCueSeq` thì bỏ mảng `cues`.

### P1-3. Tab Saved của side panel bỏ từ `known` / `ignored`

**[FACT]**

```2028:2030:extension/sidepanel/sidepanel.js
    const userVocabEntries = Object.entries(state.userVocab || {}).filter(
      ([, v]) => v && (v === "learning" || v === "special" || v?.status === "learning" || v?.status === "special")
    );
```

Popup saved-items đọc đủ status. Từ đánh “đã biết” biến mất khỏi tab Saved / export của panel.

### P1-4. Netflix probe buộc track JA, không trả track cũ

**[FACT]** `switchTrackAndWait(jaTrack, "ja", true)` luôn gọi `player.setTimedTextTrack` (`extension/injected/page_capture.js` 1785–1808). Không lưu track người xem đang bật.

### P1-5. Phụ đề phụ bị nuốt khi hàng đã khóa

**[FACT]** `fill_yt_secondary.js` 167–172: match thì `used.add(i)` trước, chỉ `paintField` khi `canPaint`. Hàng khóa hoặc đã có chữ vẫn tiêu thụ cue EN/VI; không rơi xuống orphan.

### P1-6. “Xóa sub — tải lại” trên script owned trả list rỗng

**[FACT]** `wipeAndReload` tombstone rồi `loadCaptions` (`ipad-app/Views/ContentView.swift` 1073–1077; iPhone cùng hướng). `wipeAll` không tắt `VideoScript.owned` (`ScriptStore.swift` 160–173). `mergeWithLocal` khi `owned == true` chỉ trả cue chưa tombstone (`ScriptStore.swift` 114–116) — sau wipe là mảng rỗng, không nhận cue YouTube.

Tombstone để Drive không hồi sinh script là chủ ý. Dòng trạng thái “đang tải lại” thì không. Sửa: nút wipe owned không hứa tải YouTube, hoặc tắt `owned` trước khi merge.

### P1-7. iPhone không sửa cue; iPad thì có

**[FACT]** `iphone-app/Views/CueEditorRow.swift` dòng 6: “No cue menu / EN / inline edit chrome.” iPad `CueEditorRow` có `TextField`. `DriveScriptsService.swift` vẫn nằm riêng mỗi app (~cùng logic). Hai bản sẽ lệch tiếp.

### P1-8. Backup iOS không cập nhật từ đã có, và không có `status`

**[FACT]** `VocabDTO` không có `status` (`BackupService.swift` 70–77) trong khi `local-bridge/app/services/snapshot.py` ghi `status`. Merge:

```396:397:ios-shared/Sources/CaptionShared/Services/BackupService.swift
            for vd in snap.vocab {
                if merge, localWords.contains(vd.word) { continue }
```

Từ đã có trên máy không nhận reading/meaning/tần suất mới. Status `known`/`learning` rơi khi đi qua snapshot iOS.

### P1-9. Settings web báo đã lưu khi `chrome.storage.set` lỗi

**[FACT]** `web/saved-items/src/lib/settings-store.ts` 301–317: trong extension, `set` ném lỗi thì ghi `localStorage` của trang và return `"localStorage"`. Content script đọc `chrome.storage`, không đọc localStorage của popup.

Nhiều field settings chỉ `patch()` trong React (`SettingsPanel.tsx`); chỉ overlay/JLPT tự ghi. Reload trước nút Lưu thì mất.

### P1-10. `extension_state` ghi đè cả map; file hỏng thành state rỗng

**[FACT]** Docstring `post_extension_state` nói “Partial update” (`state.py` 91) nhưng gán thẳng `_ext_state["userVocab"] = cleaned` và `savedCues` (94–104). `load_ext_state_disk` nuốt mọi exception (52–53) và giữ default rỗng (24–30). Lần POST sau gọi `_save_ext_state_disk` và đè file hỏng.

`save_script` cho hai writer cùng `rev` đi tiếp (`script_store.py` 452–454: chỉ chặn `rev < current`). `write_files` thì không.

### P1-11. Hai khóa `BILINGUAL_MAP` — khóa sau thắng, JLPT đổi

**[FACT]** `extension/shared/vocab_style.js`: `どうして` n4 ở dòng 630 rồi n5 ở 688; `出す` n4 ở 633 rồi n5 ở 708. Object literal giữ bản sau. Ngoài ra nhánh tên riêng `鈴か` (khoảng 1686) không đi từ từ điển.

`vocab_freq.py` trả `"n1"` khi có hạng tần suất nhưng không có trong bảng JLPT — tô mức giả, không phải tô cả câu.

### P1-12. Key Jimaku nằm fallback trong test

**[FACT]** `extension/shared/anime_resolver_test.js` dòng 75: `process.env.JIMAKU_API_KEY || "<chuỗi cố định>"`. Không chép lại chuỗi ở đây. Nên xóa fallback, skip test khi thiếu env, và xoay key nếu chuỗi đó còn sống.

Bridge localhost không có secret. `main.py` CORS cho mọi `chrome-extension://` 32 ký tự và mọi `localhost:*`. `start.sh` bind `127.0.0.1` nên đây không phải lỗ từ internet. Mọi trang localhost và mọi extension khác gọi được `POST /scripts/save`, `/extension_state`, `/ime/switch`, `/bootstrap`. **[INFERENCE]** P1 trên máy dùng chung hoặc trang local độc.

## P2 — cụm, không liệt kê từng dòng

- **Caption fetch.** `captions.py` `_http` đọc hết body, không trần byte; `baseUrl` từ JSON YouTube đi thẳng vào `urlopen` (100–103); route không gọi `validate_video_id`. SSRF chỉ thành hiện thực nếu JSON track bị đổi host.
- **ASR.** PCM ffmpeg được cấp phát trước khi so `MAX_AUDIO_DURATION_SEC` (`asr.py`). Upload 50 MiB đã có trần.
- **Dual store.** `/saved/*` → SQLite; `/api/saved-items` và `/extension_state` → `extension_state.json`. Web load cue không GET bridge trong khi vocab thì có (`vocab-store.ts` `loadSavedCuesAsync`).
- **Test không khóa hành vi.** CI `extension-tests` không chạy `extension/content/frame_relay_test.js` (`.github/workflows/ci.yml` 146). `tests/unit/test_player_ui_runtime.js` không nằm trong `pytest tests/`. `test_captions_cache.py` so một tuple local, không đi qua route. `test_api_contracts.py` chấp nhận `/meta` 404 sau save. `test_saved_items.py` ghi `data/config/extension_state.json` thật. `scripts/tdd_pixel_and_timing_test.js` kiểm bản copy parser, không phải `page_capture.js`.
- **Fixture audio.** `testdata/challenge-audio/manifest.json` trỏ `wav/` không có trong tree. Manifest dịch MOFA trỏ wav không commit.
- **macOS menu app.** `macos-bridge-app/Sources/main.swift` `lsof | xargs kill` mọi listener cổng 8765 và 3000 khi app này đã start bridge.
- **Script.** `scripts/import_mazii_to_sqlite.py` `INSERT OR REPLACE` vào `data/dict/dict.sqlite` không backup. `scripts/reload-extension.sh` exit 3 là verify fail; `AGENTS.md` §9 gọi exit 3 là `extension_not_loaded`.
- **Popup HTML.** Bản export `extension/popup/` prerender chữ “Local demo” / “Reset demo” trước khi hydrate.
- **Anki export.** `vocab-store.ts` ghi `#html:true` và không escape `<` trong cue.
- **Comment MIRRORED.** `plan/swift-shared-package-2026-10-23.md` ghi `grep MIRRORED FILE` = 0. Disk vẫn còn header đó trong `ScriptStore.swift`, `BackupService.swift`, `DriveAuthService.swift`, `DriveOAuthConfig.swift`. Package `ios-shared` thì đã có — header là lời chỉ dẫn sai, không phải hai bản copy.

## Wiki đang lệch disk

| Chỗ | Disk |
|-----|------|
| `wiki/index.md` dòng audit 2026-10-22: “8 P0 / 24 P1, not remediated” | `wiki/topics/codebase-audit-2026-10-22.md` đánh phần lớn **đã sửa**. A-4 còn phần P1-1. |
| `wiki/index.md` C-1: “chưa refactor” | Plan và status topic ghi **HOÀN TẤT A–E**. `ios-shared/` có code. Mục Open của topic vẫn viết “Chưa có commit”. |
| `wiki/index.md` P0 data-loss: **done** | Topic vẫn để extension chưa merge từng cue. |
| `README.md` “Gemini 3.8 Flash”; JA/VI vẫn `caption-studio-backup.json` | `gemini_translate.js` default `gemini-3.6-flash`. EN README đã có tên `language-caption-*`. |

`wiki/topics/local-bridge-audit.md` còn LB-6 “load không mutex”. `load_script` hiện nằm trong `_video_lock` (`script_store.py` 538+). LB-3 (không auth) vẫn đúng, xem P1-12.

## Thứ tự sửa nếu làm tiếp

1. P0-1: gỡ hoặc khóa `AVS_DEBUG_PING` / `AVS_TEST_TRANSLATE` / `AVS_SET_*_KEY`.
2. P1-2: merge cache side panel và thực sự drop `_seq` cũ.
3. P1-1: mint `pageCapToken` trước early-return.
4. P1-10: merge `extension_state`; khi JSON hỏng thì không cho ghi đè bằng default.
5. P1-6 và P1-8: owned-wipe và vocab merge/status.
6. P1-11: xóa key trùng trong `BILINGUAL_MAP`.
7. P1-12: xóa key test, cân nhắc secret cho route ghi của bridge.

## Phạm vi subagent

| Agent | Vùng |
|-------|------|
| content / injected / offscreen | `extension/content`, `injected`, `offscreen` |
| side panel + popup | `extension/sidepanel`, `extension/popup` |
| background + shared | `service_worker.js`, `vocab_style.js`, manifest |
| bridge API | `local-bridge/app/api`, `main.py`, schemas |
| tokenize / JLPT | `tokenize_ja`, `dictionary`, `vocab_freq`, `vocab_style.js` |
| ASR / caption / IME | `asr.py`, `captions.py`, `ime_switch.py` |
| persistence | `state.py`, `script_store.py`, `saved_items_db.py` |
| bridge tests | `local-bridge/tests` |
| saved-items web | `web/saved-items/src` |
| iPad + iPhone | hai app Swift |
| ios-shared | `CaptionShared`, `uitests-shared` |
| macOS + tools | `macos-bridge-app`, `tools/` |
| scripts + CI | `scripts/`, `.github/workflows/ci.yml` |
| tests + testdata | `tests/`, `testdata/` |
| security sweep | repo, bỏ `node_modules` / `.next` |
| docs | `wiki/`, `README.md`, `TODOS.md` |

## CI sau khi mở PR

Job `sanity-scripts` trên commit docs fail `scripts/sentence_cost_sanity.js` dòng 67: actual `NOT VERIFIED`, expected `PARTIAL ESTIMATE`. Master lần xanh gần nhất là 2026-11-09. `sentence_benchmark.js` chỉ tính giá khi `startedAtMs` nằm trước `priceEvidence.validUntil` = `2026-11-10`. Fixture lấy `startedAtMs` từ đồng hồ lúc chạy, nên sau ngày đó attempt “đã có giá” cũng thành null và status rơi xuống `NOT VERIFIED`. Sửa test: ghim `startedAtMs` vào `2026-10-15T00:00:00Z`, trong cửa sổ đã công bố. Không bịa giá mới.

## Chưa kiểm

Không có bằng chứng runtime: không bật Chrome, không POST bridge, không build iOS, không đo Netflix đổi track trên player thật. Mức P0/P1 ở trên là từ luồng code, không từ lần repro trên máy.
