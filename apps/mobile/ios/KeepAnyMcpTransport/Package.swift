// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "KeepAnyMcpTransport",
    platforms: [.iOS(.v15), .macOS(.v13)],
    products: [
        .library(name: "KeepAnyMcpTransport", targets: ["KeepAnyMcpTransport"]),
        .library(name: "KeepAnyMcpTransportCore", targets: ["KeepAnyMcpTransportCore"]),
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.5.3"),
        .package(url: "https://github.com/apple/swift-nio.git", exact: "2.104.0"),
        .package(url: "https://github.com/apple/swift-nio-ssl.git", exact: "2.37.5"),
        .package(url: "https://github.com/apple/swift-certificates.git", exact: "1.21.1"),
        .package(url: "https://github.com/apple/swift-crypto.git", exact: "5.0.3"),
        .package(url: "https://github.com/apple/swift-asn1.git", exact: "1.7.3"),
    ],
    targets: [
        .target(name: "KeepAnyMcpTransportCore", dependencies: [
            .product(name: "NIOCore", package: "swift-nio"),
            .product(name: "NIOPosix", package: "swift-nio"),
            .product(name: "NIOHTTP1", package: "swift-nio"),
            .product(name: "NIOSSL", package: "swift-nio-ssl"),
            .product(name: "X509", package: "swift-certificates"),
            .product(name: "Crypto", package: "swift-crypto"),
            .product(name: "SwiftASN1", package: "swift-asn1"),
        ]),
        .target(name: "KeepAnyMcpTransport", dependencies: [
            "KeepAnyMcpTransportCore",
            .product(name: "Capacitor", package: "capacitor-swift-pm", condition: .when(platforms: [.iOS])),
        ]),
        .testTarget(name: "KeepAnyMcpTransportCoreTests", dependencies: [
            "KeepAnyMcpTransportCore",
            .product(name: "NIOCore", package: "swift-nio"),
            .product(name: "NIOPosix", package: "swift-nio"),
            .product(name: "NIOHTTP1", package: "swift-nio"),
            .product(name: "NIOSSL", package: "swift-nio-ssl"),
            .product(name: "X509", package: "swift-certificates"),
            .product(name: "Crypto", package: "swift-crypto"),
        ]),
    ],
    swiftLanguageModes: [.v5]
)
