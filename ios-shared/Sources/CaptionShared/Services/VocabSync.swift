import Foundation
import SwiftData

/// Drive `caption-studio-vocab.json` — vocab-only LWW by `updatedAt`. Never touches VideoScript.
/// Separate file from `BackupService`'s full snapshot so an OAuth push (`scripts: []`)
/// can't wipe scripts from the shared backup file.
@MainActor
public final class VocabSync {
    public static let shared = VocabSync()
    static let fileName = "language-caption-vocab.json"
    static let legacyFileName = "caption-studio-vocab.json"
    private static let fileIdKey = "vocabDriveFileId"
    private static let lastAppliedKey = "vocabDriveLastAppliedUpdatedAt"
    private static let debounceNs: UInt64 = 1_500_000_000

    private var debounceTask: Task<Void, Never>?
    private var applying = false
    /// Held for debounced push after vocab save (same MainActor ModelContext as UI).
    private weak var pendingContext: ModelContext?

    private init() {}

    // MARK: - Public

    /// Connect: pull if remote newer, else push local (creates file if missing).
    public func syncOnConnect(context: ModelContext) async {
        do {
            let remote = try await downloadRemote()
            let localAt = rememberAppliedDate() ?? .distantPast
            if let remote, let remoteAt = remote.updatedAt, remoteAt > localAt,
               !hasLocalUnsynced(context: context) {
                applying = true
                try Self.applyVocabOnly(remote, to: context)
                rememberApplied(remoteAt)
                applying = false
            } else {
                try await pushLocal(context: context)
            }
        } catch {
            applying = false
            #if DEBUG
            print("[VocabSync] syncOnConnect: \(error.localizedDescription)")
            #endif
        }
    }

    public func pullIfNewer(context: ModelContext) async {
        guard DriveAuthService.shared.hasToken else { return }
        do {
            guard let remote = try await downloadRemote(),
                  let remoteAt = remote.updatedAt else { return }
            let localAt = rememberAppliedDate() ?? .distantPast
            guard remoteAt > localAt else { return }
            // Local edits not yet pushed must not be clobbered by the remote copy.
            guard !hasLocalUnsynced(context: context) else {
                try await pushLocal(context: context)
                return
            }
            applying = true
            try Self.applyVocabOnly(remote, to: context)
            rememberApplied(remoteAt)
            applying = false
        } catch {
            applying = false
            #if DEBUG
            print("[VocabSync] pullIfNewer: \(error.localizedDescription)")
            #endif
        }
    }

    /// Any vocabulary saved after the last successful push/apply means local edits
    /// are not on Drive yet — push them instead of pulling over them (LWW wins).
    private func hasLocalUnsynced(context: ModelContext) -> Bool {
        let words = (try? context.fetch(FetchDescriptor<Vocabulary>())) ?? []
        guard let newest = words.map(\.savedAt).max() else { return false }
        return newest > (rememberAppliedDate() ?? .distantPast)
    }

    func schedulePush(context: ModelContext) {
        guard !applying, DriveAuthService.shared.hasToken else { return }
        pendingContext = context
        debounceTask?.cancel()
        debounceTask = Task {
            try? await Task.sleep(nanoseconds: Self.debounceNs)
            guard !Task.isCancelled, !applying, let ctx = pendingContext else { return }
            try? await pushLocal(context: ctx)
        }
    }

    // MARK: - Encode / apply (smoke + Drive)

    /// Always `scripts: []` so OAuth push does not resurrect scripts into the vocab file.
    static func encodeVocabOnly(context: ModelContext, now: Date = Date()) throws -> BackupService.Snapshot {
        let vocab = try context.fetch(FetchDescriptor<Vocabulary>())
        return BackupService.Snapshot(
            updatedAt: now,
            scripts: [],
            vocab: vocab.map { v in
                BackupService.VocabDTO(
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

    /// Replace Vocabulary rows only — VideoScript / cues untouched.
    static func applyVocabOnly(_ snap: BackupService.Snapshot, to context: ModelContext) throws {
        for v in try context.fetch(FetchDescriptor<Vocabulary>()) {
            context.delete(v)
        }
        for vd in snap.vocab {
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
    }

    static func encodeJSON(_ snap: BackupService.Snapshot) throws -> Data {
        let enc = JSONEncoder()
        enc.dateEncodingStrategy = .iso8601
        enc.outputFormatting = [.prettyPrinted, .sortedKeys]
        return try enc.encode(snap)
    }

    static func decodeJSON(_ data: Data) throws -> BackupService.Snapshot {
        let dec = JSONDecoder()
        dec.dateDecodingStrategy = .iso8601
        return try dec.decode(BackupService.Snapshot.self, from: data)
    }

    // MARK: - Drive I/O

    private func pushLocal(context: ModelContext) async throws {
        var snap = try Self.encodeVocabOnly(context: context)
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

    private func downloadRemote() async throws -> BackupService.Snapshot? {
        let fileId = try await ensureFileId(createIfMissing: false)
        guard let fileId else { return nil }
        let text = try await DriveAPIClient.getText(fileId: fileId)
        guard let data = text.data(using: .utf8), !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else { return nil }
        return try Self.decodeJSON(data)
    }

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
            text: #"{"version":1,"scripts":[],"vocab":[]}"#,
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
public enum VocabSyncSmoke {
    @MainActor
    public static func run() {
        let at = Date(timeIntervalSince1970: 1_754_112_000)
        let snap = BackupService.Snapshot(
            updatedAt: at,
            scripts: [
                .init(videoId: "should-not-apply", title: "t", owned: true, cues: [
                    .init(id: "1", startTime: 0, duration: nil, textJA: "あ", textEN: nil, textVI: nil, isDeleted: false)
                ])
            ],
            vocab: [
                .init(word: "世界", reading: "せかい", meaning: "learning", jlptLevel: 5, frequencyCount: 1, savedAt: Date(timeIntervalSince1970: 1_700_000_000))
            ]
        )
        let data = try! VocabSync.encodeJSON(snap)
        let round = try! VocabSync.decodeJSON(data)
        assert(round.updatedAt == at, "updatedAt roundtrip")
        assert(round.vocab.count == 1 && round.vocab[0].word == "世界", "vocab roundtrip")

        let container = try! ModelContainer(
            for: VideoScript.self, ScriptCue.self, Vocabulary.self,
            configurations: ModelConfiguration(isStoredInMemoryOnly: true)
        )
        let ctx = ModelContext(container)

        // Upsert: same word twice → one row, frequencyCount bumped to 2 (unique-constraint save fails silently otherwise).
        let up1 = Vocabulary.upsert(word: "日本", reading: "にほん", meaning: "Japan", context: ctx)
        assert(up1.frequencyCount == 1, "first upsert starts at 1")
        let up2 = Vocabulary.upsert(word: "日本", reading: "にほん", meaning: "Japan", context: ctx)
        assert(up2.frequencyCount == 2, "second upsert bumps count")
        let upAll = try! ctx.fetch(FetchDescriptor<Vocabulary>())
        assert(upAll.filter { $0.word == "日本" }.count == 1, "upsert dedupes by word")
        try! ctx.save()

        let script = VideoScript(videoId: "keep-me", title: "local", owned: true)
        ctx.insert(script)
        ctx.insert(Vocabulary(word: "旧", reading: "", meaning: "old"))
        try! ctx.save()

        // Remote snap carries scripts — apply must ignore them and keep local VideoScript.
        try! VocabSync.applyVocabOnly(snap, to: ctx)
        let scripts = try! ctx.fetch(FetchDescriptor<VideoScript>())
        assert(scripts.count == 1 && scripts[0].videoId == "keep-me", "scripts not wiped")
        let vocab = try! ctx.fetch(FetchDescriptor<Vocabulary>())
        assert(vocab.count == 1 && vocab[0].word == "世界", "vocab replaced")

        let push = try! VocabSync.encodeVocabOnly(context: ctx, now: at)
        assert(push.scripts.isEmpty, "push scripts always []")
        assert(push.vocab.count == 1, "push vocab count")
        let pushRound = try! VocabSync.decodeJSON(try! VocabSync.encodeJSON(push))
        assert(pushRound.scripts.isEmpty && pushRound.vocab.count == 1, "push wire roundtrip")
        print("[VocabSyncSmoke] ok")
    }
}
#endif
