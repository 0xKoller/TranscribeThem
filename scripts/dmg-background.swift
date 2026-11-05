import AppKit

// A white typographic print above a separate, native Finder installation area.
let width = 720, height = 480
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width * 2, pixelsHigh: height * 2,
    bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
    colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
rep.size = NSSize(width: width, height: height)
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
func color(_ hex: UInt32, _ alpha: CGFloat = 1) -> NSColor {
    NSColor(srgbRed: CGFloat((hex >> 16) & 255) / 255,
        green: CGFloat((hex >> 8) & 255) / 255, blue: CGFloat(hex & 255) / 255, alpha: alpha)
}
NSColor.white.setFill()
NSRect(x: 0, y: 0, width: width, height: height).fill()
let ink = color(0x39343D)
let palette = NSGradient(colors: [color(0xCE9A57), color(0xCB7278), color(0x8D86B9)])!

// Conversational fragments, rather than unrelated vocabulary, are the ink.
let transcripts = [
    "I'll send it tonight. Let me know when you get home.",
    "Te lo mando esta noche. Avisame cuando llegues a casa.",
    "Je te l’envoie ce soir. Dis-moi quand tu arrives.",
    "Te lo mando stasera. Fammi sapere quando arrivi.",
    "Ich schicke es heute Abend. Sag Bescheid, wenn du da bist.",
    "Envio hoje à noite. Me avisa quando chegar em casa.",
    "今夜送るね。家に着いたら教えてね。",
    "今晚发给你。到家后告诉我。",
    "Coffee after lunch? I know a little place nearby.",
    "¿Tomamos un café? Conozco un lugar cerca de acá.",
    "On se retrouve à huit ? Je réserve une table.",
    "Ho ascoltato la tua canzone. Mi piace tantissimo.",
    "Danke für deine Nachricht. Bis später!",
    "Achei as fotos da viagem. Vou te mandar agora.",
    "駅に着いたよ。ゆっくり来てね。",
    "我刚到车站，别着急。",
    "That was such a good weekend. Let's do it again.",
    "Ya encontré las llaves. Nos vemos en un rato.",
    "J’ai une idée pour demain. Tu me rappelles ?",
    "Ti racconto tutto quando ci vediamo.",
    "Der Zug kommt gleich. Ich bin in zehn Minuten da.",
    "Adorei conversar com você. Até amanhã!",
    "今日はありがとう。また話そうね。",
    "周末一起去散步吧。"
]

func voice(x: CGFloat, y: CGFloat, angle: CGFloat, length: CGFloat,
           height: CGFloat, seed: Int, strength: CGFloat, tintStart: CGFloat) {
    NSGraphicsContext.saveGraphicsState()
    let transform = NSAffineTransform()
    transform.translateX(by: x, yBy: y)
    transform.rotate(byDegrees: angle)
    transform.concat()
    // Stable per-note randomness makes builds reproducible without repeating a motif.
    var state = UInt64(seed + 1) &* 0x9E3779B97F4A7C15
    func random() -> CGFloat {
        state = state &* 6364136223846793005 &+ 1442695040888963407
        return CGFloat(state >> 11) / CGFloat(UInt64.max >> 11)
    }
    let bend = 1.0 + random() * 1.6
    let phase = random() * .pi * 2
    let spacing = 2.4 + random() * 1.1
    let barWidth = 0.65 + random() * 0.45
    let split = 0.33 + random() * 0.075
    let pulseCount = 2 + Int(random() * 4)
    var pulses: [(CGFloat, CGFloat, CGFloat)] = []
    for i in 0..<pulseCount {
        let position = 0.035 + (CGFloat(i) + random() * 0.6) / CGFloat(pulseCount) * split
        pulses.append((position, 0.018 + random() * 0.045, 0.30 + random() * 0.85))
    }
    for i in 0..<3 {
        pulses.append((0.47 + CGFloat(i) * 0.19 + random() * 0.08,
                       0.055 + random() * 0.085, 0.40 + random() * 0.65))
    }
    func profile(_ t: CGFloat) -> CGFloat {
        let energy = pulses.reduce(CGFloat(0.045)) { sum, pulse in
            sum + pulse.2 * exp(-pow((t - pulse.0) / pulse.1, 2))
        }
        return (energy + 0.25 * exp(-pow((t - split) / 0.12, 2))) * pow(max(0, sin(t * .pi)), 0.22)
    }
    let normalization = (0...400).map { profile(CGFloat($0) / 400) }.max()!
    func center(_ u: CGFloat) -> CGFloat {
        sin(u / length * .pi * bend + phase) * height * 0.18
    }
    func envelope(_ u: CGFloat) -> CGFloat { height * profile(u / length) / normalization }
    func smoothstep(_ t: CGFloat) -> CGFloat {
        let v = min(1, max(0, t))
        return v * v * (3 - 2 * v)
    }
    let contour = NSBezierPath()
    for i in 0...400 {
        let u = CGFloat(i) / 400 * length
        let p = NSPoint(x: u, y: center(u) + envelope(u))
        if i == 0 { contour.move(to: p) } else { contour.line(to: p) }
    }
    for i in (0...400).reversed() {
        let u = CGFloat(i) / 400 * length
        contour.line(to: NSPoint(x: u, y: center(u) - envelope(u)))
    }
    contour.close()
    contour.addClip()

    // A staggered typographic handoff: bars divide into small strokes on
    // text baselines. Each row owns one boundary, so bars cannot overprint letters.
    func boundary(_ row: Int) -> CGFloat {
        length * split + sin(CGFloat(row) * 0.85 + phase) * 11
            + cos(CGFloat(row) * 1.4 + CGFloat(seed)) * 4
    }
    for i in 0..<Int((length * split + 17) / spacing) {
        let u = CGFloat(i) * spacing
        let h = envelope(u) * (0.60 + random() * 0.40)
        let tint = palette.interpolatedColor(atLocation: min(1, tintStart + u / length * 0.35))
        tint.withAlphaComponent(strength).setFill()
        let breakup = smoothstep((u / length - split + 0.19) / 0.16)
        if breakup == 0 {
            NSBezierPath(roundedRect: NSRect(x: u, y: center(u) - h,
                width: barWidth, height: h * 2), xRadius: barWidth / 2, yRadius: barWidth / 2).fill()
        } else {
            for row in -12...12 {
                let edge = boundary(row)
                guard u + spacing < edge else { continue }
                let low = max(-h, CGFloat(row) * 10.2 + breakup)
                let high = min(h, CGFloat(row + 1) * 10.2 - breakup * 1.5)
                guard high > low else { continue }
                let turn = smoothstep((u - edge + 17) / 14)
                let strokeHeight = (high - low) * (1 - turn) + min(1.2, high - low) * turn
                let strokeWidth = barWidth + turn * (spacing - barWidth - 0.65)
                let baseline = center(u) + low + (high - low - strokeHeight) / 2
                NSBezierPath(roundedRect: NSRect(x: u, y: baseline,
                    width: strokeWidth, height: strokeHeight), xRadius: 0.35, yRadius: 0.35).fill()
            }
        }
    }
    for row in -12...12 {
        let phrase = transcripts[(row + 12 + seed) % transcripts.count]
        let glyphs = Array(phrase + " ").map(String.init)
        var u = boundary(row) + 1
        var index = 0
        let size: CGFloat = 7.8
        let font = NSFont.systemFont(ofSize: size, weight: .medium)
        while u < length {
            let word = glyphs[index % glyphs.count] as NSString
            let w = word.size(withAttributes: [.font: font]).width
            let v = CGFloat(row) * 10.2 + center(u + w / 2)
            let tint = palette.interpolatedColor(atLocation: min(1, tintStart + u / length * 0.35))
            NSGraphicsContext.saveGraphicsState()
            let glyphTransform = NSAffineTransform()
            glyphTransform.translateX(by: u, yBy: v)
            glyphTransform.rotate(byRadians: atan2(center(u + 1) - center(u), 1))
            glyphTransform.concat()
            word.draw(at: .zero, withAttributes: [
                .font: font, .foregroundColor: tint.withAlphaComponent(strength)
            ])
            NSGraphicsContext.restoreGraphicsState()
            u += w + 0.28; index += 1
        }
    }
    NSGraphicsContext.restoreGraphicsState()
}

// A wallpaper of separate messages: three loose, staggered rows.
// Most notes are fully visible; only the outer edges continue off the page.
let notes: [(CGFloat, CGFloat, CGFloat, CGFloat, CGFloat, Int, CGFloat)] = [
    (-48, 409, 14, 235, 26, 2, 0.08),
    (210, 449, -11, 225, 29, 9, 0.32),
    (482, 405, 17, 247, 25, 16, 0.62),
    (19, 350, -13, 183, 28, 12, 0.18),
    (247, 333, 13, 223, 34, 4, 0.35),
    (523, 355, -9, 211, 28, 19, 0.63),
    (-31, 248, 12, 228, 28, 7, 0.02),
    (224, 257, -7, 218, 27, 14, 0.30),
    (476, 247, 10, 254, 29, 21, 0.57)
]
for (x, y, angle, length, height, seed, tint) in notes {
    voice(x: x, y: y, angle: angle, length: length, height: height,
          seed: seed, strength: 0.84, tintStart: tint)
}

// This open white area belongs to Finder's real, draggable icons.
let arrow = NSBezierPath()
arrow.move(to: NSPoint(x: 333, y: 139)); arrow.line(to: NSPoint(x: 387, y: 139))
arrow.move(to: NSPoint(x: 380, y: 145)); arrow.line(to: NSPoint(x: 387, y: 139)); arrow.line(to: NSPoint(x: 380, y: 133))
arrow.lineWidth = 1.1; arrow.lineCapStyle = .round; arrow.lineJoinStyle = .round
color(0xA49DA9).setStroke(); arrow.stroke()
let instruction = "Drag to Applications to install" as NSString
let attributes: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 12), .foregroundColor: ink]
instruction.draw(at: NSPoint(x: (720 - instruction.size(withAttributes: attributes).width) / 2, y: 28), withAttributes: attributes)
NSGraphicsContext.restoreGraphicsState()
try rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
