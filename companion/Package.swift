// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "WACompanion",
    platforms: [.macOS(.v14)],
    dependencies: [
        .package(url: "https://github.com/FluidInference/FluidAudio.git", exact: "0.18.0"),
    ],
    targets: [
        .target(name: "CompanionCore"),
        .executableTarget(
            name: "WACompanion",
            dependencies: [
                "CompanionCore",
                .product(name: "FluidAudio", package: "FluidAudio"),
            ]
        ),
        .testTarget(
            name: "CompanionCoreTests",
            dependencies: ["CompanionCore"]
        ),
    ]
)
