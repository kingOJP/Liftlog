// swift-tools-version:5.9
// LiftLogCore — the Swift port of the TypeScript engines in src/data/.
// Pure Foundation (+ SQLite3 from the SDK); no UI dependencies, so `swift test`
// covers everything on any Mac. Parity fixtures live in ../parity/fixtures and
// are generated from the TypeScript engines by `npm run parity:fixtures`.
import PackageDescription

let package = Package(
    name: "LiftLogCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "LiftLogCore", targets: ["LiftLogCore"]),
    ],
    targets: [
        .target(name: "LiftLogCore", path: "Sources/LiftLogCore"),
        .testTarget(
            name: "LiftLogCoreTests",
            dependencies: ["LiftLogCore"],
            path: "Tests/LiftLogCoreTests"
        ),
    ]
)
