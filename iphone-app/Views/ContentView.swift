import SwiftUI
import CaptionShared
import SwiftData

struct ContentView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.scenePhase) private var scenePhase

    @AppStorage("sidePanelFractionPortrait") private var panelFractionPortrait = 0.42
    @AppStorage("sidePanelFractionLandscape") private var panelFractionLandscape = 0.28
    /// Match desktop `showOnVideo: false` — user enables on a watch page.
    @AppStorage("hardsubOverlayOn") private var overlayOn = false
    @AppStorage("sidePanelOn") private var sidePanelOn = false
    @AppStorage("hardsubShowJA") private var showJA = true
    /// Desktop defaults: barShowEn / barShowVi are on unless explicitly off.
    /// `.v2` keys: older builds stored false; rename so new defaults apply once.
    @AppStorage("hardsubShowEN.v2") private var showEN = true
    @AppStorage("hardsubShowVI.v2") private var showVI = true
    @AppStorage("hardsubShowFurigana") private var showFurigana = true
    @AppStorage("isDarkTheme") private var isDarkTheme = true
    @AppStorage("followTimeline") private var followTimeline = true
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
    @State private var dragStartFraction: CGFloat?
    @State private var videoFrame: CGRect?
    @State private var layoutOK = false
    @State private var layoutNote: String?
    /// From WKWebView `PAGE_NAV` — nil on YT home/search (desktop-equivalent gate).
    @State private var pageWatchID: String?
    @State private var pageNavKnown = false
    /// Ignore drag/scroll that comes from our own `scrollTo` (desktop `ignoreScrollEvent`).
    @State private var ignoreScrollEvent = false
    /// Animated follow scroll in flight — coalesce rapid activeCue flips (1–2 char cues).
    @State private var scrollAnimInFlight = false
    @State private var pendingScrollId: ScriptCue.ID?
    /// Global frames for follow — skip scrollTo when active row is already ~at list top.
    @State private var cueListBounds: CGRect = .null
    @State private var cueRowFrames: [String: CGRect] = [:]
    @FocusState private var urlFocused: Bool
    /// Bump when re-enabling Theo timeline — force-scroll active cue to top.
    @State private var followResumeNonce = 0
    @State private var isPlayerFullscreen = false
    @State private var sidePanelBeforeFullscreen: Bool?
    @State private var fullscreenToggleNonce = 0
    // Side-panel tools (same entry points as the iPad app).
    @State private var sheet: PhoneSheet?
    @State private var showImporter = false
    @State private var pendingImport: PendingImport?
    @State private var importMode: ScriptCue.ImportMode = .merge
    @State private var importIncludeJA = false
    @State private var confirmClearMT = false
    @State private var confirmWipe = false

    /// One sheet at a time — several `.sheet` modifiers on the same view fight
    /// over which one presents.
    enum PhoneSheet: Identifiable {
        case settings
        case importOptions
        case export(URL)

        var id: String {
            switch self {
            case .settings: return "settings"
            case .importOptions: return "import"
            case .export(let url): return "export-\(url.lastPathComponent)"
            }
        }
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
        GeometryReader { geo in
            let landscape = geo.size.width > geo.size.height
            VStack(spacing: 0) {
                if !landscape && !isPlayerFullscreen {
                    topBar
                    Divider()
                }
                GeometryReader { contentGeo in
                    Group {
                        if landscape {
                            wideLayout(size: contentGeo.size)
                        } else {
                            compactLayout(size: contentGeo.size)
                        }
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
        .task {
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
        .sheet(item: $sheet) { which in
            switch which {
            case .settings:
                SidePanelSettingsSheet()
            case .importOptions:
                importSheet
            case .export(let url):
                ActivityView(url: url)
            }
        }
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
    }

    // MARK: - Layouts

    private func wideLayout(size: CGSize) -> some View {
        let panel = clampedPanelWidth(total: size.width)
        return HStack(spacing: 0) {
            playerPane
                .overlay(alignment: .topTrailing) { landscapePlayerChrome }
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
                // Portrait app-full hides topBar — keep pills reachable for exit.
                .overlay(alignment: .topTrailing) {
                    if isPlayerFullscreen { landscapePlayerChrome }
                }
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
        let minW: CGFloat = 160
        let maxW = max(minW, total * 0.36)
        return min(max(total * panelFractionLandscape, minW), maxW)
    }

    private func clampedPanelHeight(total: CGFloat) -> CGFloat {
        let minH: CGFloat = 140
        let maxH = max(minH, total * 0.55)
        return min(max(total * panelFractionPortrait, minH), maxH)
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
                    let current = axis == .horizontal ? panelFractionLandscape : panelFractionPortrait
                    if dragStartFraction == nil { dragStartFraction = current }
                    let start = dragStartFraction ?? current
                    let delta: CGFloat = {
                        switch axis {
                        case .horizontal: return -value.translation.width / max(total, 1)
                        case .vertical: return -value.translation.height / max(total, 1)
                        }
                    }()
                    let next = start + delta
                    switch axis {
                    case .horizontal:
                        panelFractionLandscape = min(0.36, max(0.22, next))
                    case .vertical:
                        panelFractionPortrait = min(0.55, max(0.25, next))
                    }
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
    }

    // MARK: - Top bar

    private var topBar: some View {
        HStack(spacing: 6) {
            Button {
                historyAction = .goBack
            } label: {
                Image(systemName: "chevron.backward")
                    .font(.body.weight(.semibold))
                    .frame(width: 28, height: 28)
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
                    .frame(width: 28, height: 28)
            }
            .buttonStyle(.plain)
            .disabled(!canGoForward)
            .opacity(canGoForward ? 1 : 0.35)
            .accessibilityLabel("Tiến tới trang")

            HStack(spacing: 6) {
                Image(systemName: "link")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                TextField("Link / video ID", text: $urlField)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                    .focused($urlFocused)
                    .font(.subheadline)
                    .onSubmit(loadAndRefresh)
                    .accessibilityLabel("Language Caption URL")
                if !urlField.isEmpty {
                    Button {
                        urlField = ""
                        urlFocused = true
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            .frame(maxWidth: .infinity)
            .background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 8, style: .continuous))

            chromePills

            SidePanelToolbar(
                onReload: { Task { await loadCaptions(for: videoID) } },
                onAddCue: addCueAtPlayhead,
                onClearTranslations: { confirmClearMT = true },
                onWipeScript: { confirmWipe = true },
                onExport: exportScript,
                onImport: { showImporter = true },
                onConnectDrive: { Task { await connectDrive() } },
                onSettings: { sheet = .settings }
            )
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .frame(minHeight: 44)
        .background(Color(uiColor: .systemBackground))
    }

    /// Landscape / app-full: topBar hidden — overlay | panel | timeline | full on the player.
    private var landscapePlayerChrome: some View {
        chromePills
            .padding(8)
    }

    /// Order fixed: overlay → panel → timeline → full.
    private var chromePills: some View {
        HStack(spacing: 6) {
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
                followTimeline ? "location.fill" : "location",
                active: followTimeline,
                label: followTimeline ? "Tắt theo timeline" : "Theo timeline"
            ) {
                followTimeline.toggle()
                if followTimeline { followResumeNonce &+= 1 }
            }

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
    }

    /// Panel off + overlay ok for OS video FS and app maximize; restore panel on exit.
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
                .frame(width: 32, height: 32)
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

    /// Panel = cue list only (no toolbar / playhead / tabs / status).
    private var toolsColumn: some View {
        subtitlesList
            .background(Color(uiColor: .systemBackground))
    }

    /// Import options — a sheet (the phone has no room for the iPad's inline panel).
    private var importSheet: some View {
        NavigationStack {
            Form {
                Section {
                    Text("\(pendingImport?.fileName ?? "file") · \(pendingImport?.rows.count ?? 0) mục")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Picker("Chế độ", selection: $importMode) {
                        Text("Gộp (partial)").tag(ScriptCue.ImportMode.merge)
                        Text("Thay thế (full)").tag(ScriptCue.ImportMode.replace)
                    }
                    .pickerStyle(.segmented)
                    Toggle("Gồm JA/timeline", isOn: $importIncludeJA)
                        .disabled(importMode == .replace)
                } header: {
                    Text("Nhập bản dịch")
                } footer: {
                    Text("Gộp: khớp theo cue id hoặc thời điểm ±0,35s + JA (mặc định chỉ EN/VI). Thay thế: xóa script cũ, ghi đè toàn bộ dịch + timeline từ file.")
                }
            }
            .navigationTitle("Nhập bản dịch")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Hủy") {
                        pendingImport = nil
                        sheet = nil
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Áp dụng") { applyImport() }
                }
            }
        }
        .presentationDetents([.medium, .large])
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
                                    fontScale: sidePanelFontScale,
                                    onSeek: { seekRequest = $0 }
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
        guard followTimeline, let id else { return }
        // Target = list top. Skip only when already flush.
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

    private func addCueAtPlayhead() {
        let cue = ScriptCue.addCueAtPlayhead(videoId: videoID, atMs: playheadMs, context: modelContext)
        currentCues = ScriptCue.load(videoId: videoID, context: modelContext).filter { !$0.tombstoned }
        let total = Int(cue.startTime / 1000)
        statusMessage = String(format: "Đã thêm cue tại %d:%02d", total / 60, total % 60)
    }

    private func clearTranslations() {
        ScriptCue.clearTranslations(videoId: videoID, context: modelContext)
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
            sheet = .export(url)
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
            sheet = .importOptions
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
        sheet = nil
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
