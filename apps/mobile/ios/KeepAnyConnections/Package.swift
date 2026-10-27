// swift-tools-version: 6.2
import PackageDescription
let package = Package(name: "KeepAnyConnections", platforms: [.iOS(.v15)], products: [.library(name: "KeepAnyConnections", targets: ["KeepAnyConnections"])], dependencies: [.package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.5.3")], targets: [.target(name: "KeepAnyConnections", dependencies: [.product(name: "Capacitor", package: "capacitor-swift-pm")])], swiftLanguageModes: [.v5])
