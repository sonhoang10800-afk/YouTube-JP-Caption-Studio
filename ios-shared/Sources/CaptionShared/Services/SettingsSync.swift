import Foundation

/// Drive `caption-studio-settings.json` — LWW by `updatedAt`. Skips geometry (barPos, panel width).
@MainActor
public final class SettingsSync {
    public static let shared = SettingsSync()
    static let fileName = "language-caption-settings.json"
    static let legacyFileName = "caption-studio-settings.json"
    private static let fileIdKey = "settingsDriveFileId"
    private static let lastAppliedKey = "settingsLastAppliedUpdatedAt"
    private static let debounceNs: UInt64 = 1_500_000_000

    private var debounceTask: Task<Void, Never>?
    private var applying = false
    private var observing = false

    private init() {}

    // MARK: - Wire

    struct Snapshot: Codable, Equatable {
        var version: Int = 1
        var updatedAt: Date?
        var showFurigana: Bool?
        var barShowJa: Bool?
        var barShowEn: Bool?
        var barShowVi: Bool?
        var barScale: Double?
        var barBgOpacity: Double?
        var barTextOpacity: Double?
        var dimHardsub: Bool?
        var dictShowSentence: Bool?
        var levelHighlightEnabled: Bool?
        var levelColors: [String: VocabStyle.Entry]?
        var followTimeline: Bool?
        var isDarkTheme: Bool?
        var sidePanelFontScale: Double?
    }

    /// AppStorage / UserDefaults ↔ wire keys (geometry omitted).
    /// Keys use `languageCaption*` prefix; `migrateLegacyDefaults()` copies old `hardsub*` once.
    private static let map: [(ud: String, wire: WritableKeyPath<Snapshot, Bool?>, def: Bool)] = [
        ("languageCaptionShowFurigana", \.showFurigana, true),
        ("languageCaptionShowJA", \.barShowJa, true),
        ("languageCaptionShowEN.v2", \.barShowEn, true),
        ("languageCaptionShowVI.v2", \.barShowVi, true),
        ("languageCaptionDimHardsub", \.dimHardsub, false),
        ("dictShowSentence", \.dictShowSentence, true),
        ("levelHighlightEnabled", \.levelHighlightEnabled, true),
        ("followTimeline", \.followTimeline, true),
        ("isDarkTheme", \.isDarkTheme, true),
    ]

    private static let doubles: [(ud: String, wire: WritableKeyPath<Snapshot, Double?>, def: Double)] = [
        ("languageCaptionBarScale", \.barScale, 1),
        ("languageCaptionBarBgOpacity", \.barBgOpacity, 0.82),
        ("languageCaptionBarTextOpacity", \.barTextOpacity, 1),
        ("sidePanelFontScale", \.sidePanelFontScale, 1),
    ]

    private static let legacyKeyPairs: [(legacy: String, modern: String)] = [
        ("hardsubShowFurigana", "languageCaptionShowFurigana"),
        ("hardsubShowJA", "languageCaptionShowJA"),
        ("hardsubShowEN.v2", "languageCaptionShowEN.v2"),
        ("hardsubShowVI.v2", "languageCaptionShowVI.v2"),
        ("hardsubDimHardsub", "languageCaptionDimHardsub"),
        ("hardsubBarScale", "languageCaptionBarScale"),
        ("hardsubBarBgOpacity", "languageCaptionBarBgOpacity"),
        ("hardsubBarTextOpacity", "languageCaptionBarTextOpacity"),
        ("hardsubOverlayOn", "languageCaptionOverlayOn"),
        ("hardsubBarNx", "languageCaptionBarNx"),
        ("hardsubBarNy", "languageCaptionBarNy"),
        ("hardsubBarScaleW", "languageCaptionBarScaleW"),
        ("hardsubBarScaleH", "languageCaptionBarScaleH"),
    ]

    /// One-shot UserDefaults migrate from hardsub* → languageCaption*.
    public static func migrateLegacyDefaults() {
        let flag = "languageCaptionDefaultsMigratedV1"
        let ud = UserDefaults.standard
        guard !ud.bool(forKey: flag) else { return }
        for pair in legacyKeyPairs {
            if ud.object(forKey: pair.modern) == nil, let val = ud.object(forKey: pair.legacy) {
                ud.set(val, forKey: pair.modern)
            }
        }
        ud.set(true, forKey: flag)
    }

    // MARK: - Public

    /// Start observing settings edits → debounce push when Drive connected.
    public func startObserving() {
        Self.migrateLegacyDefaults()
        guard !observing else { return }
        observing = true
        NotificationCenter.default.addObserver(
            forName: UserDefaults.didChangeNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.schedulePush() }
        }
    }

    /// Connect: pull if remote newer, else push local (creates file if missing).
    public func syncOnConnect() async {
        startObserving()
        do {
            let remote = try await downloadRemote()
            let localAt = rememberAppliedDate() ?? .distantPast
            if let remote, let remoteAt = remote.updatedAt, remoteAt > localAt {
                applying = true
                Self.applyToDefaults(remote)
                rememberApplied(remoteAt)
                applying = false
            } else {
                try await pushLocal()
            }
        } catch {
            // OAuth/token optional paths — surface via status only when Connect already succeeded.
            #if DEBUG
            print("[SettingsSync] syncOnConnect: \(error.localizedDescription)")
            #endif
        }
    }

    public func pullIfNewer() async {
        guard DriveAuthService.shared.hasToken else { return }
        startObserving()
        do {
            guard let remote = try await downloadRemote(),
                  let remoteAt = remote.updatedAt else { return }
            let localAt = rememberAppliedDate() ?? .distantPast
            guard remoteAt > localAt else { return }
            applying = true
            Self.applyToDefaults(remote)
            rememberApplied(remoteAt)
            applying = false
        } catch {
            #if DEBUG
            print("[SettingsSync] pullIfNewer: \(error.localizedDescription)")
            #endif
        }
    }

    func schedulePush() {
        guard !applying, DriveAuthService.shared.hasToken else { return }
        debounceTask?.cancel()
        debounceTask = Task {
            try? await Task.sleep(nanoseconds: Self.debounceNs)
            guard !Task.isCancelled, !applying else { return }
            try? await pushLocal()
        }
    }

    // MARK: - Encode / decode (also used by smoke)

    static func encodeLocal(now: Date = Date()) -> Snapshot {
        let ud = UserDefaults.standard
        var snap = Snapshot(updatedAt: now)
        for row in map {
            let v = ud.object(forKey: row.ud) as? Bool ?? row.def
            snap[keyPath: row.wire] = v
        }
        for row in doubles {
            let v = ud.object(forKey: row.ud) as? Double ?? row.def
            snap[keyPath: row.wire] = v
        }
        let json = ud.string(forKey: "levelColorsJSON") ?? VocabStyle.defaultLevelColorsJSON
        snap.levelColors = VocabStyle.decode(json)
        return snap
    }

    static func applyToDefaults(_ snap: Snapshot) {
        let ud = UserDefaults.standard
        for row in map {
            if let v = snap[keyPath: row.wire] { ud.set(v, forKey: row.ud) }
        }
        for row in doubles {
            if let v = snap[keyPath: row.wire] { ud.set(v, forKey: row.ud) }
        }
        if let colors = snap.levelColors {
            ud.set(VocabStyle.encode(colors), forKey: "levelColorsJSON")
        }
    }

    static func encodeJSON(_ snap: Snapshot) throws -> Data {
        let enc = JSONEncoder()
        enc.dateEncodingStrategy = .iso8601
        enc.outputFormatting = [.prettyPrinted, .sortedKeys]
        return try enc.encode(snap)
    }

    static func decodeJSON(_ data: Data) throws -> Snapshot {
        let dec = JSONDecoder()
        dec.dateDecodingStrategy = .iso8601
        return try dec.decode(Snapshot.self, from: data)
    }

    // MARK: - Drive I/O

    private func pushLocal() async throws {
        var snap = Self.encodeLocal()
        snap.updatedAt = Date()
        let data = try Self.encodeJSON(snap)
        let text = String(data: data, encoding: .utf8) ?? "{}"
        let fileId = try await ensureFileId()
        _ = try await DriveAPIClient.putText(
            folderId: DriveOAuthConfig.folderId,
            name: Self.fileName,
            text: text,
            fileId: fileId
        )
        if let at = snap.updatedAt { rememberApplied(at) }
    }

    private func downloadRemote() async throws -> Snapshot? {
        let fileId = try await ensureFileId(createIfMissing: false)
        guard let fileId else { return nil }
        let text = try await DriveAPIClient.getText(fileId: fileId)
        guard let data = text.data(using: .utf8), !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else { return nil }
        return try Self.decodeJSON(data)
    }

    /// When `createIfMissing`, creates an empty JSON file then caller pushes local.
    @discardableResult
    private func ensureFileId(createIfMissing: Bool = true) async throws -> String? {
        if let cached = UserDefaults.standard.string(forKey: Self.fileIdKey), !cached.isEmpty {
            return cached
        }
        let kids = try await DriveAPIClient.children(folderId: DriveOAuthConfig.folderId)
        if let id = kids[Self.fileName] ?? kids[Self.legacyFileName] {
            UserDefaults.standard.set(id, forKey: Self.fileIdKey)
            return id
        }
        guard createIfMissing else { return nil }
        let id = try await DriveAPIClient.putText(
            folderId: DriveOAuthConfig.folderId,
            name: Self.fileName,
            text: "{}",
            fileId: nil
        )
        guard !id.isEmpty else { return nil }
        UserDefaults.standard.set(id, forKey: Self.fileIdKey)
        return id
    }

    private func rememberApplied(_ at: Date) {
        UserDefaults.standard.set(at.timeIntervalSince1970, forKey: Self.lastAppliedKey)
    }

    private func rememberAppliedDate() -> Date? {
        let t = UserDefaults.standard.double(forKey: Self.lastAppliedKey)
        return t > 0 ? Date(timeIntervalSince1970: t) : nil
    }
}

#if DEBUG
public enum SettingsSyncSmoke {
    @MainActor
    public static func run() {
        let at = Date(timeIntervalSince1970: 1_754_112_000)
        var snap = SettingsSync.Snapshot(
            updatedAt: at,
            showFurigana: false,
            barShowJa: true,
            barShowEn: false,
            barShowVi: true,
            barScale: 1.2,
            barBgOpacity: 0.5,
            barTextOpacity: 0.9,
            dimHardsub: true,
            dictShowSentence: false,
            levelHighlightEnabled: false,
            levelColors: VocabStyle.decode(VocabStyle.defaultLevelColorsJSON),
            followTimeline: false,
            isDarkTheme: false,
            sidePanelFontScale: 1.4
        )
        let data = try! SettingsSync.encodeJSON(snap)
        let round = try! SettingsSync.decodeJSON(data)
        assert(round.updatedAt == at, "updatedAt roundtrip")
        assert(round.showFurigana == false && round.barShowEn == false, "bools")
        assert(abs((round.barScale ?? 0) - 1.2) < 0.001, "barScale")
        assert(round.dimHardsub == true && round.followTimeline == false, "flags")
        assert(round.levelColors?["n5"]?.color == "#7fd6a8", "levelColors")
        // Missing file → local encode still valid (create-from-local path).
        snap.updatedAt = nil
        let bare = try! SettingsSync.encodeJSON(snap)
        let bareRound = try! SettingsSync.decodeJSON(bare)
        assert(bareRound.version == 1, "version default")
        print("[SettingsSyncSmoke] ok")
    }
}
#endif
