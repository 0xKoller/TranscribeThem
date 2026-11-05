import AppKit

// Deterministic vector artwork, rasterized separately at each shipping size.
// This is the legacy ICNS path for macOS 14+, not an Icon Composer layered icon.
let root = URL(fileURLWithPath: CommandLine.arguments[1])
// Read the SVG source so generated PNG/ICNS assets cannot drift from its bars.
final class BarParser: NSObject, XMLParserDelegate {
    var bars: [(CGFloat, CGFloat, CGFloat, CGFloat)] = []
    func parser(_ parser: XMLParser, didStartElement name: String,
                namespaceURI: String?, qualifiedName: String?, attributes: [String: String]) {
        guard name == "rect", let x = Double(attributes["x"] ?? ""),
              let y = Double(attributes["y"] ?? ""),
              let width = Double(attributes["width"] ?? ""),
              let height = Double(attributes["height"] ?? "") else { return }
        bars.append((CGFloat(x), CGFloat(y), CGFloat(width), CGFloat(height)))
    }
}
let parser = XMLParser(contentsOf: root.appendingPathComponent("transcribethem.svg"))!
let delegate = BarParser()
parser.delegate = delegate
precondition(parser.parse() && delegate.bars.count == 17, "Expected seventeen SVG bars")
let iconBars = delegate.bars

func color(_ hex: UInt32) -> NSColor {
    NSColor(srgbRed: CGFloat((hex >> 16) & 255) / 255,
            green: CGFloat((hex >> 8) & 255) / 255,
            blue: CGFloat(hex & 255) / 255, alpha: 1)
}
func roundRect(_ rect: NSRect, _ radius: CGFloat) -> NSBezierPath {
    NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius)
}
func draw(size: Int, to url: URL, template: Bool = false) throws {
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    let context = NSGraphicsContext(bitmapImageRep: rep)!
    NSGraphicsContext.current = context
    context.shouldAntialias = true
    let transform = AffineTransform(scale: CGFloat(size) / 1024)
    (transform as NSAffineTransform).concat()
    if !template {
        let tile = roundRect(NSRect(x: 72, y: 72, width: 880, height: 880), 196)
        NSGraphicsContext.saveGraphicsState()
        let shadow = NSShadow()
        shadow.shadowColor = NSColor.black.withAlphaComponent(0.24)
        shadow.shadowBlurRadius = 24
        shadow.shadowOffset = NSSize(width: 0, height: -12)
        shadow.set()
        color(0x242220).setFill()
        tile.fill()
        NSGraphicsContext.restoreGraphicsState()
        NSGradient(starting: color(0x353039), ending: color(0x191817))!.draw(in: tile, angle: -75)
        NSColor.white.withAlphaComponent(0.12).setStroke()
        tile.lineWidth = 3
        tile.stroke()
    }
    // Exact geometry from the existing animated transcription SVG (24 × 24).
    let mark = NSBezierPath()
    let scale: CGFloat = template ? 48 : 34
    let inset = (1024 - 24 * scale) / 2
    // Preserve the envelope at tiny sizes without merging subpixel strokes.
    let bars = (template || size <= 32) ? stride(from: 0, to: iconBars.count, by: 2).map { i in
        let bar = iconBars[i]
        return (bar.0 - 0.25, bar.1, CGFloat(1.2), bar.3)
    } : iconBars
    for (x, y, width, height) in bars {
        mark.append(roundRect(NSRect(
            x: inset + x * scale,
            y: 1024 - inset - (y + height) * scale,
            width: width * scale, height: height * scale
        ), min(width / 2, 0.6) * scale))
    }
    if template {
        NSColor.black.setFill()
        mark.fill()
    } else {
        NSGradient(colors: [color(0xE8B86D), color(0xEE9685), color(0xA5A7F2)])!
            .draw(in: mark, angle: 0)
    }
    NSGraphicsContext.restoreGraphicsState()
    try rep.representation(using: .png, properties: [:])!.write(to: url)
}
try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
for size in [16, 32, 48, 128, 256, 512, 1024] {
    try draw(size: size, to: root.appendingPathComponent("icon\(size).png"))
}
let iconset = root.appendingPathComponent("AppIcon.iconset")
try FileManager.default.createDirectory(at: iconset, withIntermediateDirectories: true)
for size in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let suffix = scale == 1 ? "" : "@2x"
        try draw(size: size * scale, to: iconset.appendingPathComponent("icon_\(size)x\(size)\(suffix).png"))
    }
}
for scale in [1, 2] {
    let suffix = scale == 1 ? "" : "@2x"
    try draw(size: 22 * scale, to: root.appendingPathComponent("MenuBarTemplate\(suffix).png"), template: true)
}
print("Rendered TranscribeThem icons at every target size")
