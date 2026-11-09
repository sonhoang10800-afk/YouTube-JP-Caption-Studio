import SwiftUI
import CaptionShared
import SwiftData
import AVFoundation

@main
struct LanguageCaptionApp: App {
    init() {
        SettingsSync.migrateLegacyDefaults()
        try? AVAudioSession.sharedInstance().setCategory(.playback)
        try? AVAudioSession.sharedInstance().setActive(true)
        #if DEBUG
        DriveScriptsSmoke.run()
        BackupSmoke.run()
        ScriptStoreSmoke.run()
        DriveAPISmoke.run()
        SettingsSyncSmoke.run()
        VocabSyncSmoke.run()
        #endif
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
        .modelContainer(for: [VideoScript.self, ScriptCue.self, Vocabulary.self])
    }
}
