import Foundation
import SwiftData
import SwiftUI
import UniformTypeIdentifiers

// MIRRORED FILE — an identical copy lives in the sibling app (ipad-app/ ⇄ iphone-app/).
// No shared Swift package yet: apply every change to BOTH copies and keep them byte-identical.

/// JSON snapshot of scripts + vocab → user-picked folder (Google Drive via Files).
///
/// First-run (physical iPad — you must do this yourself):
/// 1. Open `LanguageCaption.xcodeproj`, select your iPad, Automatic Signing + Team.
/// 2. ⌘R once; on iPad: Settings → General → VPN & Device Management → Trust.
/// 3. In app: Thư mục → Files → Google Drive → vào folder sync / `<videoId>/`
///    → mở `cues.json` (hoặc meta/script); app bookmarks parent sync root.
///    Drive không cho Mở folder — phải chọn file.
@MainActor
public final class BackupService: ObservableObject {
    public static let shared = BackupService()
    static let fileName = "language-caption-backup.json"
    static let legacyFileName = "caption-studio-backup.json"
    private static let bookmarkKey = "backupFolderBookmark"
    private static let lastAppliedKey = "backupLastAppliedUpdatedAt"
    private static let debounceNs: UInt64 = 1_500_000_000

    @Published public private(set) var status: String?
    @Published private(set) var hasFolder = false

    private var debounceTask: Task<Void, Never>?
    private var dirty = false

    private init() {
        hasFolder = UserDefaults.standard.data(forKey: Self.bookmarkKey) != nil
    }

    // MARK: - Schema v1

    struct Snapshot: Codable, Equatable {
        var version: Int = 1
        /// Last-write-wins; ISO8601 on the wire.
        var updatedAt: Date?
        var scripts: [ScriptDTO]
        var vocab: [VocabDTO]
    }

    struct ScriptDTO: Codable, Equatable {
        var videoId: String
        var title: String
        var owned: Bool
        /// Lamport rev + deviceId survive restore so Drive sync doesn't re-pull
        /// over the restored (possibly newer) local copy. Optional = old backups decode.
        var rev: Int?
        var deviceId: String?
        var cues: [CueDTO]
    }

    /// `duration` is persisted when finite — a user-tuned cue length must survive
    /// restore / Drive-newer sync. Legacy backups without it fall back to
    /// `derivedDuration` (next cue start).
    struct CueDTO: Codable, Equatable {
        var id: String
        var startTime: Double
        var duration: Double?
        var textJA: String
        var textEN: String?
        var textVI: String?
        var isDeleted: Bool
    }

    struct VocabDTO: Codable, Equatable {
        var word: String
        var reading: String
        var meaning: String
        var jlptLevel: Int?
        var frequencyCount: Int
        var savedAt: Date
    }

    // MARK: - Public API

    func scheduleBackup(context: ModelContext) {
        dirty = true
        debounceTask?.cancel()
        debounceTask = Task {
            try? await Task.sleep(nanoseconds: Self.debounceNs)
            guard !Task.isCancelled else { return }
            backupNow(context: context)
        }
    }

    /// Flush debounce if a mutation is still pending (scene background).
    public func flushPending(context: ModelContext) {
        guard dirty else { return }
        backupNow(context: context)
    }

    func backupNow(context: ModelContext) {
        debounceTask?.cancel()
        debounceTask = nil
        dirty = false
        guard let folder = resolveFolder() else {
            status = "Chưa chọn thư mục backup"
            return
        }
        let access = folder.startAccessingSecurityScopedResource()
        defer { if access { folder.stopAccessingSecurityScopedResource() } }
        do {
            let snap = try encodeSnapshot(context: context)
            let enc = JSONEncoder()
            enc.dateEncodingStrategy = .iso8601
            enc.outputFormatting = [.prettyPrinted, .sortedKeys]
            let data = try enc.encode(snap)
            let url = folder.appendingPathComponent(Self.fileName)
            try data.write(to: url, options: .atomic)
            if let at = snap.updatedAt { rememberApplied(at) }
            status = "Đã backup \(snap.scripts.count) script · \(snap.vocab.count) từ"
        } catch {
            dirty = true
            status = "Backup lỗi: \(error.localizedDescription)"
        }
    }

    @discardableResult
    func restore(context: ModelContext) -> Bool {
        guard let folder = resolveFolder() else {
            status = "Chưa chọn thư mục backup"
            return false
        }
        let access = folder.startAccessingSecurityScopedResource()
        defer { if access { folder.stopAccessingSecurityScopedResource() } }
        let primary = folder.appendingPathComponent(Self.fileName)
        let legacy = folder.appendingPathComponent(Self.legacyFileName)
        let url: URL
        if FileManager.default.fileExists(atPath: primary.path) {
            url = primary
        } else if FileManager.default.fileExists(atPath: legacy.path) {
            url = legacy
        } else {
            status = "Không thấy \(Self.fileName) (hoặc \(Self.legacyFileName))"
            return false
        }
        guard let data = try? Data(contentsOf: url) else {
            status = "Không đọc được \(url.lastPathComponent)"
            return false
        }
        do {
            let snap = try decodeSnapshot(data)
            try apply(snap, to: context)
            if let at = snap.updatedAt { rememberApplied(at) }
            status = "Đã restore \(snap.scripts.count) script · \(snap.vocab.count) từ"
            dirty = false
            return true
        } catch {
            status = "Restore lỗi: \(error.localizedDescription)"
            return false
        }
    }

    /// After reinstall: if SwiftData empty and backup file exists, restore once.
    public func autoRestoreIfEmpty(context: ModelContext) {
        let scripts = (try? context.fetch(FetchDescriptor<VideoScript>())) ?? []
        let vocab = (try? context.fetch(FetchDescriptor<Vocabulary>())) ?? []
        guard scripts.isEmpty, vocab.isEmpty else { return }
        guard resolveFolder() != nil else { return }
        if restore(context: context) {
            status = (status ?? "") + " (tự động)"
        }
    }

    /// Pull Drive JSON when remote `updatedAt` is newer than last applied (skip if local dirty).
    @discardableResult
    public func syncFromDriveIfNewer(context: ModelContext) -> Bool {
        guard !dirty else { return false }
        guard let folder = resolveFolder() else { return false }
        let access = folder.startAccessingSecurityScopedResource()
        defer { if access { folder.stopAccessingSecurityScopedResource() } }
        let url = folder.appendingPathComponent(Self.fileName)
        guard let data = try? Data(contentsOf: url) else { return false }
        do {
            let snap = try decodeSnapshot(data)
            guard let remote = snap.updatedAt else { return false }
            if let last = lastAppliedUpdatedAt, remote <= last { return false }
            try apply(snap, to: context, merge: true)
            rememberApplied(remote)
            dirty = false
            status = "Đã sync \(snap.scripts.count) script · \(snap.vocab.count) từ (Drive mới hơn)"
            return true
        } catch {
            status = "Sync lỗi: \(error.localizedDescription)"
            return false
        }
    }

    func setFolder(_ url: URL) {
        let root = Self.normalizeSyncRoot(url)
        do {
            let data = try root.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil)
            UserDefaults.standard.set(data, forKey: Self.bookmarkKey)
            hasFolder = true
            status = "Thư mục: \(root.lastPathComponent)"
        } catch {
            status = "Bookmark lỗi: \(error.localizedDescription)"
        }
    }

    /// Walk up from a picked path to the Drive sync root (parent of `<videoId>/` folders).
    /// Uses only `cues.json` / `meta.json` layout — never `caption-studio-backup.json`.
    static func normalizeSyncRoot(_ url: URL) -> URL {
        var candidate = url
        if (try? candidate.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory != true {
            candidate = candidate.deletingLastPathComponent()
        }
        let start = candidate
        for _ in 0..<3 {
            if isVideoFolder(candidate) {
                return candidate.deletingLastPathComponent()
            }
            if isSyncRoot(candidate) {
                return candidate
            }
            let parent = candidate.deletingLastPathComponent()
            if parent.path == candidate.path { break }
            candidate = parent
        }
        return start
    }

    private static func isVideoFolder(_ url: URL) -> Bool {
        let fm = FileManager.default
        return fm.fileExists(atPath: url.appendingPathComponent("cues.json").path)
            || fm.fileExists(atPath: url.appendingPathComponent("meta.json").path)
    }

    private static func isSyncRoot(_ url: URL) -> Bool {
        guard let kids = try? FileManager.default.contentsOfDirectory(
            at: url,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]
        ) else { return false }
        return kids.contains { kid in
            (try? kid.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory == true && isVideoFolder(kid)
        }
    }

    // MARK: - Encode / apply

    func encodeSnapshot(context: ModelContext) throws -> Snapshot {
        let scripts = try context.fetch(FetchDescriptor<VideoScript>())
        let vocab = try context.fetch(FetchDescriptor<Vocabulary>())
        // `script.cues` can be empty after `cue.video =` inserts even though the rows exist
        // (see `ScriptCue.load`). Group the cue table so a snapshot never ships a script
        // without its cues — that empty script was what let a restore delete real subtitles.
        let allCues = try context.fetch(FetchDescriptor<ScriptCue>())
        let cuesByVideo = Dictionary(grouping: allCues, by: { $0.video?.videoId ?? "" })
        return Snapshot(
            updatedAt: Date(),
            scripts: scripts.map { s in
                ScriptDTO(
                    videoId: s.videoId,
                    title: s.title,
                    owned: s.owned,
                    rev: s.rev,
                    deviceId: s.deviceId,
                    cues: (cuesByVideo[s.videoId] ?? []).map { c in
                        CueDTO(
                            id: c.id,
                            startTime: c.startTime,
                            duration: c.duration.isFinite ? c.duration : nil,
                            textJA: c.textJA,
                            textEN: c.textEN,
                            textVI: c.textVI,
                            isDeleted: c.tombstoned
                        )
                    }
                )
            },
            vocab: vocab.map { v in
                VocabDTO(
                    word: v.word,
                    reading: v.reading,
                    meaning: v.meaning,
                    jlptLevel: v.jlptLevel,
                    frequencyCount: v.frequencyCount,
                    savedAt: v.savedAt
                )
            }
        )
    }

    /// Duration from next start; last cue → `CueTiming.defaultDurMs`.
    /// Fallback for legacy wire files that carry no `duration`.
    static func derivedDuration(cues: [CueDTO], index: Int) -> Double {
        let sorted = cues.sorted { $0.startTime < $1.startTime }
        guard index >= 0, index < sorted.count else { return CueTiming.defaultDurMs }
        if index + 1 < sorted.count {
            let d = sorted[index + 1].startTime - sorted[index].startTime
            return d > 0 ? d : CueTiming.minDurMs
        }
        return CueTiming.defaultDurMs
    }

    /// Wire duration when present and sane, else derived from the next start.
    static func resolvedDuration(cues: [CueDTO], index: Int) -> Double {
        let sorted = cues.sorted { $0.startTime < $1.startTime }
        guard index >= 0, index < sorted.count else { return CueTiming.defaultDurMs }
        if let d = sorted[index].duration, d.isFinite, d > 0 { return d }
        return derivedDuration(cues: sorted, index: index)
    }

    /// `merge` upserts instead of replacing: rows the snapshot does not carry survive, and
    /// cues match by id so a local-only cue is never dropped. The background Drive pull uses
    /// it — a pull the user never confirmed must not delete their work.
    fileprivate enum SnapshotError: Error {
        case duplicateVideoId(String)
    }

    fileprivate func apply(_ snap: Snapshot, to context: ModelContext, merge: Bool = false) throws {
        // Validate BEFORE touching the store: SwiftData does not reliably throw on
        // duplicate unique attributes (verified: no throw on macOS file-backed nor on
        // iOS Simulator stores — rows silently resolve instead). Depending on the
        // store to reject a corrupt snapshot meant a dup videoId wiped good data on
        // some stacks and crashed the DEBUG smoke on others. Reject it here instead.
        var seenIds = Set<String>()
        if let dup = snap.scripts.map(\.videoId).first(where: { !seenIds.insert($0).inserted }) {
            throw SnapshotError.duplicateVideoId(dup)
        }
        let localScripts = try context.fetch(FetchDescriptor<VideoScript>())
        let localIds = localScripts.map(\.videoId)
        let scriptByVideoId = Dictionary(localScripts.map { ($0.videoId, $0) }, uniquingKeysWith: { a, _ in a })
        let cueById = Dictionary(
            (try context.fetch(FetchDescriptor<ScriptCue>())).map { ($0.id, $0) },
            uniquingKeysWith: { a, _ in a }
        )
        let localWords = Set((try context.fetch(FetchDescriptor<Vocabulary>())).map(\.word))
        if !merge {
            for s in localScripts { context.delete(s) }
            for v in (try context.fetch(FetchDescriptor<Vocabulary>())) { context.delete(v) }
        }
        // Single save at the end: a mid-insert failure must not permanently wipe
        // the existing data (wipe and insert are one transaction on the next save).

        do {
            for sd in snap.scripts {
                let script: VideoScript
                if merge, let keep = scriptByVideoId[sd.videoId] {
                    script = keep
                } else {
                    script = VideoScript(videoId: sd.videoId, title: sd.title, owned: sd.owned)
                    context.insert(script)
                }
                script.title = sd.title
                script.owned = sd.owned
                // Restore Lamport state — otherwise rev resets to 0 and Drive sync
                // re-pulls (and may overwrite) the just-restored local copy.
                script.rev = sd.rev ?? script.rev
                script.deviceId = sd.deviceId ?? script.deviceId
                let ordered = sd.cues.sorted { $0.startTime < $1.startTime }
                for (i, cd) in ordered.enumerated() {
                    let duration = Self.resolvedDuration(cues: ordered, index: i)
                    if merge, let fetched = cueById[cd.id] {
                        // Replace the row instead of editing it in place: the script's
                        // relationship keeps a stale copy of an in-place edit, so a pulled
                        // tombstone would never reach the UI.
                        context.delete(fetched)
                    }
                    let cue = ScriptCue(
                        id: cd.id,
                        startTime: cd.startTime,
                        duration: duration,
                        textJA: cd.textJA,
                        textEN: cd.textEN,
                        textVI: cd.textVI,
                        tombstoned: cd.isDeleted
                    )
                    cue.video = script
                    context.insert(cue)
                }
            }
            if merge, !scriptByVideoId.isEmpty {
                // Rebuild each kept script's in-memory relationship from the store.
                // Delete+insert leaves the persisted rows right, but on some OS
                // versions a deleted row's ghost (or a stale copy) survives in the
                // relationship array — and ScriptCue.load (what the UI reads)
                // prefers that array. Reconciling here makes the merge read the
                // same rows on every version.
                let freshCues = try context.fetch(FetchDescriptor<ScriptCue>())
                for keep in scriptByVideoId.values {
                    // Union by id, store wins: keeps relationship-only members (nil
                    // video) while a stale copy loses to its replacement row.
                    var byId = [String: ScriptCue]()
                    for cue in keep.cues { byId[cue.id] = cue }
                    for cue in freshCues where cue.video === keep { byId[cue.id] = cue }
                    keep.cues = Array(byId.values)
                }
            }
            for vd in snap.vocab {
                if merge, localWords.contains(vd.word) { continue }
                let v = Vocabulary(
                    word: vd.word,
                    reading: vd.reading,
                    meaning: vd.meaning,
                    jlptLevel: vd.jlptLevel,
                    frequencyCount: vd.frequencyCount
                )
                v.savedAt = vd.savedAt
                context.insert(v)
            }
            try context.save()
        } catch {
            // The wipe is only *pending* — without a rollback a later save() would
            // persist "everything deleted" after a failed restore. Discard it.
            context.rollback()
            throw error
        }
        // The restored state is authoritative: stale dirty ids would force a
        // spurious patch-push + rev bump on the next Drive sync (ping-pong).
        for id in Set(localIds + snap.scripts.map(\.videoId)) { DriveDirty.clear(videoId: id) }
    }

    private func decodeSnapshot(_ data: Data) throws -> Snapshot {
        let dec = JSONDecoder()
        dec.dateDecodingStrategy = .iso8601
        return try dec.decode(Snapshot.self, from: data)
    }

    private var lastAppliedUpdatedAt: Date? {
        let t = UserDefaults.standard.double(forKey: Self.lastAppliedKey)
        guard t > 0 else { return nil }
        return Date(timeIntervalSince1970: t)
    }

    private func rememberApplied(_ date: Date) {
        UserDefaults.standard.set(date.timeIntervalSince1970, forKey: Self.lastAppliedKey)
    }

    /// A `save()` failed — the edit is not persisted. Shown in the status line.
    func reportSaveFailure(_ error: Error) {
        status = "Lưu lỗi: \(error.localizedDescription)"
    }

    /// Shared with `DriveScriptsService` — one folder bookmark for the whole app.
    func resolveFolder() -> URL? {
        guard let data = UserDefaults.standard.data(forKey: Self.bookmarkKey) else { return nil }
        var stale = false
        guard let url = try? URL(
            resolvingBookmarkData: data,
            options: [],
            relativeTo: nil,
            bookmarkDataIsStale: &stale
        ) else { return nil }
        if stale, let fresh = try? url.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil) {
            UserDefaults.standard.set(fresh, forKey: Self.bookmarkKey)
        }
        return url
    }
}

extension ModelContext {
    /// Save then debounce Drive backup — call after every data mutation.
    @MainActor
    public func saveAndScheduleBackup() {
        do {
            try save()
        } catch {
            // The mutation is NOT persisted (e.g. unique-constraint violation).
            // Roll back so the context stays consistent, surface the error, and
            // do NOT back up: the backup would encode the stale on-disk state and
            // make a failed edit look like it landed.
            rollback()
            BackupService.shared.reportSaveFailure(error)
            return
        }
        BackupService.shared.scheduleBackup(context: self)
        VocabSync.shared.schedulePush(context: self)
    }
}

// MARK: - Folder picker

/// Drive File Provider: folder Open is disabled — pick `cues.json` / `meta.json` / `script.txt`
/// inside a `<videoId>/` folder; normalize walks up to the sync root. `.folder` kept for
/// iCloud / On My iPad where folder Open still works.
public struct BackupFolderPicker: UIViewControllerRepresentable {
    var onPick: (URL) -> Void

    public func makeUIViewController(context: Context) -> UIDocumentPickerViewController {
        let types: [UTType] = [.json, .plainText, .text, .folder]
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: types, asCopy: false)
        picker.delegate = context.coordinator
        picker.allowsMultipleSelection = false
        return picker
    }

    public func updateUIViewController(_ uiViewController: UIDocumentPickerViewController, context: Context) {}

    public func makeCoordinator() -> Coordinator { Coordinator(onPick: onPick) }

    public final class Coordinator: NSObject, UIDocumentPickerDelegate {
        let onPick: (URL) -> Void
        init(onPick: @escaping (URL) -> Void) { self.onPick = onPick }

        public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
            guard let url = urls.first else { return }
            let pickedAccess = url.startAccessingSecurityScopedResource()
            defer { if pickedAccess { url.stopAccessingSecurityScopedResource() } }

            let isDir = (try? url.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory == true
            let folder = isDir ? url : url.deletingLastPathComponent()
            // Parent scope while the picked file scope is still held (Drive quirk).
            let folderAccess = !isDir && folder.startAccessingSecurityScopedResource()
            defer { if folderAccess { folder.stopAccessingSecurityScopedResource() } }
            // Normalize while scoped access is live so walk-up can list children.
            onPick(BackupService.normalizeSyncRoot(folder))
        }
    }
}

#if DEBUG
public enum BackupSmoke {
    @MainActor
    public static func run() {
        let at = Date(timeIntervalSince1970: 1_754_112_000)
        let cues: [BackupService.CueDTO] = [
            .init(id: "1", startTime: 0, duration: 1500, textJA: "こんにちは", textEN: "Hi", textVI: "Xin chào", isDeleted: false),
            .init(id: "2", startTime: 1000, duration: nil, textJA: "世界", textEN: nil, textVI: nil, isDeleted: true),
        ]
        let snap = BackupService.Snapshot(
            updatedAt: at,
            scripts: [
                .init(videoId: "abc", title: "t", owned: true, rev: 7, deviceId: "ipad-smoke", cues: cues)
            ],
            vocab: [
                .init(word: "世界", reading: "せかい", meaning: "world", jlptLevel: 5, frequencyCount: 2, savedAt: Date(timeIntervalSince1970: 1_700_000_000))
            ]
        )
        let enc = JSONEncoder()
        enc.dateEncodingStrategy = .iso8601
        let data = try! enc.encode(snap)
        let json = String(data: data, encoding: .utf8)!
        assert(json.contains("\"duration\":1500"), "duration on wire")
        assert(json.contains("updatedAt"), "updatedAt present")
        assert(json.contains("\"rev\":7"), "rev on wire")
        assert(json.contains("\"deviceId\":\"ipad-smoke\""), "deviceId on wire")
        let dec = JSONDecoder()
        dec.dateDecodingStrategy = .iso8601
        let round = try! dec.decode(BackupService.Snapshot.self, from: data)
        assert(round.version == 1, "version")
        assert(round.updatedAt == at, "updatedAt roundtrip")
        assert(round.scripts.count == 1 && round.scripts[0].cues.count == 2, "cue count")
        assert(round.scripts[0].rev == 7, "rev roundtrip")
        assert(round.scripts[0].deviceId == "ipad-smoke", "deviceId roundtrip")
        assert(round.scripts[0].cues[0].textJA == "こんにちは", "cue text")
        assert(round.scripts[0].cues[0].duration == 1500, "duration roundtrip")
        assert(round.scripts[0].cues[1].duration == nil, "nil duration stays nil")
        assert(round.vocab.count == 1 && round.vocab[0].word == "世界", "vocab count")
        assert(abs(BackupService.derivedDuration(cues: cues, index: 0) - 1000) < 0.001, "derive next start")
        assert(abs(BackupService.derivedDuration(cues: cues, index: 1) - CueTiming.defaultDurMs) < 0.001, "last default dur")
        // Wire duration wins; a cue without it falls back to the derived length.
        assert(abs(BackupService.resolvedDuration(cues: cues, index: 0) - 1500) < 0.001, "wire duration wins")
        assert(abs(BackupService.resolvedDuration(cues: cues, index: 1) - CueTiming.defaultDurMs) < 0.001, "no wire duration → derived")
        // Legacy wire with duration still decodes and is honoured.
        let legacy = #"{"version":1,"scripts":[{"videoId":"x","title":"t","owned":true,"cues":[{"id":"1","startTime":0,"duration":999,"textJA":"a","isDeleted":false}]}],"vocab":[]}"#.data(using: .utf8)!
        let old = try! dec.decode(BackupService.Snapshot.self, from: legacy)
        assert(old.scripts[0].cues[0].duration == 999, "legacy duration decoded")
        assert(old.scripts[0].rev == nil && old.scripts[0].deviceId == nil, "legacy rev/deviceId nil")
        assert(abs(BackupService.resolvedDuration(cues: old.scripts[0].cues, index: 0) - 999) < 0.001, "legacy wire duration honoured")

        // Real round-trip: encode a store → apply into a fresh store → same duration.
        let container = try! ModelContainer(
            for: VideoScript.self, ScriptCue.self, Vocabulary.self,
            configurations: ModelConfiguration(isStoredInMemoryOnly: true)
        )
        let ctx = ModelContext(container)
        let script = VideoScript(videoId: "smoke-dur", title: "t", owned: true)
        ctx.insert(script)
        let cue = ScriptCue(id: "c1", startTime: 0, duration: 1234, textJA: "あ")
        cue.video = script
        script.cues.append(cue)
        ctx.insert(cue)
        try! ctx.save()
        let live = try! BackupService.shared.encodeSnapshot(context: ctx)
        assert(live.scripts.first?.cues.first?.duration == 1234, "duration on the encoded wire")

        let target = try! ModelContainer(
            for: VideoScript.self, ScriptCue.self, Vocabulary.self,
            configurations: ModelConfiguration(isStoredInMemoryOnly: true)
        )
        let targetCtx = ModelContext(target)
        try! BackupService.shared.apply(live, to: targetCtx)
        let restored = ScriptCue.load(videoId: "smoke-dur", context: targetCtx)
        assert(restored.count == 1, "restored cue count")
        assert(abs(restored[0].duration - 1234) < 0.001, "user-tuned duration survives restore")

        // A failing apply must not wipe the store: a snapshot with a duplicate
        // videoId is rejected by apply() itself (see above — the store cannot be
        // relied on to throw), so old rows survive.
        let dup = BackupService.Snapshot(
            updatedAt: at,
            scripts: [
                .init(videoId: "dup", title: "a", owned: true, rev: nil, deviceId: nil, cues: []),
                .init(videoId: "dup", title: "b", owned: true, rev: nil, deviceId: nil, cues: []),
            ],
            vocab: []
        )
        var applyThrew = false
        do {
            try BackupService.shared.apply(dup, to: targetCtx)
        } catch {
            applyThrew = true
        }
        assert(applyThrew, "duplicate videoId must fail the apply")
        assert(ScriptCue.load(videoId: "smoke-dur", context: targetCtx).count == 1,
               "failed apply rolls back — old rows survive")

        // B-4: the background Drive pull merges. A cue the snapshot never carried must
        // survive, a snapshot cue is upserted, and a snapshot tombstone still applies.
        let pulled = BackupService.Snapshot(
            updatedAt: at,
            scripts: [.init(
                videoId: "smoke-dur", title: "t2", owned: true, rev: 7, deviceId: "d2",
                cues: [
                    .init(id: "c1", startTime: 0, duration: 1234, textJA: "あ",
                          textEN: nil, textVI: "a", isDeleted: true),
                    .init(id: "c2", startTime: 3, duration: 900, textJA: "い",
                          textEN: nil, textVI: nil, isDeleted: false),
                ]
            )],
            vocab: []
        )
        try! BackupService.shared.apply(pulled, to: targetCtx, merge: true)
        let mergedCues = ScriptCue.load(videoId: "smoke-dur", context: targetCtx)
        assert(mergedCues.count == 2, "merge upserts the pulled cue and keeps the local one")
        assert(mergedCues.first(where: { $0.id == "c1" })?.tombstoned == true,
               "a tombstone from the snapshot still applies on merge")
        assert(mergedCues.first(where: { $0.id == "c2" })?.duration == 900, "pulled cue inserted")
        let mergedScript = try! targetCtx.fetch(FetchDescriptor<VideoScript>()).first
        assert(mergedScript?.rev == 7 && mergedScript?.deviceId == "d2",
               "merge takes the snapshot Lamport state")
        assert(mergedScript?.title == "t2", "merge takes the snapshot title")

        // A merge must not resurrect a script that only the snapshot drops: local rows stay.
        let localOnly = ScriptCue(id: "c-local", startTime: 9, duration: 400, textJA: "う")
        localOnly.video = mergedScript
        targetCtx.insert(localOnly)
        try! targetCtx.save()
        try! BackupService.shared.apply(pulled, to: targetCtx, merge: true)
        assert(ScriptCue.load(videoId: "smoke-dur", context: targetCtx).count == 3,
               "a cue absent from the snapshot is not deleted by a merge")

        // Walk-up: …/YouTube JP Caption Studio/EiISOvl2_tQ/cues.json → sync root (not videoId).
        let tmp = FileManager.default.temporaryDirectory
            .appendingPathComponent("YouTube JP Caption Studio-\(UUID().uuidString)", isDirectory: true)
        let video = tmp.appendingPathComponent("EiISOvl2_tQ", isDirectory: true)
        try! FileManager.default.createDirectory(at: video, withIntermediateDirectories: true)
        try! Data("{}".utf8).write(to: video.appendingPathComponent("cues.json"))
        try! Data("{}".utf8).write(to: video.appendingPathComponent("meta.json"))
        try! Data("ja".utf8).write(to: video.appendingPathComponent("script.txt"))
        assert(BackupService.normalizeSyncRoot(video) == tmp, "video folder walks to root")
        assert(BackupService.normalizeSyncRoot(video.appendingPathComponent("cues.json")) == tmp, "cues.json → sync root")
        assert(BackupService.normalizeSyncRoot(video.appendingPathComponent("meta.json")) == tmp, "meta.json → sync root")
        assert(BackupService.normalizeSyncRoot(video.appendingPathComponent("script.txt")) == tmp, "script.txt → sync root")
        assert(BackupService.normalizeSyncRoot(tmp) == tmp, "sync root stays")
        try? FileManager.default.removeItem(at: tmp)

        print("[BackupSmoke] ok")
    }
}
#endif
