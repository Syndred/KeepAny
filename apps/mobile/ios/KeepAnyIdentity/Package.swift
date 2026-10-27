// swift-tools-version: 6.2
import PackageDescription
let package = Package(name: "KeepAnyIdentity", platforms: [.iOS(.v15)], products: [.library(name: "KeepAnyIdentity", targets: ["KeepAnyIdentity"])], dependencies: [.package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.5.3")], targets: [.target(name: "KeepAnyIdentity", dependencies: [.product(name: "Capacitor", package: "capacitor-swift-pm")])], swiftLanguageModes: [.v5])
