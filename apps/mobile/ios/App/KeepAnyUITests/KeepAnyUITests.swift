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

    private func captureHierarchy(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(string: app.debugDescription)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func dismissInputToolbar(_ app: XCUIApplication) {
        for label in ["Done", "完成"] {
            let done = app.toolbars.buttons[label].firstMatch
            if done.exists && done.isHittable { done.tap(); return }
        }
    }

    private func tapReachable(_ element: XCUIElement, in app: XCUIApplication) {
        // WKWebView can report a scrolled-out HTML button as hittable even
        // when its synthesized tap lands on the fixed bottom navigation.
        let navigation = app.otherElements.matching(NSPredicate(
            format: "label BEGINSWITH %@ OR label BEGINSWITH %@", "Main navigation", "主要导航"
        )).firstMatch
        XCTAssertTrue(navigation.exists)
        func visibleAboveNavigation() -> Bool {
            let bounds = app.webViews.firstMatch.frame
            let frame = element.frame
            return element.isHittable && frame.width > 0 && frame.height > 0
                && frame.minX >= bounds.minX && frame.maxX <= bounds.maxX
                && frame.minY >= bounds.minY + 8
                && frame.maxY <= navigation.frame.minY - 8
        }
        for _ in 0..<8 { if visibleAboveNavigation() { break }; app.swipeUp() }
        capture(app, "before-reachable-\(element.label)")
        captureHierarchy(app, "before-reachable-\(element.label)")
        guard visibleAboveNavigation() else {
            XCTFail("The action must be visible above the fixed bottom navigation before tapping")
            return
        }
        element.tap()
    }

    private func verifyDatePicker(_ language: String, tasks: String, startDate: String) {
        let app = application(language)
        app.launch()
        defer { app.terminate() }
        let tasksLink = app.links[tasks].firstMatch
        XCTAssertTrue(tasksLink.waitForExistence(timeout: 30))
        tasksLink.tap()
        // The actual WKWebView AX tree exposes these HTML date inputs as
        // labelled Other elements (179x44), separate from their StaticText labels.
        let kinds: [XCUIElement.ElementType] = [.popUpButton, .datePicker, .textField, .button, .other]
        var control: XCUIElement?
        let reachable = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            control = kinds.lazy.flatMap { kind in
                app.webViews.descendants(matching: kind)
                    .matching(NSPredicate(format: "label BEGINSWITH %@", startDate))
                    .allElementsBoundByIndex
            }.first { $0.isHittable }
            return control != nil
        }, object: nil)
        let result = XCTWaiter.wait(for: [reachable], timeout: 10)
        captureHierarchy(app, "date-control-before-\(language)")
        XCTAssertEqual(result, .completed)
        guard let control else {
            XCTFail("No accessible, reachable native date control for \(startDate)")
            return
        }
        let bounds = app.webViews.firstMatch.frame
        XCTAssertGreaterThanOrEqual(control.frame.minX, bounds.minX - 1)
        XCTAssertLessThanOrEqual(control.frame.maxX, bounds.maxX + 1)
        control.tap()
        let picker = app.datePickers.firstMatch
        let presented = picker.waitForExistence(timeout: 10)
        capture(app, "native-date-picker-\(language)")
        captureHierarchy(app, "date-control-presented-\(language)")
        XCTAssertTrue(presented, "Tapping the actual date input must present a native date picker")
    }

    func testEnglishDateInputPresentsNativePicker() {
        verifyDatePicker("en", tasks: "Tasks", startDate: "Start date")
    }

    func testChineseDateInputPresentsNativePicker() {
        verifyDatePicker("zh-Hans", tasks: "待办", startDate: "开始日期")
    }

    func testOrdinaryTaskValidationColdStartCompletionAndDeleteCancellation() {
        for chinese in [false, true] {
            let language = chinese ? "zh-Hans" : "en"
            let app = application(language)
            let fixture = "iOS ordinary task fixture \(language)"
            let tasks = chinese ? "待办" : "Tasks"
            let create = chinese ? "新建待办" : "New task"
            let save = chinese ? "保存" : "Save"
            let cancel = chinese ? "取消" : "Cancel"
            let nameLabel = chinese ? "名称" : "Name"
            let taskName = app.staticTexts[fixture].firstMatch
            app.launch()
            let navigation = app.links[tasks].firstMatch
            XCTAssertTrue(navigation.waitForExistence(timeout: 30))
            navigation.tap()
            let addTask = app.buttons[create].firstMatch
            XCTAssertTrue(addTask.waitForExistence(timeout: 10))
            addTask.tap()
            app.buttons[save].firstMatch.tap()
            XCTAssertTrue(app.staticTexts[chinese ? "此项不能为空" : "This field is required"].firstMatch.waitForExistence(timeout: 10))
            let name = app.textFields[nameLabel].firstMatch
            name.tap()
            name.typeText(fixture)
            dismissInputToolbar(app)
            app.buttons[cancel].firstMatch.tap()
            XCTAssertFalse(taskName.exists, "Cancelling a new task must not create it")
            addTask.tap()
            XCTAssertTrue(name.waitForExistence(timeout: 10))
            name.tap()
            name.typeText(fixture)
            dismissInputToolbar(app)
            let saveTask = app.buttons[save].firstMatch
            for _ in 0..<6 { if saveTask.isHittable { break }; app.swipeUp() }
            XCTAssertTrue(saveTask.isHittable)
            saveTask.tap()
            XCTAssertTrue(taskName.waitForExistence(timeout: 15))
            capture(app, "task-created-\(language)")
            app.terminate()
            app.launch()
            XCTAssertTrue(navigation.waitForExistence(timeout: 30))
            navigation.tap()
            XCTAssertTrue(taskName.waitForExistence(timeout: 15))
            tapReachable(app.buttons[chinese ? "完成" : "Complete"].firstMatch, in: app)
            let completed = app.switches.matching(NSPredicate(format: "label BEGINSWITH %@", chinese ? "已完成 ·" : "Completed ·")).firstMatch
            XCTAssertTrue(completed.waitForExistence(timeout: 10))
            completed.tap()
            XCTAssertTrue(taskName.waitForExistence(timeout: 10))
            tapReachable(app.buttons[chinese ? "重新打开" : "Reopen"].firstMatch, in: app)
            app.switches.matching(NSPredicate(format: "label BEGINSWITH %@", chinese ? "待处理 ·" : "Pending ·")).firstMatch.tap()
            XCTAssertTrue(taskName.waitForExistence(timeout: 10))
            let delete = app.buttons[chinese ? "删除" : "Delete"].firstMatch
            tapReachable(delete, in: app)
            XCTAssertTrue(app.staticTexts[chinese ? "删除待办" : "Delete task"].firstMatch.waitForExistence(timeout: 10))
            app.buttons[cancel].firstMatch.tap()
            XCTAssertTrue(taskName.exists)
            tapReachable(delete, in: app)
            guard let confirm = app.buttons.matching(NSPredicate(format: "label == %@", chinese ? "删除" : "Delete"))
                .allElementsBoundByIndex.last(where: { $0.isHittable }) else {
                XCTFail("Delete confirmation must have a reachable action")
                app.terminate()
                return
            }
            confirm.tap()
            XCTAssertTrue(taskName.waitForNonExistence(timeout: 15))
            capture(app, "task-deleted-\(language)")
            captureHierarchy(app, "task-final-\(language)")
            app.terminate()
        }
    }

    func testEnglishProjectSurvivesApplicationTermination() {
        let app = application("en")
        app.launch()
        for label in ["Overview", "Assets", "Accounts", "Tasks", "More"] {
            let link = app.links[label].firstMatch
            XCTAssertTrue(link.waitForExistence(timeout: 30), "Missing navigation: \(label)")
            link.tap()
            capture(app, "navigation-\(label)")
            let bounds = app.webViews.firstMatch.frame
            for field in app.webViews.descendants(matching: .textField).allElementsBoundByIndex where field.isHittable {
                XCTAssertGreaterThanOrEqual(field.frame.minX, bounds.minX - 1)
                XCTAssertLessThanOrEqual(field.frame.maxX, bounds.maxX + 1)
            }
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
        XCTAssertEqual(name.value as? String, "iOS simulator persistence fixture")
        let done = app.toolbars.buttons["Done"].firstMatch
        if done.exists { done.tap() }
        let save = app.buttons["Save"].firstMatch
        for _ in 0..<8 { if save.isHittable { break }; app.swipeUp() }
        XCTAssertTrue(save.isHittable)
        capture(app, "before-project-save-en")
        save.tap()
        let project = app.links.matching(NSPredicate(format: "label CONTAINS %@", "iOS simulator persistence fixture")).firstMatch
        let visibleBeforeTermination = project.waitForExistence(timeout: 15)
        capture(app, "project-save-result-en")
        let hierarchy = XCTAttachment(string: app.debugDescription)
        hierarchy.name = "project-save-result-hierarchy"
        hierarchy.lifetime = .keepAlways
        add(hierarchy)
        app.terminate()
        app.launch()
        let assets = app.links["Assets"].firstMatch
        XCTAssertTrue(assets.waitForExistence(timeout: 30))
        assets.tap()
        let visibleAfterTermination = project.waitForExistence(timeout: 30)
        capture(app, "project-reopened-en")
        XCTAssertTrue(visibleBeforeTermination && visibleAfterTermination,
                      "Project visible immediately: \(visibleBeforeTermination); after termination: \(visibleAfterTermination)")
        for _ in 0..<8 { if project.isHittable { break }; app.swipeUp() }
        XCTAssertTrue(project.isHittable, "Persisted project must be reachable by scrolling")
        project.tap()
        XCTAssertTrue(app.buttons["Edit"].firstMatch.waitForExistence(timeout: 10))
        capture(app, "persisted-project-detail-en")
        app.terminate()
    }

    func testChineseNavigationUsesTheNativeLanguage() {
        let app = application("zh-Hans")
        app.launch()
        for label in ["概览", "资产", "账号", "待办", "更多"] {
            let link = app.links[label].firstMatch
            XCTAssertTrue(link.waitForExistence(timeout: 30), "Missing navigation: \(label)")
            link.tap()
            capture(app, "navigation-\(label)")
            let bounds = app.webViews.firstMatch.frame
            for field in app.webViews.descendants(matching: .textField).allElementsBoundByIndex where field.isHittable {
                XCTAssertGreaterThanOrEqual(field.frame.minX, bounds.minX - 1)
                XCTAssertLessThanOrEqual(field.frame.maxX, bounds.maxX + 1)
            }
        }
        capture(app, "navigation-zh")
        app.terminate()
    }
}
