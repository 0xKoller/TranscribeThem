import SwiftUI

/// Semantic colors shared by the light and dark companion surfaces.
struct VoicePalette {
    let canvas: Color
    let surface: Color
    let text: Color
    let secondary: Color
    let accent: Color
    let jade: Color
    let blue: Color

    init(_ scheme: ColorScheme) {
        let dark = scheme == .dark
        canvas = Color(hex: dark ? 0x191817 : 0xF4F0E9)
        surface = Color(hex: dark ? 0x242220 : 0xFFFCF7)
        text = Color(hex: dark ? 0xF4F0E9 : 0x282320)
        secondary = Color(hex: dark ? 0xB6AEA3 : 0x696158)
        accent = Color(hex: dark ? 0xA5A7F2 : 0x6259A6)
        jade = Color(hex: dark ? 0x88BBAA : 0x386B59)
        blue = Color(hex: dark ? 0x8CAED6 : 0x45658F)
    }

    // Pastel backgrounds keep dark labels legible in both appearances.
    static let signature = LinearGradient(
        colors: [Color(hex: 0xE8B86D), Color(hex: 0xEE9685), Color(hex: 0xA5A7F2)],
        startPoint: .leading, endPoint: .trailing
    )
}

struct BrandIcon: View {
    var body: some View {
        if let url = Bundle.main.url(forResource: "AppIcon", withExtension: "icns"),
           let image = NSImage(contentsOf: url) {
            Image(nsImage: image).resizable().interpolation(.high).scaledToFit()
        } else {
            TranscriptionMark().fill(VoicePalette.signature)
        }
    }
}

private struct TranscriptionMark: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        let scale = min(rect.width, rect.height) / 24
        let origin = CGPoint(x: rect.midX - 12 * scale, y: rect.midY - 12 * scale)
        for (x, y, height) in [(2.05, 11.25, 1.5), (3.25, 10.5, 3), (4.45, 9.0, 6), (5.65, 7.0, 10), (6.85, 5.0, 14), (8.05, 6.0, 12), (9.25, 8.0, 8), (10.45, 10.0, 4), (11.65, 11.0, 2), (12.85, 10.5, 3), (14.05, 9.0, 6), (15.25, 7.0, 10), (16.45, 8.0, 8), (17.65, 9.5, 5), (18.85, 10.5, 3), (20.05, 11.0, 2), (21.25, 11.5, 1)] {
            path.addRoundedRect(in: CGRect(x: origin.x + x * scale, y: origin.y + y * scale,
                                          width: 0.7 * scale, height: height * scale),
                                cornerSize: CGSize(width: 0.35 * scale, height: 0.35 * scale))
        }
        return path
    }
}

private extension Color {
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: 1
        )
    }
}
