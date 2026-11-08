import SwiftUI
import CaptionShared
import SwiftData

struct ContentView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.scenePhase) private var scenePhase
    @Query private var vocabularies: [Vocabulary]

    @AppStorage("sidePanelFraction") private var sidePanelFraction = 0.28
    /// Match desktop `showOnVideo: false` — user enables on a watch page.
    @AppStorage("languageCaptionOverlayOn") private var overlayOn = false
    @AppStorage("sidePanelOn") private var sidePanelOn = false
    @AppStorage("languageCaptionShowJA") private var showJA = true
    /// Desktop defaults: barShowEn / barShowVi are on unless explicitly off.
    /// `.v2` keys: older builds stored false; rename so new defaults apply once.
    @AppStorage("languageCaptionShowEN.v2") private var showEN = true
    @AppStorage("languageCaptionShowVI.v2") private var showVI = true
    @AppStorage("languageCaptionShowFurigana") private var showFurigana = true
    @AppStorage("isDarkTheme") private var isDarkTheme = true
    @AppStorage("followTimeline") private var followTimeline = true
    @AppStorage("languageCaptionBarScale") private var overlayFontScale = 1.0
    @AppStorage("sidePanelFontScale") private var sidePanelFontScale = 1.0

    @State private var urlField = "https://www.youtube.com/watch?v=MOIbaNe4Pmw"
    @State private var videoID = "MOIbaNe4Pmw"
    @State private var currentCues: [ScriptCue] = []
    /// YT sync anchors (class so high-freq writes don't invalidate SwiftUI).
    @State private var playheadSync = PlayheadSync()
    /// Stable id for list highlight / scroll — updated only when the active cue changes.
    @State private var activeCueId: String?
    @State private var isPlaying: Bool = false
    @State private var seekRequest: Double? = nil
    @State private var reloadNonce = 0
    @State private var historyAction: PlayerHistoryAction? = nil
    @State private var canGoBack = false
    @State private var canGoForward = false
    @State private var isLoadingCaptions = false
    @State private var statusMessage: String?
    @State private var toolTab: ToolTab = .subtitles
    @State private var dragStartFraction: CGFloat?
    @State private var videoFrame: CGRect?
    @State private var layoutOK = false
    @State private var layoutNote: String?
    @State private var showSettings = false
    @State private var confirmClearMT = false
    @State private var confirmWipe = false
    @State private var showImporter = false
    @State private var pendingImport: PendingImport?
    @State private var importMode: ScriptCue.ImportMode = .merge
    @State private var importIncludeJA = false
    @State private var exportURL: URL?
    /// From WKWebView `PAGE_NAV` — nil on YT home/search (desktop-equivalent gate).
    @State private var pageWatchID: String?
    @State private var pageNavKnown = false
    /// Side-panel edit in progress — skip auto-scroll (desktop `isEditingAny`).
    @State private var editingCue = false
    /// Bump to force one scroll-to-active after re-enabling follow.
    @State private var followResumeNonce = 0
    /// Ignore drag/scroll that comes from our own `scrollTo` (desktop `ignoreScrollEvent`).
    @State private var ignoreScrollEvent = false
    /// Animated follow scroll in flight — coalesce rapid activeCue flips (1–2 char cues).
    @State private var scrollAnimInFlight = false
    @State private var pendingScrollId: ScriptCue.ID?
    /// Global frames for follow — skip scrollTo when active row is already ~at list top.
    @State private var cueListBounds: CGRect = .null
    @State private var cueRowFrames: [String: CGRect] = [:]
    @FocusState private var urlFocused: Bool
    @State private var isPlayerFullscreen = false
    @State private var sidePanelBeforeFullscreen: Bool?
    @State private var fullscreenToggleNonce = 0

    private enum ToolTab: String, CaseIterable {
        case subtitles = "Phụ đề"
        case vocab = "Từ vựng"
    }

    private var activeCue: ScriptCue? {
        guard let id = activeCueId else { return nil }
        return currentCues.first { $0.id == id && !$0.tombstoned }
    }

    /// Live playhead (ms) from last YT sync + short extrapolate — not @State.
    private var playheadMs: Double {
        if isPlaying {
            let elapsed = Date().timeIntervalSince(playheadSync.at) * 1000
            return playheadSync.timeMs + min(elapsed, 300)
        }
        return playheadSync.timeMs
    }

    /// Desktop: content/side panel only on YouTube watch with `?v=`.
    private var onYouTubeWatch: Bool {
        pageNavKnown ? pageWatchID != nil : !videoID.isEmpty
    }

    private var overlayShown: Bool { overlayOn && onYouTubeWatch }
    private var sidePanelShown: Bool { sidePanelOn && onYouTubeWatch && !isPlayerFullscreen }

    var body: some View {
        VStack(spacing: 0) {
            if !isPlayerFullscreen {
                topBar
                Divider()
            }
            GeometryReader { geo in
                let wide = geo.size.width >= 800
                Group {
                    if wide {
                        wideLayout(size: geo.size)
                    } else {
                        compactLayout(size: geo.size)
                    }
                }
            }
        }
        .background(Color.black)
        .preferredColorScheme(isDarkTheme ? .dark : .light)
        // Saved cues first, Drive REST after (needs prior Connect / token in Keychain).
        .task(id: videoID) {
            await loadCaptions(for: videoID)
            guard DriveAuthService.shared.hasToken else { return }
            let result = await DriveScriptsService.sync(videoId: videoID, context: modelContext)
            applyDriveSync(result)
        }
        // ponytail: was 30Hz @State (full tree); now only refresh activeCueId (~8Hz, writes when id changes)
        .onReceive(Timer.publish(every: 0.125, on: .main, in: .common).autoconnect()) { _ in
            guard scenePhase == .active else { return }
            refreshActiveCueId(at: playheadMs)
        }
        .sheet(isPresented: $showSettings) { SidePanelSettingsSheet() }
        .confirmationDialog("Xóa toàn bộ EN/VI?", isPresented: $confirmClearMT, titleVisibility: .visible) {
            Button("Xóa dịch", role: .destructive) { clearTranslations() }
            Button("Hủy", role: .cancel) {}
        }
        .confirmationDialog("Xóa sub đã lưu và tải lại từ YouTube?", isPresented: $confirmWipe, titleVisibility: .visible) {
            Button("Xóa sub", role: .destructive) { wipeAndReload() }
            Button("Hủy", role: .cancel) {}
        }
        .fileImporter(isPresented: $showImporter, allowedContentTypes: [.plainText, .json], allowsMultipleSelection: false) { result in
            handleImport(result)
        }
        .sheet(isPresented: Binding(
            get: { exportURL != nil },
            set: { if !$0 { exportURL = nil } }
        )) {
            if let url = exportURL {
                ActivityView(url: url)
            }
        }
        .task {
            #if DEBUG
            runAutotestIfRequested()
            #endif
            BackupService.shared.autoRestoreIfEmpty(context: modelContext)
            if BackupService.shared.syncFromDriveIfNewer(context: modelContext) {
                currentCues = ScriptCue.load(videoId: videoID, context: modelContext).filter { !$0.tombstoned }
            }
            if let s = BackupService.shared.status { statusMessage = s }
            SettingsSync.shared.startObserving()
            if DriveAuthService.shared.hasToken {
                await SettingsSync.shared.pullIfNewer()
                await VocabSync.shared.pullIfNewer(context: modelContext)
            }
        }
        .onChange(of: scenePhase) { _, phase in
            // Flush only — do not pause YouTube when backgrounding.
            if phase == .background {
                BackupService.shared.flushPending(context: modelContext)
            } else if phase == .active {
                // Backup first: its restore rebuilds VideoScript rows, so the Drive sync
                // must run after to re-establish rev.
                let restored = BackupService.shared.syncFromDriveIfNewer(context: modelContext)
                if restored {
                    currentCues = ScriptCue.load(videoId: videoID, context: modelContext).filter { !$0.tombstoned }
                }
                if let s = BackupService.shared.status { statusMessage = s }
                Task {
                    guard DriveAuthService.shared.hasToken else { return }
                    await SettingsSync.shared.pullIfNewer()
                    await VocabSync.shared.pullIfNewer(context: modelContext)
                    let result = await DriveScriptsService.sync(videoId: videoID, context: modelContext)
                    applyDriveSync(result)
                }
            }
        }
    }

    // MARK: - Layouts

    private func wideLayout(size: CGSize) -> some View {
        let panel = clampedPanelWidth(total: size.width)
        return HStack(spacing: 0) {
            playerPane
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            if sidePanelShown {
                resizeSplit(axis: .horizontal, total: size.width)
                toolsColumn
                    .frame(width: panel)
                    .frame(maxHeight: .infinity)
            }
        }
    }

    private func compactLayout(size: CGSize) -> some View {
        let panel = clampedPanelHeight(total: size.height)
        return VStack(spacing: 0) {
            playerPane
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            if sidePanelShown {
                resizeSplit(axis: .vertical, total: size.height)
                toolsColumn
                    .frame(height: panel)
                    .frame(maxWidth: .infinity)
            }
        }
    }

    private func clampedPanelWidth(total: CGFloat) -> CGFloat {
        let minW: CGFloat = 280
        let maxW = max(minW, total * 0.55)
        return min(max(total * sidePanelFraction, minW), maxW)
    }

    private func clampedPanelHeight(total: CGFloat) -> CGFloat {
        let minH: CGFloat = 180
        let maxH = max(minH, total * 0.65)
        return min(max(total * sidePanelFraction, minH), maxH)
    }

    private func resizeSplit(axis: Axis, total: CGFloat) -> some View {
        let thickness: CGFloat = 10
        return ZStack {
            Color(uiColor: .separator).opacity(0.35)
            Capsule()
                .fill(Color.secondary.opacity(0.45))
                .frame(
                    width: axis == .horizontal ? 4 : 36,
                    height: axis == .horizontal ? 36 : 4
                )
        }
        .frame(width: axis == .horizontal ? thickness : nil,
               height: axis == .vertical ? thickness : nil)
        .background(Color(uiColor: .systemBackground))
        .contentShape(Rectangle())
        .gesture(
            DragGesture(minimumDistance: 1)
                .onChanged { value in
                    if dragStartFraction == nil { dragStartFraction = sidePanelFraction }
                    let start = dragStartFraction ?? sidePanelFraction
                    let delta: CGFloat = {
                        switch axis {
                        case .horizontal: return -value.translation.width / max(total, 1)
                        case .vertical: return -value.translation.height / max(total, 1)
                        }
                    }()
                    sidePanelFraction = min(0.55, max(0.22, start + delta))
                }
                .onEnded { _ in dragStartFraction = nil }
        )
        .accessibilityLabel("Resize side panel")
        .help("Kéo để đổi kích thước panel")
    }

    // MARK: - Player (full bleed)

    private var playerPane: some View {
        ZStack {
            Color(red: 0.07, green: 0.07, blue: 0.07)
            YouTubePlayerView(
                videoID: videoID,
                onCaptionsReceived: { _, payload in
                    let parsed = SubtitleParser.parseTimedtext(body: payload)
                    guard !parsed.isEmpty else { return }
                    Task { @MainActor in
                        // Owned Drive/import script: keep panel; don't let YT wipe after sync.
                        let d = FetchDescriptor<VideoScript>(predicate: #Predicate { $0.videoId == videoID })
                        if let s = try? modelContext.fetch(d).first, s.owned, !currentCues.isEmpty { return }
                        currentCues = ScriptCue.mergeWithLocal(videoId: videoID, youtubeCues: parsed, context: modelContext)
                        statusMessage = nil
                    }
                },
                onTimeUpdate: { currentTime, _, paused in
                    playheadSync.timeMs = currentTime * 1000
                    playheadSync.at = Date()
                    let playing = !paused
                    if isPlaying != playing { isPlaying = playing }
                    refreshActiveCueId(at: playheadSync.timeMs)
                },
                onVideoRect: { rect in
                    if let prev = videoFrame,
                       abs(prev.minX - rect.minX) < 2, abs(prev.minY - rect.minY) < 2,
                       abs(prev.width - rect.width) < 2, abs(prev.height - rect.height) < 2 {
                        return
                    }
                    videoFrame = rect
                },
                onLayoutCheck: { dict in
                    let noFixed = (dict["noFixedPlayer"] as? Bool) ?? ((dict["noFixedPlayer"] as? NSNumber)?.boolValue ?? false)
                    let hasBottom = (dict["hasBottomChrome"] as? Bool) ?? ((dict["hasBottomChrome"] as? NSNumber)?.boolValue ?? false)
                    let ratio = (dict["ratio"] as? Double) ?? (dict["ratio"] as? NSNumber)?.doubleValue ?? 0
                    layoutOK = noFixed && hasBottom
                    layoutNote = String(format: "Player %.0f%% · bottomChrome=%@ · fixed=%@",
                                        ratio * 100,
                                        hasBottom ? "yes" : "NO",
                                        noFixed ? "no" : "YES")
                    UserDefaults.standard.set(layoutOK, forKey: "debugLayoutOK")
                    UserDefaults.standard.set(layoutNote, forKey: "debugLayoutNote")
                    #if DEBUG
                    // Debug dumps only — a Release build must not litter the user's
                    // Files app with layout_smoke.* on every layout check.
                    if let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first {
                        let payload = "ok=\(layoutOK)\n\(layoutNote ?? "")\n"
                        try? payload.write(to: dir.appendingPathComponent("layout_smoke.txt"), atomically: true, encoding: .utf8)
                        if let json = try? JSONSerialization.data(withJSONObject: dict, options: [.prettyPrinted, .sortedKeys]),
                           let jsonString = String(data: json, encoding: .utf8) {
                            try? jsonString.write(to: dir.appendingPathComponent("layout_smoke.json"), atomically: true, encoding: .utf8)
                        }
                    }
                    print("[LayoutSmoke] \(layoutOK ? "ok" : "FAIL") \(layoutNote ?? "")")
                    #endif
                },
                onPageNav: { id, url in
                    pageNavKnown = true
                    pageWatchID = id
                    if !url.isEmpty { urlField = url }
                    // Keep chrome in sync on in-page YT nav without remounting via `.id(videoID)`.
                    if let id, id != videoID { videoID = id }
                },
                onFullscreenChange: { active in
                    applyPlayerFullscreen(active)
                },
                seekRequest: $seekRequest,
                reloadNonce: $reloadNonce,
                fullscreenToggleNonce: $fullscreenToggleNonce,
                historyAction: $historyAction,
                canGoBack: $canGoBack,
                canGoForward: $canGoForward
            )

            if overlayShown {
                HardsubOverlayView(
                    activeCue: activeCue,
                    videoFrame: videoFrame,
                    showJA: showJA,
                    showEN: showEN,
                    showVI: showVI,
                    showFurigana: showFurigana
                )
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        // App-full hides topBar — keep overlay + exit pills reachable.
        .overlay(alignment: .topTrailing) {
            if isPlayerFullscreen { fullscreenExitChrome }
        }
    }

    private func saveCues() {
        modelContext.saveAndScheduleBackup()
    }

    // MARK: - Top bar

    private var topBar: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Language Caption")
                    .font(.headline.weight(.semibold))
                Text("Học phụ đề YouTube")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .fixedSize()

            Button {
                historyAction = .goBack
            } label: {
                Image(systemName: "chevron.backward")
                    .font(.body.weight(.semibold))
                    .frame(width: 36, height: 36)
            }
            .buttonStyle(.plain)
            .disabled(!canGoBack)
            .opacity(canGoBack ? 1 : 0.35)
            .accessibilityLabel("Quay lại trang")

            Button {
                historyAction = .goForward
            } label: {
                Image(systemName: "chevron.forward")
                    .font(.body.weight(.semibold))
                    .frame(width: 36, height: 36)
            }
            .buttonStyle(.plain)
            .disabled(!canGoForward)
            .opacity(canGoForward ? 1 : 0.35)
            .accessibilityLabel("Tiến tới trang")

            HStack(spacing: 8) {
                Image(systemName: "link")
                    .foregroundStyle(.secondary)
                TextField("Dán link hoặc video ID YouTube", text: $urlField)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                    .focused($urlFocused)
                    .onSubmit(loadAndRefresh)
                    .accessibilityLabel("Language Caption URL")
                if !urlField.isEmpty {
                    Button {
                        urlField = ""
                        urlFocused = true
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(.tertiary)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12, style: .continuous))

            iconPill("arrow.clockwise", prominent: true, label: "Tải / làm mới") {
                loadAndRefresh()
            }

            iconPill("captions.bubble.fill", active: overlayShown, label: overlayOn ? "Tắt overlay" : "Bật overlay") {
                guard onYouTubeWatch else { return }
                overlayOn.toggle()
            }
            .disabled(!onYouTubeWatch)
            .opacity(onYouTubeWatch ? 1 : 0.35)

            iconPill("sidebar.trailing", active: sidePanelShown, label: sidePanelOn ? "Ẩn side panel" : "Hiện side panel") {
                guard onYouTubeWatch, !isPlayerFullscreen else { return }
                sidePanelOn.toggle()
            }
            .disabled(!onYouTubeWatch || isPlayerFullscreen)
            .opacity(onYouTubeWatch && !isPlayerFullscreen ? 1 : 0.35)

            iconPill(
                isPlayerFullscreen ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right",
                active: isPlayerFullscreen,
                label: isPlayerFullscreen ? "Thoát toàn màn hình" : "Toàn màn hình"
            ) {
                guard onYouTubeWatch else { return }
                fullscreenToggleNonce &+= 1
            }
            .disabled(!onYouTubeWatch)
            .opacity(onYouTubeWatch ? 1 : 0.35)

            Menu {
                Stepper(value: $overlayFontScale, in: 0.55...2.4, step: 0.1) {
                    Text("Overlay \(String(format: "%.1f", overlayFontScale))×")
                }
                Stepper(value: $sidePanelFontScale, in: 0.7...1.8, step: 0.1) {
                    Text("Side panel \(String(format: "%.1f", sidePanelFontScale))×")
                }
            } label: {
                Image(systemName: "textformat.size")
                    .font(.body.weight(.semibold))
                    .frame(width: 36, height: 36)
                    .foregroundStyle(Color.primary)
                    .background(Color(uiColor: .secondarySystemGroupedBackground), in: Capsule())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Cỡ chữ overlay và side panel")

            iconPill(isDarkTheme ? "moon.fill" : "sun.max.fill", label: isDarkTheme ? "Chuyển sang sáng" : "Chuyển sang tối") {
                isDarkTheme.toggle()
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(Color(uiColor: .systemBackground))
    }

    /// App-full: topBar hidden — overlay + full exit on the player.
    private var fullscreenExitChrome: some View {
        HStack(spacing: 6) {
            iconPill("captions.bubble.fill", active: overlayShown, label: overlayOn ? "Tắt overlay" : "Bật overlay") {
                guard onYouTubeWatch else { return }
                overlayOn.toggle()
            }
            .disabled(!onYouTubeWatch)
            .opacity(onYouTubeWatch ? 1 : 0.35)

            iconPill(
                isPlayerFullscreen ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right",
                active: isPlayerFullscreen,
                label: isPlayerFullscreen ? "Thoát toàn màn hình" : "Toàn màn hình"
            ) {
                guard onYouTubeWatch else { return }
                fullscreenToggleNonce &+= 1
            }
            .disabled(!onYouTubeWatch)
            .opacity(onYouTubeWatch ? 1 : 0.35)
        }
        .padding(8)
    }

    /// App maximize: panel off, overlay stays on; restore panel on exit.
    private func applyPlayerFullscreen(_ active: Bool) {
        if active {
            if sidePanelBeforeFullscreen == nil {
                sidePanelBeforeFullscreen = sidePanelOn
            }
            sidePanelOn = false
            isPlayerFullscreen = true
        } else {
            isPlayerFullscreen = false
            if let prev = sidePanelBeforeFullscreen {
                sidePanelOn = prev
                sidePanelBeforeFullscreen = nil
            }
        }
    }

    #if DEBUG
    /// Device self-test driver — config via launch args (devicectl -e env vars don't reach iOS processes):
    ///   -CS_AUTOTEST_OVERLAY            → overlay on
    ///   -CS_AUTOTEST_FULLSCREEN 8,16    → toggle app-full at 8s and 16s
    ///   -CS_AUTOTEST_SCROLL 6,500       → scrollTo(0,500) at 6s (scrolled-fullscreen repro)
    ///   -CS_AUTOTEST_SHOT 5,12,19       → save window PNGs to Documents/autotest/ at those seconds
    /// ponytail: device-only check for the fullscreen-overlay fix; no UI needed, shots are the evidence.
    private func runAutotestIfRequested() {
        let a = CommandLine.arguments
        let argVal = { (flag: String) -> String in
            (0..<(a.count - 1)).first { a[$0] == flag }.map { a[$0 + 1] } ?? ""
        }
        if a.contains("-CS_AUTOTEST_OVERLAY") { overlayOn = true }
        let toggles = argVal("-CS_AUTOTEST_FULLSCREEN")
            .split(separator: ",").compactMap { Double($0.trimmingCharacters(in: .whitespaces)) }
        let shots = argVal("-CS_AUTOTEST_SHOT")
            .split(separator: ",").compactMap { Double($0.trimmingCharacters(in: .whitespaces)) }
        let scrolls = argVal("-CS_AUTOTEST_SCROLL")
            .split(separator: ",").compactMap { Double($0.trimmingCharacters(in: .whitespaces)) }
        let miniplayerAt = Double(argVal("-CS_AUTOTEST_MINIPLAYER").trimmingCharacters(in: .whitespaces))
        let trapbox = argVal("-CS_AUTOTEST_TRAPBOX")
            .split(separator: ",").compactMap { Double($0.trimmingCharacters(in: .whitespaces)) }
        print("[Autotest] args=\(a) toggles=\(toggles) scrolls=\(scrolls) shots=\(shots) miniplayer=\(miniplayerAt.map { String($0) } ?? "-") trapbox=\(trapbox)")
        if scrolls.count == 2 {
            let at = scrolls[0], y = scrolls[1]
            DispatchQueue.main.asyncAfter(deadline: .now() + at) {
                AutotestBridge.shared.scrollPage?(y)
                print("[Autotest] scroll to \(y) at \(at)s")
            }
        }
        if let at = miniplayerAt {
            DispatchQueue.main.asyncAfter(deadline: .now() + at) {
                // Try the classic control-bar button, then any renderer whose label
                // mentions miniplayer; always dump the result state.
                AutotestBridge.shared.evaluateJS?("(function(){var cands=[document.querySelector('.ytp-miniplayer-button')]; var tb=Array.prototype.slice.call(document.querySelectorAll('ytd-toggle-button-renderer, ytd-button-renderer')).find(function(b){return /[Mm]iniplayer/.test((b.getAttribute('aria-label')||'')+' '+b.textContent);}); if(tb)cands.push(tb); var hit=cands.filter(Boolean)[0]; if(hit)hit.click(); setTimeout(function(){window.__csPostLayout&&window.__csPostLayout();},400);})()")
                print("[Autotest] miniplayer click at \(at)s")
            }
        }
        if trapbox.count == 2 {
            let on = trapbox[0], off = trapbox[1]
            DispatchQueue.main.asyncAfter(deadline: .now() + on) {
                // Simulate YT's miniplayer re-parent: move #movie_player into a
                // fixed, TRANSFORMED box (containing block for position:fixed).
                AutotestBridge.shared.evaluateJS?("(function(){var p=document.querySelector('#movie_player'); if(!p)return; var box=document.getElementById('cs-trap-box'); if(!box){box=document.createElement('div'); box.id='cs-trap-box'; box.style.cssText='position:fixed; right:16px; bottom:16px; width:400px; height:301px; transform:translate3d(0,0,0); background:#000; z-index:2147483647; overflow:hidden;'; document.body.appendChild(box);} box.appendChild(p); setTimeout(function(){window.__csPostLayout&&window.__csPostLayout();},400);})()")
                print("[Autotest] trapbox ON at \(on)s")
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + off) {
                AutotestBridge.shared.evaluateJS?("(function(){var p=document.querySelector('#movie_player'); var host=document.querySelector('#player'); if(!p||!host)return; host.appendChild(p); setTimeout(function(){window.__csPostLayout&&window.__csPostLayout();},400);})()")
                print("[Autotest] trapbox OFF at \(off)s")
            }
        }
        for t in toggles {
            DispatchQueue.main.asyncAfter(deadline: .now() + t) {
                fullscreenToggleNonce &+= 1
                print("[Autotest] toggle full at \(t)s")
            }
        }
        for (i, s) in shots.enumerated() {
            DispatchQueue.main.asyncAfter(deadline: .now() + s) {
                saveAutotestShot(index: i + 1)
            }
        }
    }

    private func saveAutotestShot(index: Int) {
        guard let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
              let window = scene.keyWindow else { return }
        let renderer = UIGraphicsImageRenderer(bounds: window.bounds)
        let image = renderer.image { _ in
            window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
        }
        guard let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first,
              let data = image.pngData() else { return }
        let sub = dir.appendingPathComponent("autotest", isDirectory: true)
        try? FileManager.default.createDirectory(at: sub, withIntermediateDirectories: true)
        let url = sub.appendingPathComponent(String(format: "autotest-%02d.png", index))
        try? data.write(to: url)
        // Pair each shot with the latest layout smoke dump for DOM ground truth.
        if let smoke = try? String(contentsOf: dir.appendingPathComponent("layout_smoke.txt"), encoding: .utf8) {
            try? smoke.write(
                to: sub.appendingPathComponent(String(format: "smoke-%02d.txt", index)),
                atomically: true, encoding: .utf8)
        }
        if let json = try? String(contentsOf: dir.appendingPathComponent("layout_smoke.json"), encoding: .utf8) {
            try? json.write(
                to: sub.appendingPathComponent(String(format: "smoke-%02d.json", index)),
                atomically: true, encoding: .utf8)
        }
        print("[Autotest] shot \(url.lastPathComponent) ovl=\(overlayShown) full=\(isPlayerFullscreen)")
    }
    #endif

    private func iconPill(
        _ systemImage: String,
        prominent: Bool = false,
        active: Bool = false,
        label: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.body.weight(.semibold))
                .frame(width: 36, height: 36)
                .foregroundStyle(prominent || active ? Color.white : Color.primary)
                .background(
                    prominent || active
                        ? Color(red: 0.08, green: 0.30, blue: 0.36)
                        : Color(uiColor: .secondarySystemGroupedBackground),
                    in: Capsule()
                )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    // MARK: - Tools

    private var toolsColumn: some View {
        VStack(alignment: .leading, spacing: 0) {
            SidePanelToolbar(
                onReload: { Task { await loadCaptions(for: videoID) } },
                onAddCue: addCueAtPlayhead,
                onClearTranslations: { confirmClearMT = true },
                onWipeScript: { confirmWipe = true },
                onExport: exportScript,
                onImport: { showImporter = true },
                onConnectDrive: { Task { await connectDrive() } },
                onSettings: { showSettings = true }
            )

            if pendingImport != nil {
                importPanel
            }

            HStack(spacing: 10) {
                // Isolated so ~4Hz clock ticks don't rebuild the cue List below.
                PlayheadStatusChip(
                    sync: playheadSync,
                    isPlaying: isPlaying,
                    activeStartMs: activeCue?.startTime
                )
                Spacer()
                Toggle(isOn: Binding(
                    get: { followTimeline },
                    set: { on in
                        followTimeline = on
                        if on { followResumeNonce &+= 1 }
                    }
                )) {
                    Text("Theo timeline")
                        .font(.caption)
                }
                .toggleStyle(.button)
                .tint(followTimeline ? Color(red: 0.08, green: 0.30, blue: 0.36) : .secondary)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)

            if let statusMessage {
                Label(statusMessage, systemImage: isLoadingCaptions ? "arrow.triangle.2.circlepath" : "info.circle")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 16)
                    .padding(.bottom, 6)
            }

            Picker("Công cụ", selection: $toolTab) {
                ForEach(ToolTab.allCases, id: \.self) { tab in
                    Text(tabTitle(tab)).tag(tab)
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)

            Group {
                switch toolTab {
                case .subtitles:
                    subtitlesList
                case .vocab:
                    vocabList
                }
            }
        }
        .background(Color(uiColor: .systemBackground))
    }

    private func tabTitle(_ tab: ToolTab) -> String {
        switch tab {
        case .subtitles: return "Phụ đề (\(currentCues.filter { !$0.tombstoned }.count))"
        case .vocab: return "Từ vựng (\(vocabularies.count))"
        }
    }

    private var subtitlesList: some View {
        Group {
            if currentCues.isEmpty {
                ContentUnavailableView(
                    isLoadingCaptions ? "Đang tải phụ đề…" : "Chưa có phụ đề",
                    systemImage: isLoadingCaptions ? "ellipsis.bubble" : "captions.bubble",
                    description: Text(isLoadingCaptions
                        ? "Đợi timedtext từ YouTube"
                        : "Video này có thể không có CC. Thử video khác hoặc bật phụ đề trên player.")
                )
            } else {
                let live = currentCues.filter { !$0.tombstoned }
                ScrollViewReader { proxy in
                    // List.scrollTo is a no-op when the row is already (partially) visible.
                    // LazyVStack.scrollTo mis-estimates unloaded rows (overshoot past active).
                    // ponytail: VStack ok for ~300 cues; LazyVStack if row count blows up
                    ScrollView {
                        VStack(spacing: 0) {
                            ForEach(live) { cue in
                                let active = activeCueId == cue.id
                                CueEditorRow(
                                    cue: cue,
                                    isActive: active,
                                    neighbors: live,
                                    fontScale: sidePanelFontScale,
                                    onSeek: { seekRequest = $0 },
                                    onSave: {
                                        saveCues()
                                        currentCues = ScriptCue.load(videoId: videoID, context: modelContext)
                                            .filter { !$0.tombstoned }
                                    },
                                    onEditingChanged: { editing in
                                        editingCue = editing
                                        if editing { followTimeline = false }
                                    }
                                )
                                .padding(.vertical, 4)
                                .padding(.horizontal, 12)
                                // Always reserve bar pad — toggling it on active caused a one-frame flash.
                                .padding(.leading, 12)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(
                                    active
                                        ? Color(red: 0.08, green: 0.30, blue: 0.36).opacity(0.18)
                                        : Color.clear
                                )
                                .overlay(alignment: .leading) {
                                    if active {
                                        RoundedRectangle(cornerRadius: 2)
                                            .fill(Color(red: 0.08, green: 0.30, blue: 0.36))
                                            .frame(width: 3)
                                            .padding(.vertical, 6)
                                            .allowsHitTesting(false)
                                    }
                                }
                                .overlay(alignment: .bottom) { Divider() }
                                .background(
                                    GeometryReader { g in
                                        Color.clear.preference(
                                            key: CueRowFramesKey.self,
                                            value: [cue.id: g.frame(in: .global)]
                                        )
                                    }
                                )
                                .id(cue.id)
                            }
                        }
                    }
                    .background(
                        GeometryReader { g in
                            Color.clear.preference(key: CueListBoundsKey.self, value: g.frame(in: .global))
                        }
                    )
                    .onPreferenceChange(CueListBoundsKey.self) { bounds in
                        if !ignoreScrollEvent { cueListBounds = bounds }
                    }
                    .onPreferenceChange(CueRowFramesKey.self) { frames in
                        if !ignoreScrollEvent { cueRowFrames = frames }
                    }
                    // ponytail: DragGesture ≈ desktop wheel/touch; trackpad-only scroll may not pause — UIScrollViewDelegate if needed
                    .simultaneousGesture(
                        DragGesture(minimumDistance: 8)
                            .onChanged { _ in pauseFollowFromUser() }
                    )
                    .onChange(of: activeCueId) { _, newId in
                        scrollActiveIntoView(proxy, id: newId, force: false)
                    }
                    .onChange(of: followResumeNonce) { _, _ in
                        scrollActiveIntoView(proxy, id: activeCueId, force: true)
                    }
                }
            }
        }
    }

    private var vocabList: some View {
        Group {
            if vocabularies.isEmpty {
                ContentUnavailableView(
                    "Chưa lưu từ nào",
                    systemImage: "bookmark",
                    description: Text("Chạm một từ trên overlay hoặc phụ đề → Lưu từ.")
                )
            } else {
                List(vocabularies) { vocab in
                    HStack {
                        Text(vocab.word).font(.body.weight(.medium))
                        Spacer()
                        Text(vocab.meaning).foregroundStyle(.secondary)
                    }
                }
                .listStyle(.plain)
            }
        }
    }

    private var importPanel: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text("Nhập bản dịch")
                    .font(.subheadline.weight(.semibold))
                Text("\(pendingImport?.fileName ?? "file") · \(pendingImport?.rows.count ?? 0) mục")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Spacer(minLength: 0)
                Button {
                    pendingImport = nil
                } label: {
                    Image(systemName: "xmark")
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Đóng phần nhập bản dịch")
            }

            Text("Gộp: khớp theo cue id hoặc thời điểm ±0,35s + JA (mặc định chỉ EN/VI). Full: thay toàn bộ script (dịch + timeline) và xóa bản lưu cũ.")
                .font(.caption2)
                .foregroundStyle(.secondary)

            importModeButton(
                .merge,
                title: "Gộp (partial) — chỉ các mục có trong file"
            )
            importModeButton(
                .replace,
                title: "Thay thế (full) — xóa script cũ, ghi đè toàn bộ dịch + timeline từ file"
            )

            Toggle("Gồm JA/timeline (chỉ Gộp; Full luôn gồm)", isOn: $importIncludeJA)
                .font(.caption)
                .disabled(importMode == .replace)

            Button("Áp dụng", action: applyImport)
                .buttonStyle(.borderedProminent)
                .tint(Color(red: 0.48, green: 0.28, blue: 0.85))
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(Color(red: 0.086, green: 0.086, blue: 0.122))
        .overlay(alignment: .bottom) { Divider() }
    }

    private func importModeButton(_ mode: ScriptCue.ImportMode, title: String) -> some View {
        Button {
            importMode = mode
            if mode == .replace { importIncludeJA = true }
        } label: {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: importMode == mode ? "largecircle.fill.circle" : "circle")
                    .foregroundStyle(importMode == mode ? Color.accentColor : .secondary)
                Text(title)
                    .font(.caption)
                    .multilineTextAlignment(.leading)
                Spacer(minLength: 0)
            }
            .contentShape(Rectangle())
            .frame(minHeight: 44)
        }
        .buttonStyle(.plain)
    }

    // MARK: - Actions

    private func refreshActiveCueId(at timeMs: Double) {
        let id = ScriptCue.active(in: currentCues, atMs: timeMs)?.id
        if id != activeCueId { activeCueId = id }
    }

    /// Desktop `pauseFollowFromUser` — user drag on subtitle list stops auto-scroll.
    private func pauseFollowFromUser() {
        if ignoreScrollEvent { return }
        if !followTimeline { return }
        followTimeline = false
    }

    private func scrollActiveIntoView(_ proxy: ScrollViewProxy, id: ScriptCue.ID?, force: Bool) {
        guard followTimeline, !editingCue, let id else { return }
        // Target = list top (flush under Phụ đề tabs). Skip only when already flush.
        // ponytail: 0.12*height skipped "one cue behind" (2nd row still within 12%) — use ~24pt.
        if !force,
           !cueListBounds.isNull,
           let row = cueRowFrames[id] {
            let delta = row.minY - cueListBounds.minY
            if delta >= -4, delta <= 24 { return }
        }
        // Short cues flip faster than the soft scroll — coalesce to latest id.
        if !force, scrollAnimInFlight {
            pendingScrollId = id
            return
        }
        if force {
            pendingScrollId = nil
            scrollAnimInFlight = false
        }
        ignoreScrollEvent = true
        if !force { scrollAnimInFlight = true }
        let scrolledId = id
        let animNs: UInt64 = 280_000_000
        // ScrollView.scrollTo is a no-op when the row is already (partially) visible —
        // active sits one cue down. Nudge off-screen briefly, then pin to top.
        let live = currentCues.filter { !$0.tombstoned }
        let prevId: ScriptCue.ID? = {
            guard let i = live.firstIndex(where: { $0.id == id }), i > 0 else { return nil }
            return live[i - 1].id
        }()
        DispatchQueue.main.async {
            if force {
                withTransaction(Transaction(animation: nil)) {
                    proxy.scrollTo(id, anchor: .top)
                }
            } else {
                if let prevId {
                    withTransaction(Transaction(animation: nil)) {
                        proxy.scrollTo(prevId, anchor: .top)
                    }
                }
                withAnimation(.easeInOut(duration: 0.25)) {
                    proxy.scrollTo(id, anchor: .top)
                }
            }
        }
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: force ? 50_000_000 : animNs)
            ignoreScrollEvent = false
            guard !force else { return }
            scrollAnimInFlight = false
            let next = pendingScrollId ?? (activeCueId != scrolledId ? activeCueId : nil)
            pendingScrollId = nil
            if let next { scrollActiveIntoView(proxy, id: next, force: false) }
        }
    }

    private func loadAndRefresh() {
        urlFocused = false
        guard let id = YouTubeURL.videoID(from: urlField) else {
            statusMessage = "Link không hợp lệ — dán URL YouTube hoặc ID 11 ký tự."
            return
        }
        let same = id == videoID
        if !same {
            currentCues = []
            playheadSync.timeMs = 0
            playheadSync.at = Date()
            activeCueId = nil
            isPlaying = false
            videoID = id
            // `.task(id:)` + player `.id` handle first load; still bump nonce so a
            // recycled coordinator can't skip the watch URL.
            reloadNonce += 1
            statusMessage = "Đang tải \(id)…"
        } else {
            // Same video: force page refresh + re-merge YouTube with saved ScriptStore.
            reloadNonce += 1
            statusMessage = "Đang làm mới \(id)…"
            Task { await loadCaptions(for: id) }
        }
        urlField = "https://www.youtube.com/watch?v=\(id)"
    }

    private func loadCaptions(for id: String) async {
        isLoadingCaptions = true
        statusMessage = "Đang lấy phụ đề…"

        let keepOwned: Bool = await MainActor.run {
            let local = ScriptCue.load(videoId: id, context: modelContext).filter { !$0.tombstoned }
            let descriptor = FetchDescriptor<VideoScript>(predicate: #Predicate { $0.videoId == id })
            let owned = (try? modelContext.fetch(descriptor).first)?.owned == true
            if !local.isEmpty {
                currentCues = local
                statusMessage = owned
                    ? "Đã giữ script đã import (\(local.count) cue)"
                    : "Đã tải \(local.count) câu từ lưu trữ cục bộ"
            }
            return owned && !local.isEmpty
        }

        // Owned import: keep local timeline; page refresh still via reloadNonce.
        // wipeAndReload deletes the script first, so owned is cleared and YouTube fetch runs.
        if keepOwned {
            await MainActor.run { isLoadingCaptions = false }
            return
        }

        let cues = await CaptionService.fetchCues(videoId: id)
        await MainActor.run {
            isLoadingCaptions = false
            if !cues.isEmpty {
                currentCues = ScriptCue.mergeWithLocal(videoId: id, youtubeCues: cues, context: modelContext)
                statusMessage = "Đã cập nhật \(cues.count) câu phụ đề từ YouTube"
            } else if currentCues.isEmpty {
                statusMessage = "Chưa lấy được timedtext — thử video có CC tiếng Nhật"
            }
        }
    }

    private func connectDrive() async {
        do {
            _ = try await DriveAuthService.shared.connect()
            guard DriveAuthService.shared.hasToken else {
                statusMessage = "Drive: OAuth xong nhưng chưa lưu được token"
                return
            }
            statusMessage = "Drive: đã kết nối · đang tìm \(videoID)…"
            await SettingsSync.shared.syncOnConnect()
            await VocabSync.shared.syncOnConnect(context: modelContext)
            let result = await DriveScriptsService.sync(videoId: videoID, context: modelContext)
            applyDriveSync(result)
        } catch {
            statusMessage = "Drive: \(error.localizedDescription)"
        }
    }

    /// Prefer cues returned by pull/import — `ScriptCue.load` can miss SwiftData relationship.
    private func applyDriveSync(_ result: DriveScriptsService.SyncResult) {
        if let cues = result.cues, !cues.isEmpty {
            currentCues = cues.filter { !$0.tombstoned }
        } else {
            currentCues = ScriptCue.load(videoId: videoID, context: modelContext).filter { !$0.tombstoned }
        }
        statusMessage = result.message
    }

    private func addCueAtPlayhead() {
        let cue = ScriptCue.addCueAtPlayhead(videoId: videoID, atMs: playheadMs, context: modelContext)
        currentCues = ScriptCue.load(videoId: videoID, context: modelContext).filter { !$0.tombstoned }
        let total = Int(cue.startTime / 1000)
        statusMessage = String(format: "Đã thêm cue tại %d:%02d", total / 60, total % 60)
        toolTab = .subtitles
    }

    private func clearTranslations() {
        ScriptCue.clearTranslations(videoId: videoID, context: modelContext)
        // Tombstoned cues stay hidden — the iPhone copy already filtered them.
        currentCues = ScriptCue.load(videoId: videoID, context: modelContext).filter { !$0.tombstoned }
        statusMessage = "Đã xóa EN/VI"
    }

    private func wipeAndReload() {
        ScriptCue.wipeAll(videoId: videoID, context: modelContext)
        currentCues = []
        statusMessage = "Đã xóa sub — đang tải lại…"
        Task { await loadCaptions(for: videoID) }
    }

    private func exportScript() {
        let text = ScriptCue.exportTXT(currentCues)
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(videoID)-script.txt")
        do {
            try text.write(to: url, atomically: true, encoding: .utf8)
            exportURL = url
            statusMessage = "Export sẵn sàng"
        } catch {
            statusMessage = "Export lỗi: \(error.localizedDescription)"
        }
    }

    private func handleImport(_ result: Result<[URL], Error>) {
        switch result {
        case .failure(let err):
            statusMessage = "Import lỗi: \(err.localizedDescription)"
        case .success(let urls):
            guard let url = urls.first else { return }
            let access = url.startAccessingSecurityScopedResource()
            defer { if access { url.stopAccessingSecurityScopedResource() } }
            guard let text = try? String(contentsOf: url, encoding: .utf8) else {
                statusMessage = "Không đọc được file import"
                return
            }
            let parsed = ScriptCue.parseImportRows(text)
            guard !parsed.isEmpty else {
                statusMessage = "Import: không parse được — dùng TXT/JSON export từ app hoặc extension"
                return
            }
            importMode = .merge
            importIncludeJA = false
            pendingImport = PendingImport(fileName: url.lastPathComponent, rows: parsed)
            statusMessage = "Đã đọc \(parsed.count) mục — chọn chế độ rồi Áp dụng"
        }
    }

    private func applyImport() {
        guard let pendingImport else {
            statusMessage = "Chưa chọn file"
            return
        }
        let result = ScriptCue.importRows(
            videoId: videoID,
            rows: pendingImport.rows,
            mode: importMode,
            includeJA: importMode == .replace || importIncludeJA,
            context: modelContext
        )
        if !result.cues.isEmpty {
            currentCues = result.cues.filter { !$0.tombstoned }
        } else {
            currentCues = ScriptCue.load(videoId: videoID, context: modelContext).filter { !$0.tombstoned }
        }
        statusMessage = importMode == .replace
            ? "Import: đã thay thế \(result.replaced) cue"
            : "Import: cập nhật \(result.updated) · bỏ qua \(result.skipped) · không khớp \(result.unmatched)"
        self.pendingImport = nil
        toolTab = .subtitles
    }

}

/// Mutable YT playhead anchors — not @Published; writes must not rebuild ContentView.
private final class PlayheadSync {
    var timeMs: Double = 0
    var at: Date = Date()
}

private struct CueListBoundsKey: PreferenceKey {
    static var defaultValue: CGRect = .null
    static func reduce(value: inout CGRect, nextValue: () -> CGRect) { value = nextValue() }
}

private struct CueRowFramesKey: PreferenceKey {
    static var defaultValue: [String: CGRect] = [:]
    static func reduce(value: inout [String: CGRect], nextValue: () -> [String: CGRect]) {
        value.merge(nextValue(), uniquingKeysWith: { $1 })
    }
}

/// Own timer for the clock so ContentView / cue List don't rebuild on playhead ticks.
private struct PlayheadStatusChip: View {
    let sync: PlayheadSync
    let isPlaying: Bool
    let activeStartMs: Double?
    @State private var displayMs: Double = 0

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: isPlaying ? "play.fill" : "pause.fill")
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(Self.format(displayMs))
                .font(.subheadline.monospacedDigit().weight(.semibold))
                .foregroundStyle(Color.primary)
            if let activeStartMs {
                Text("·")
                    .foregroundStyle(.tertiary)
                Text(Self.format(activeStartMs))
                    .font(.subheadline.monospacedDigit().weight(.medium))
                    .foregroundStyle(.primary.opacity(0.75))
            }
        }
        .onReceive(Timer.publish(every: 0.25, on: .main, in: .common).autoconnect()) { _ in
            if isPlaying {
                let elapsed = Date().timeIntervalSince(sync.at) * 1000
                displayMs = sync.timeMs + min(elapsed, 300)
            } else {
                displayMs = sync.timeMs
            }
        }
        .onAppear { displayMs = sync.timeMs }
        .onChange(of: isPlaying) { _, _ in displayMs = sync.timeMs }
    }

    private static func format(_ ms: Double) -> String {
        let total = Int(ms / 1000)
        return String(format: "%d:%02d", total / 60, total % 60)
    }
}

private struct PendingImport {
    let fileName: String
    let rows: [ScriptCue.ImportRow]
}

// Share sheet for Export
private struct ActivityView: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [url], applicationActivities: nil)
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}

#Preview {
    ContentView()
        .modelContainer(for: [VideoScript.self, ScriptCue.self, Vocabulary.self], inMemory: true)
}
