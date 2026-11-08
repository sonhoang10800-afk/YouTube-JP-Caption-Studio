import SwiftUI

/// Hardsub caption bar: tracks YouTube video rect, drag + corner resize (desktop parity).
public struct HardsubOverlayView: View {
    /// Current line only — parent owns playhead; avoids rescanning cues on every clock tick.
    let activeCue: ScriptCue?
    /// Video bounds in the player pane (points), from WKWebView VIDEO_RECT.
    var videoFrame: CGRect?
    var showJA: Bool = true
    var showEN: Bool = true
    var showVI: Bool = true
    var showFurigana: Bool = true

    public init(activeCue: ScriptCue?, videoFrame: CGRect? = nil, showJA: Bool = true, showEN: Bool = true, showVI: Bool = true, showFurigana: Bool = true) {
        self.activeCue = activeCue
        self.videoFrame = videoFrame
        self.showJA = showJA
        self.showEN = showEN
        self.showVI = showVI
        self.showFurigana = showFurigana
    }

    /// Normalized top-left inside video; -1 = default (center × 70%).
    @AppStorage("languageCaptionBarNx") private var barNx = -1.0
    @AppStorage("languageCaptionBarNy") private var barNy = -1.0
    @AppStorage("languageCaptionBarScaleW") private var scaleW = 1.0
    @AppStorage("languageCaptionBarScaleH") private var scaleH = 1.0
    /// User multiplier on overlay caption font (desktop `barScale`).
    @AppStorage("languageCaptionBarScale") private var barScale = 1.0
    @AppStorage("languageCaptionBarBgOpacity") private var barBgOpacity = 0.82

    @State private var dragOrigin: CGPoint?
    @State private var resizeStart: (scaleW: Double, scaleH: Double, origin: CGPoint, box: CGSize)?
    @State private var selectedToken: Token?
    /// Freeze caption while dict popup open so playhead ticks don't rebuild tokens.
    @State private var frozenCue: ScriptCue?

    private var displayCue: ScriptCue? { frozenCue ?? activeCue }

    public var body: some View {
        GeometryReader { geo in
            let vr = resolvedVideo(in: geo.size)
            let box = boxSize(for: vr)
            let origin = barOrigin(video: vr, box: box)
            let fontScale = max(0.55, min(1.45, vr.height / 720)) * max(0.55, min(2.4, barScale))

            ZStack(alignment: .topLeading) {
                Color.clear.allowsHitTesting(false)

                if let cue = displayCue {
                    captionBar(cue: cue, fontScale: fontScale)
                        .frame(width: box.width, height: box.height)
                        .background(Color.black.opacity(max(0, min(1, barBgOpacity))), in: RoundedRectangle(cornerRadius: 14 * fontScale, style: .continuous))
                        .shadow(color: .black.opacity(0.45), radius: 12, y: 4)
                        .overlay { cornerHandles(video: vr, box: box, origin: origin) }
                        .contentShape(Rectangle())
                        .position(x: origin.x + box.width / 2, y: origin.y + box.height / 2)
                        .simultaneousGesture(moveGesture(video: vr, box: box))
                        .onTapGesture(count: 2) { resetBar() }
                        // Stable identity — same cue must not re-tokenize / reflow every parent tick.
                        .id(cue.id)
                }
            }
            .frame(width: geo.size.width, height: geo.size.height)
            .dictPopup(
                token: $selectedToken,
                sentenceJA: displayCue?.textJA ?? "",
                sentenceEN: displayCue?.textEN,
                sentenceVI: displayCue?.textVI
            )
            .onChange(of: selectedToken) { _, tok in
                if tok != nil {
                    if frozenCue == nil { frozenCue = activeCue }
                } else {
                    frozenCue = nil
                }
            }
        }
    }

    private func resolvedVideo(in size: CGSize) -> CGRect {
        guard let f = videoFrame, f.width >= 80, f.height >= 60 else {
            return CGRect(origin: .zero, size: size)
        }
        return CGRect(
            x: max(0, min(f.minX, size.width - 40)),
            y: max(0, min(f.minY, size.height - 40)),
            width: min(f.width, size.width),
            height: min(f.height, size.height)
        )
    }

    private func boxSize(for vr: CGRect) -> CGSize {
        let w0 = min(vr.width * 0.68, 920)
        let h0 = max(88, min(vr.height * 0.22, 240))
        return CGSize(
            width: w0 * min(2.5, max(0.45, scaleW)),
            height: h0 * min(2.5, max(0.45, scaleH))
        )
    }

    private func barOrigin(video vr: CGRect, box: CGSize) -> CGPoint {
        let left: CGFloat
        let top: CGFloat
        if barNx < 0 || barNy < 0 {
            left = vr.minX + (vr.width - box.width) / 2
            top = vr.minY + vr.height * 0.70 - box.height / 2
        } else {
            left = vr.minX + CGFloat(barNx) * vr.width
            top = vr.minY + CGFloat(barNy) * vr.height
        }
        return clampOrigin(CGPoint(x: left, y: top), video: vr, box: box)
    }

    private func clampOrigin(_ p: CGPoint, video vr: CGRect, box: CGSize) -> CGPoint {
        CGPoint(
            x: min(max(p.x, vr.minX + 4), max(vr.minX + 4, vr.maxX - box.width - 4)),
            y: min(max(p.y, vr.minY + 4), max(vr.minY + 4, vr.maxY - box.height - 4))
        )
    }

    private func storePos(_ origin: CGPoint, video vr: CGRect) {
        barNx = Double((origin.x - vr.minX) / max(1, vr.width))
        barNy = Double((origin.y - vr.minY) / max(1, vr.height))
    }

    private func resetBar() {
        barNx = -1
        barNy = -1
        scaleW = 1
        scaleH = 1
    }

    private func clampScale(_ v: Double) -> Double { min(2.5, max(0.45, v)) }

    private func moveGesture(video vr: CGRect, box: CGSize) -> some Gesture {
        DragGesture(minimumDistance: 8)
            .onChanged { value in
                if dragOrigin == nil { dragOrigin = barOrigin(video: vr, box: box) }
                guard let start = dragOrigin else { return }
                storePos(
                    clampOrigin(
                        CGPoint(x: start.x + value.translation.width, y: start.y + value.translation.height),
                        video: vr,
                        box: box
                    ),
                    video: vr
                )
            }
            .onEnded { _ in dragOrigin = nil }
    }

    private enum Corner { case topLeading, topTrailing, bottomLeading, bottomTrailing }

    private func cornerHandles(video vr: CGRect, box: CGSize, origin: CGPoint) -> some View {
        ZStack {
            handle(.topLeading, video: vr, box: box, origin: origin).position(x: 6, y: 6)
            handle(.topTrailing, video: vr, box: box, origin: origin).position(x: box.width - 6, y: 6)
            handle(.bottomLeading, video: vr, box: box, origin: origin).position(x: 6, y: box.height - 6)
            handle(.bottomTrailing, video: vr, box: box, origin: origin).position(x: box.width - 6, y: box.height - 6)
        }
        .frame(width: box.width, height: box.height)
    }

    private func handle(_ corner: Corner, video vr: CGRect, box: CGSize, origin: CGPoint) -> some View {
        Circle()
            .fill(Color.white.opacity(0.9))
            .frame(width: 14, height: 14)
            .shadow(radius: 1)
            .gesture(
                DragGesture(minimumDistance: 1)
                    .onChanged { value in
                        if resizeStart == nil {
                            resizeStart = (scaleW, scaleH, origin, box)
                        }
                        guard let start = resizeStart else { return }
                        let w0 = start.box.width / max(0.45, start.scaleW)
                        let h0 = start.box.height / max(0.45, start.scaleH)
                        let dx = value.translation.width
                        let dy = value.translation.height
                        var nextW = start.scaleW
                        var nextH = start.scaleH
                        var left = start.origin.x
                        var top = start.origin.y

                        switch corner {
                        case .bottomTrailing:
                            nextW = clampScale((start.box.width + dx) / w0)
                            nextH = clampScale((start.box.height + dy) / h0)
                        case .bottomLeading:
                            nextW = clampScale((start.box.width - dx) / w0)
                            nextH = clampScale((start.box.height + dy) / h0)
                            left = start.origin.x + (start.box.width - nextW * w0)
                        case .topTrailing:
                            nextW = clampScale((start.box.width + dx) / w0)
                            nextH = clampScale((start.box.height - dy) / h0)
                            top = start.origin.y + (start.box.height - nextH * h0)
                        case .topLeading:
                            nextW = clampScale((start.box.width - dx) / w0)
                            nextH = clampScale((start.box.height - dy) / h0)
                            left = start.origin.x + (start.box.width - nextW * w0)
                            top = start.origin.y + (start.box.height - nextH * h0)
                        }
                        scaleW = nextW
                        scaleH = nextH
                        let newBox = CGSize(width: w0 * nextW, height: h0 * nextH)
                        storePos(clampOrigin(CGPoint(x: left, y: top), video: vr, box: newBox), video: vr)
                    }
                    .onEnded { _ in resizeStart = nil }
            )
    }

    @ViewBuilder
    private func captionBar(cue: ScriptCue, fontScale: CGFloat) -> some View {
        ScrollView {
            VStack(spacing: 4 * fontScale) {
                VStack(spacing: 2 * fontScale) {
                    if showJA, !cue.textJA.isEmpty {
                        TokenizedJAView(
                            text: cue.textJA,
                            fontSize: 24 * fontScale,
                            weight: .bold,
                            showFurigana: showFurigana,
                            centered: true,
                            shadowed: true
                        ) { tok in
                            guard tok.isContentWord else { return }
                            selectedToken = tok
                        }
                    }
                    if showEN, let en = cue.textEN, !en.isEmpty {
                        Text(en)
                            .font(.system(size: 17 * fontScale, weight: .medium))
                            .foregroundStyle(Color(red: 0.72, green: 0.74, blue: 0.82))
                            .multilineTextAlignment(.center)
                    }
                    if showVI, let vi = cue.textVI, !vi.isEmpty {
                        Text(vi)
                            .font(.system(size: 17 * fontScale, weight: .semibold))
                            .foregroundStyle(Color(red: 0.91, green: 0.91, blue: 0.94))
                            .multilineTextAlignment(.center)
                    }
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 14 * fontScale)
            .padding(.vertical, 10 * fontScale)
        }
    }
}
