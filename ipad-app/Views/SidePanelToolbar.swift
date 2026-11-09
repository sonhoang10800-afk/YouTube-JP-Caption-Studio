import SwiftUI
import CaptionShared

/// Dark pill toolbar matching extension side panel.
struct SidePanelToolbar: View {
    var onReload: () -> Void
    var onAddCue: () -> Void
    var onClearTranslations: () -> Void
    var onWipeScript: () -> Void
    var onExport: () -> Void
    var onImport: () -> Void
    var onConnectDrive: () -> Void
    var onSettings: () -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                toolButton("Reload", action: onReload)
                toolButton("+ Cue", action: onAddCue)
                toolButton("Xóa dịch", action: onClearTranslations)
                toolButton("Xóa sub", action: onWipeScript)
                toolButton("Export", action: onExport)
                toolButton("Import", action: onImport)
                toolButton("Thư mục", action: onConnectDrive)
                Button(action: onSettings) {
                    Image(systemName: "gearshape.fill")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.white)
                        .frame(width: 32, height: 28)
                        .background(Color(white: 0.22), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
        }
        .background(Color.black)
    }

    private func toolButton(_ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.white)
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .background(
                    Color(white: 0.22),
                    in: RoundedRectangle(cornerRadius: 8, style: .continuous)
                )
        }
        .buttonStyle(.plain)
    }
}

struct SidePanelSettingsSheet: View {
    @AppStorage("languageCaptionOverlayOn") var overlayOn = false
    @AppStorage("sidePanelOn") var sidePanelOn = false
    @AppStorage("languageCaptionShowJA") var showJA = true
    @AppStorage("languageCaptionShowEN.v2") var showEN = true
    @AppStorage("languageCaptionShowVI.v2") var showVI = true
    @AppStorage("languageCaptionShowFurigana") var showFurigana = true
    @AppStorage("languageCaptionBarScale") var overlayFontScale = 1.0
    @AppStorage("sidePanelFontScale") var sidePanelFontScale = 1.0
    @AppStorage("levelHighlightEnabled") var levelHighlightEnabled = true
    @AppStorage("levelColorsJSON") var levelColorsJSON = VocabStyle.defaultLevelColorsJSON
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("Hiển thị") {
                    Toggle("Overlay", isOn: $overlayOn)
                    Toggle("Side panel", isOn: $sidePanelOn)
                    Toggle("Hiện JA", isOn: $showJA)
                    Toggle("Hiện EN", isOn: $showEN)
                    Toggle("Hiện VI", isOn: $showVI)
                    Toggle("Furigana", isOn: $showFurigana)
                }
                Section("Cỡ chữ") {
                    Stepper(value: $overlayFontScale, in: 0.55...2.4, step: 0.1) {
                        Text("Overlay \(String(format: "%.1f", overlayFontScale))×")
                    }
                    Stepper(value: $sidePanelFontScale, in: 0.7...1.8, step: 0.1) {
                        Text("Side panel \(String(format: "%.1f", sidePanelFontScale))×")
                    }
                }
                Section {
                    Toggle("Bật tô màu theo JLPT", isOn: $levelHighlightEnabled)
                    ForEach(VocabStyle.levelKeys, id: \.self) { key in
                        HStack {
                            Toggle(isOn: levelOnBinding(key)) {
                                Text(VocabStyle.levelLabels[key] ?? key.uppercased())
                            }
                            ColorPicker(
                                "",
                                selection: levelColorBinding(key),
                                supportsOpacity: false
                            )
                            .labelsHidden()
                            .disabled(!levelHighlightEnabled || !(VocabStyle.decode(levelColorsJSON)[key]?.on ?? true))
                        }
                    }
                    Button("Đặt lại") {
                        levelColorsJSON = VocabStyle.defaultLevelColorsJSON
                        levelHighlightEnabled = true
                    }
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Văn bản ví dụ")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        HStack(spacing: 6) {
                            ForEach(
                                [("初めて", "n5"), ("砂", "n3"), ("住まい", "n2"), ("マイル", "n1"), ("珍語", "unknown")],
                                id: \.0
                            ) { surface, key in
                                Text(surface)
                                    .font(.body.weight(.semibold))
                                    .foregroundStyle(
                                        VocabStyle.color(forKey: key, json: levelColorsJSON, enabled: levelHighlightEnabled)
                                            ?? Color.primary
                                    )
                            }
                        }
                    }
                    .padding(.vertical, 4)
                } header: {
                    Text("Màu JLPT")
                }
                Section("Connect Drive") {
                    Text("Nút Thư mục → OAuth Google (Drive API). Folder + OAuth client iOS khai báo trong Info.plist (DRIVE_FOLDER_ID / DRIVE_OAUTH_CLIENT_ID). Bắt buộc OAuth client kiểu iOS trên GCP (không dùng client Chrome extension) — xem COMMANDS.md.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Xong") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func levelOnBinding(_ key: String) -> Binding<Bool> {
        Binding(
            get: { VocabStyle.decode(levelColorsJSON)[key]?.on ?? true },
            set: { levelColorsJSON = VocabStyle.updating(json: levelColorsJSON, key: key, on: $0) }
        )
    }

    private func levelColorBinding(_ key: String) -> Binding<Color> {
        Binding(
            get: {
                let hex = VocabStyle.decode(levelColorsJSON)[key]?.color ?? "#c5c5d0"
                return VocabStyle.color(hex: hex) ?? .gray
            },
            set: { levelColorsJSON = VocabStyle.updating(json: levelColorsJSON, key: key, hex: VocabStyle.hex(from: $0)) }
        )
    }
}
