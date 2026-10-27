// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "KeepAnyMetadata",
    platforms: [.iOS(.v15)],
    products: [.library(name: "KeepAnyMetadata", targets: ["KeepAnyMetadata"])],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.5.3"),
        .package(url: "https://github.com/swift-server/async-http-client.git", revision: "4c005f955e83f888d5616e579717a36d2dfc6301")
    ],
    targets: [
        .target(name: "KeepAnyMetadata", dependencies: [
            .product(name: "Capacitor", package: "capacitor-swift-pm"),
            .product(name: "AsyncHTTPClient", package: "async-http-client")
        ]),
        .testTarget(name: "KeepAnyMetadataTests", dependencies: ["KeepAnyMetadata"])
    ],
    swiftLanguageModes: [.v5]
)
