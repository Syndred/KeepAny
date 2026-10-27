import XCTest

final class KeepAnyUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    private func application(_ language: String) -> XCUIApplication {
        let app = XCUIApplication(bundleIdentifier: "io.github.syndred.keepany")
        app.launchArguments = ["-AppleLanguages", "(\(language))", "-AppleLocale", language == "en" ? "en_US" : "zh_CN"]
        return app
    }

    private func capture(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testEnglishProjectSurvivesApplicationTermination() {
        let app = application("en")
        app.launch()
        for label in ["Overview", "Assets", "Accounts", "Tasks", "More"] {
            let link = app.links[label].firstMatch
            XCTAssertTrue(link.waitForExistence(timeout: 30), "Missing navigation: \(label)")
            link.tap()
        }
        app.links["Assets"].firstMatch.tap()
        let addAsset = app.buttons["Add asset"].firstMatch
        XCTAssertTrue(addAsset.waitForExistence(timeout: 10))
        addAsset.tap()
        app.buttons["Continue"].firstMatch.tap()
        let name = app.textFields["Name"].firstMatch
        XCTAssertTrue(name.waitForExistence(timeout: 10))
        name.tap()
        name.typeText("iOS simulator persistence fixture")
        let done = app.toolbars.buttons["Done"].firstMatch
        if done.exists { done.tap() }
        let save = app.buttons["Save"].firstMatch
        for _ in 0..<8 { if save.isHittable { break }; app.swipeUp() }
        XCTAssertTrue(save.isHittable)
        save.tap()
        let project = app.links.matching(NSPredicate(format: "label CONTAINS %@", "iOS simulator persistence fixture")).firstMatch
        XCTAssertTrue(project.waitForExistence(timeout: 30))
        capture(app, "project-saved-en")
        app.terminate()
        app.launch()
        let assets = app.links["Assets"].firstMatch
        XCTAssertTrue(assets.waitForExistence(timeout: 30))
        assets.tap()
        XCTAssertTrue(project.waitForExistence(timeout: 30))
        capture(app, "project-reopened-en")
        app.terminate()
    }

    func testChineseNavigationUsesTheNativeLanguage() {
        let app = application("zh-Hans")
        app.launch()
        for label in ["概览", "资产", "账号", "待办", "更多"] {
            let link = app.links[label].firstMatch
            XCTAssertTrue(link.waitForExistence(timeout: 30), "Missing navigation: \(label)")
            link.tap()
        }
        capture(app, "navigation-zh")
        app.terminate()
    }
}
