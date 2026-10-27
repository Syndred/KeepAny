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
        // 544 exposed both a full-card composite link and exact-name inner
        // links. The composite crosses the fixed navigation and can throw
        // Activation point invalid even while its inner title is reachable.
        let project = app.links.matching(NSPredicate(format: "label == %@", "iOS simulator persistence fixture")).firstMatch
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
        reachProjectControl(project, in: app)
        capture(app, "persisted-project-before-open-en")
        captureHierarchy(app, "persisted-project-before-open-en-AX")
        XCTAssertTrue(project.isHittable, "Persisted project must be reachable by scrolling")
        tapProjectControl(project, in: app)
        XCTAssertTrue(app.buttons["Edit"].firstMatch.waitForExistence(timeout: 10))
        capture(app, "persisted-project-detail-en")
        app.terminate()
    }

    // This slice covers the actual project editor's text fields. Dates, media,
    // domains and related records require separate native picker/workflow cases.
    private struct ProjectTextField {
        let key: String
        let label: String
        let value: String
        let multiline: Bool
        let group: String?
    }

    private var projectNavigationTop: CGFloat?
    private var projectLinkAXValue: String?
    private var projectOriginalID: String?

    private func projectRecordID(_ value: String?) -> String? {
        value.flatMap { URL(string: $0)?.lastPathComponent }
            .flatMap { UUID(uuidString: $0)?.uuidString.lowercased() }
    }

    private func projectDialog(in app: XCUIApplication) -> XCUIElement? {
        app.webViews.firstMatch.descendants(matching: .other)
            .matching(NSPredicate(format: "label ENDSWITH %@", ", web dialog"))
            .allElementsBoundByIndex.last { $0.frame.width > 0 && $0.frame.height > 0 }
    }

    private func isProjectFooterAction(_ element: XCUIElement) -> Bool {
        element.elementType == .button && ["Save", "Cancel", "保存", "取消"].contains(element.label)
    }

    private func projectVisibleBounds(for element: XCUIElement, in app: XCUIApplication) -> CGRect? {
        let web = app.webViews.firstMatch.frame
        let keyboard = app.keyboards.firstMatch
        if let dialog = projectDialog(in: app) {
            // A modal is above the underlying navigation. Use its actual AX
            // rectangle, not the cached boundary of that hidden underlay.
            var bounds = dialog.frame.intersection(web).insetBy(dx: 1, dy: 8)
            let footerLabels = ["Save", "Cancel", "保存", "取消"]
            if !isProjectFooterAction(element) {
                let footer = dialog.descendants(matching: .button)
                    .matching(NSPredicate(format: "label IN %@", footerLabels))
                    .allElementsBoundByIndex.map { $0.frame }
                    .filter { $0.width > 0 && $0.height > 0 && bounds.intersects($0) }
                if let footerTop = footer.map({ $0.minY }).min() {
                    // The existing sticky footer has 12pt top padding. Body
                    // fields must be above it, even when AX says hittable.
                    bounds.size.height = max(0, min(bounds.maxY, footerTop - 12) - bounds.minY)
                }
            }
            if keyboard.exists {
                bounds.size.height = max(0, min(bounds.maxY, keyboard.frame.minY - 8) - bounds.minY)
            }
            return bounds
        }
        guard let navigationTop = projectNavigationTop else { return nil }
        let bottom = keyboard.exists ? min(navigationTop, keyboard.frame.minY) : navigationTop
        return CGRect(x: web.minX, y: web.minY + 8, width: web.width,
                      height: max(0, bottom - 8 - (web.minY + 8)))
    }

    private func reachProjectControl(_ element: XCUIElement, in app: XCUIApplication) {
        dismissInputToolbar(app)
        let web = app.webViews.firstMatch
        let navigation = app.otherElements.matching(NSPredicate(
            format: "label BEGINSWITH %@ OR label BEGINSWITH %@", "Main navigation", "主要导航"
        )).firstMatch
        if projectDialog(in: app) == nil && navigation.exists {
            projectNavigationTop = navigation.frame.minY
        }
        for attempt in 0..<18 {
            let frame = element.frame
            guard let bounds = projectVisibleBounds(for: element, in: app) else {
                XCTFail("Measure the actual fixed navigation before using a page control")
                return
            }
            // The original helper rejected a visibly unobstructed modal Save.
            // Its log did not separate the navigation and hittability gates.
            // Permit a bounded coordinate tap only for modal footer actions;
            // body and page controls still require native hittability.
            if element.exists && frame.width > 0 && frame.height > 0 && bounds.contains(frame)
                && (element.isHittable || (isProjectFooterAction(element) && projectDialog(in: app) != nil)) { return }
            // Scroll the dialog in either direction; edits reopen at the top,
            // whereas verification and cancellation start deep in the form.
            let down = frame.height > 0 ? frame.minY < bounds.minY : attempt >= 9
            let start = app.coordinate(withNormalizedOffset: .zero).withOffset(
                CGVector(dx: bounds.midX, dy: bounds.minY + bounds.height * (down ? 0.3 : 0.7)))
            let end = app.coordinate(withNormalizedOffset: .zero).withOffset(
                CGVector(dx: bounds.midX, dy: bounds.minY + bounds.height * (down ? 0.7 : 0.3)))
            start.press(forDuration: 0.05, thenDragTo: end)
        }
        capture(app, "project-control-unreachable-\(element.label)")
        captureHierarchy(app, "project-control-unreachable-\(element.label)")
        let keyboardDescription = app.keyboards.firstMatch.exists ? String(describing: app.keyboards.firstMatch.frame) : "absent"
        let geometry = XCTAttachment(string: "element=\(element.frame); hittable=\(element.isHittable); web=\(web.frame); dialog=\(String(describing: projectDialog(in: app)?.frame)); bounds=\(String(describing: projectVisibleBounds(for: element, in: app))); navigationTop=\(String(describing: projectNavigationTop)); keyboard=\(keyboardDescription)")
        geometry.name = "project-control-unreachable-geometry"
        geometry.lifetime = .keepAlways
        add(geometry)
        XCTFail("Project control must be fully visible in its current layer, above keyboard and sticky footer: \(element.label)")
    }

    private func tapProjectControl(_ element: XCUIElement, in app: XCUIApplication) {
        reachProjectControl(element, in: app)
        guard let bounds = projectVisibleBounds(for: element, in: app),
              element.exists, element.isEnabled, element.frame.width > 0, element.frame.height > 0,
              bounds.contains(element.frame) else {
            XCTFail("Refuse to tap a hidden, covered or disabled project control: \(element.label)")
            return
        }
        if element.isHittable { element.tap() }
        else if isProjectFooterAction(element), let dialog = projectDialog(in: app),
                dialog.descendants(matching: .button).matching(NSPredicate(format: "label == %@", element.label))
                    .allElementsBoundByIndex.contains(where: { $0.frame == element.frame }) {
            // The real native pointer stays within the validated visible rect;
            // the following business assertions must still prove its effect.
            app.coordinate(withNormalizedOffset: .zero).withOffset(
                CGVector(dx: element.frame.midX, dy: element.frame.midY)).tap()
        } else { XCTFail("A page control must be natively hittable") }
    }

    private func projectTextControl(_ field: ProjectTextField, in app: XCUIApplication) -> XCUIElement {
        let control = field.multiline ? app.textViews[field.label].firstMatch : app.textFields[field.label].firstMatch
        if !control.exists, let group = field.group {
            let button = app.buttons[group].firstMatch
            let summary = button.exists ? button : app.staticTexts[group].firstMatch
            XCTAssertTrue(summary.waitForExistence(timeout: 5), "Missing project editor group: \(group)")
            tapProjectControl(summary, in: app)
        }
        XCTAssertTrue(control.waitForExistence(timeout: 5), "Missing labelled project field: \(field.label)")
        return control
    }

    private func replaceProjectText(_ control: XCUIElement, with value: String, in app: XCUIApplication) {
        tapProjectControl(control, in: app)
        let existing = control.value as? String ?? ""
        if !existing.isEmpty {
            // A tap can place the caret in the middle of a long value. Use
            // the real edit menu rather than assuming backspace starts at end.
            control.press(forDuration: 1.1)
            let all = NSPredicate(format: "label == %@ OR label == %@", "Select All", "全选")
            let menuItem = app.menuItems.matching(all).firstMatch
            let button = app.buttons.matching(all).firstMatch
            let selectAll = menuItem.waitForExistence(timeout: 2) ? menuItem : button
            guard selectAll.waitForExistence(timeout: 2) && selectAll.isHittable else {
                captureHierarchy(app, "project-select-all-unavailable-\(control.label)")
                XCTFail("Native text replacement requires a reachable Select All action")
                return
            }
            selectAll.tap()
            control.typeText(XCUIKeyboardKey.delete.rawValue)
            let cleared = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", ""), object: control)
            if XCTWaiter.wait(for: [cleared], timeout: 10) != .completed {
                capture(app, "project-text-clear-incomplete")
                captureHierarchy(app, "project-text-clear-incomplete-AX")
            }
            XCTAssertEqual(control.value as? String ?? "", "", "Replacement must clear the complete original value")
        }
        control.typeText(value)
        // typeText can return while WKWebView is still receiving the native
        // keyboard events. Never save a partial value or type a second copy.
        let typed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", value), object: control)
        if XCTWaiter.wait(for: [typed], timeout: 20) != .completed {
            capture(app, "project-text-input-incomplete")
            captureHierarchy(app, "project-text-input-incomplete-AX")
        }
        XCTAssertEqual(control.value as? String, value)
        dismissInputToolbar(app)
    }

    private func existingProjectCategoryControl(in app: XCUIApplication, label: String) -> XCUIElement? {
        let predicate = NSPredicate(format: "label BEGINSWITH %@", label)
        let combo = app.comboBoxes.matching(predicate).firstMatch
        let popup = app.popUpButtons.matching(predicate).firstMatch
        let button = app.buttons.matching(predicate).firstMatch
        // iOS 26 WKWebView exposes the actual labelled combobox as Other with
        // a value, distinct from the wrapper Other whose value is nil. Its AX
        // frame is wrong, so read its semantics but activate the HTML label.
        let other = app.webViews.firstMatch.descendants(matching: .other).matching(
            NSPredicate(format: "label == %@ AND value != nil", label)).firstMatch
        return [combo, popup, other, button].first { $0.exists }
    }

    private func projectCategoryControl(in app: XCUIApplication, label: String) -> XCUIElement {
        var control: XCUIElement?
        // Re-resolve the semantic select after a dialog/picker transition;
        // native tap completion does not prove React/AX has updated its value.
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            control = self.existingProjectCategoryControl(in: app, label: label)
            return control != nil
        }, object: nil)
        if XCTWaiter.wait(for: [ready], timeout: 10) != .completed {
            capture(app, "project-category-control-missing")
            captureHierarchy(app, "project-category-control-missing-AX")
        }
        XCTAssertNotNil(control, "Project category must expose an accessible select control")
        return control ?? app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", label)).firstMatch
    }

    private func verifyProjectTextFields(_ fields: [ProjectTextField], in app: XCUIApplication,
                                         phase: String, language: String, marker: String,
                                         category: String, categoryLabel: String) throws {
        var observed: [String: String] = [:]
        for field in fields {
            let control = projectTextControl(field, in: app)
            reachProjectControl(control, in: app)
            observed[field.key] = control.value as? String ?? "<missing AX value>"
            XCTAssertEqual(observed[field.key], field.value, "\(phase): \(field.key)")
        }
        let select = projectCategoryControl(in: app, label: categoryLabel)
        reachProjectControl(app.staticTexts[categoryLabel].firstMatch, in: app)
        let categoryAX = "\(select.label) \(select.value as? String ?? "")"
        XCTAssertTrue(categoryAX.contains(category), "\(phase): non-default category retained: \(categoryAX)")
        var expectedPayload: [String: Any] = Dictionary(uniqueKeysWithValues: fields.map { ($0.key, $0.value as Any) })
        expectedPayload["tags"] = ["iosfull", "synthetic"]
        expectedPayload["category"] = "repository"
        expectedPayload["kind"] = "project"
        expectedPayload["projectLaunchMonth"] = ""
        expectedPayload["projectInspectionDate"] = ""
        let linkID = projectRecordID(projectLinkAXValue)
        if let originalID = projectOriginalID { XCTAssertEqual(linkID, originalID, "Project ID must survive cancellation and rename") }
        let manifest: [String: Any] = [
            "language": language, "phase": phase, "marker": marker,
            "expectedPayloadFields": expectedPayload,
            "observedAX": observed, "expectedCategory": "repository", "categoryAX": categoryAX,
            "projectLinkAXValue": projectLinkAXValue as Any? ?? NSNull(),
            "recordId": linkID as Any? ?? NSNull(),
            "initialRecordId": projectOriginalID as Any? ?? NSNull(),
            "nativeSQLiteSameIDAndPayload": "PENDING: compare this marker with native SQLite artifact; AX is not database proof"
        ]
        let attachment = XCTAttachment(data: try JSONSerialization.data(withJSONObject: manifest, options: [.prettyPrinted, .sortedKeys]),
                                       uniformTypeIdentifier: "public.json")
        attachment.name = "project-text-fields-\(language)-\(phase).json"
        attachment.lifetime = .keepAlways
        add(attachment)
        capture(app, "project-text-fields-\(language)-\(phase)")
        captureHierarchy(app, "project-text-fields-\(language)-\(phase)-AX")
    }

    private func verifyProjectTextFieldsColdStart(_ chinese: Bool) throws {
        let language = chinese ? "zh-Hans" : "en"
        func text(_ zh: String, _ en: String) -> String { chinese ? zh : en }
        let app = application(language)
        projectNavigationTop = nil
        projectLinkAXValue = nil
        projectOriginalID = nil
        let marker = "iOS simulator persistence fixture full-fields \(language) \(UUID().uuidString.prefix(8))"
        let categoryLabel = text("分类", "Category")
        let category = text("仓库", "Repositories")
        let intro = text("介绍与定价", "Introduction and pricing")
        let contact = text("联系方式", "Contact details")
        var fields = [
            ProjectTextField(key: "name", label: text("名称", "Name"), value: marker, multiline: false, group: nil),
            ProjectTextField(key: "url", label: text("网址", "URL"), value: "https://ios-full.example.test/\(language)", multiline: false, group: nil),
            ProjectTextField(key: "contact", label: text("联系方式", "Contact"), value: "Synthetic contact \(language)", multiline: false, group: nil),
            ProjectTextField(key: "description", label: text("简短描述", "Short description"), value: "Synthetic short \(language)", multiline: false, group: nil),
            ProjectTextField(key: "projectTitle", label: text("产品标题", "Product title"), value: "Synthetic product \(language)", multiline: false, group: nil),
            ProjectTextField(key: "projectPromoUrl", label: text("推广链接", "Promotional link"), value: "https://ios-full.example.test/promo/\(language)", multiline: false, group: nil),
            ProjectTextField(key: "tags", label: text("标签（逗号分隔）", "Tags (comma separated)"), value: "iosfull, synthetic", multiline: false, group: nil),
            ProjectTextField(key: "projectMediumDescription", label: text("中篇介绍", "Medium description"), value: "Synthetic medium \(language)\nSecond medium line", multiline: true, group: intro),
            ProjectTextField(key: "longDescription", label: text("完整介绍", "Full description"), value: "Synthetic full \(language)\nSecond full line", multiline: true, group: intro),
            ProjectTextField(key: "projectFeatures", label: text("功能介绍", "Features"), value: "Synthetic feature A\nSynthetic feature B", multiline: true, group: intro),
            ProjectTextField(key: "projectPricing", label: text("定价说明", "Pricing details"), value: "Synthetic free tier\nSynthetic paid tier", multiline: true, group: intro),
            ProjectTextField(key: "projectPricingType", label: text("定价类型", "Pricing type"), value: "Synthetic freemium", multiline: false, group: intro),
            ProjectTextField(key: "projectEmail", label: text("商务邮箱", "Business email"), value: "ios-full-\(language.lowercased())@example.test", multiline: false, group: contact),
            ProjectTextField(key: "notes", label: text("内部备注", "Internal notes"), value: "Synthetic internal \(language)\nRetain after rename", multiline: true, group: contact)
        ]
        app.launch()
        defer { app.terminate() }
        let assets = app.links[text("资产", "Assets")].firstMatch
        XCTAssertTrue(assets.waitForExistence(timeout: 30))
        assets.tap()
        let addAsset = app.buttons[text("新增资产", "Add asset")].firstMatch
        tapProjectControl(addAsset, in: app)
        app.buttons[text("继续", "Continue")].firstMatch.tap()
        let select = projectCategoryControl(in: app, label: categoryLabel)
        XCTAssertTrue(select.exists)
        // The associated visible HTML label activates the genuine select via
        // normal native touch, avoiding the erroneous Other AX rectangle.
        tapProjectControl(app.staticTexts[categoryLabel].firstMatch, in: app)
        var option: XCUIElement?
        let optionsReady = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            option = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", category))
                .allElementsBoundByIndex.first { $0.isHittable }
            return option != nil
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [optionsReady], timeout: 10), .completed)
        guard let option else { XCTFail("Non-default category option must be accessible"); return }
        option.tap()
        let selectionUpdated = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            guard let current = self.existingProjectCategoryControl(in: app, label: categoryLabel) else { return false }
            return "\(current.label) \(current.value as? String ?? "")".contains(category)
        }, object: nil)
        let selectionResult = XCTWaiter.wait(for: [selectionUpdated], timeout: 10)
        let selectedControl = existingProjectCategoryControl(in: app, label: categoryLabel)
        let selectedAX = selectedControl.map { "\($0.label) \($0.value as? String ?? "")" } ?? "<missing semantic control>"
        // 544 stopped before retaining the post-selection tree. Keep both
        // success and failure observations; never retap or accept a raw slug.
        capture(app, "project-category-after-selection-\(language)")
        captureHierarchy(app, "project-category-after-selection-\(language)-AX")
        let categoryEvidence: [String: Any] = ["language": language, "expectedVisibleCategory": category,
                                              "observedCategoryAX": selectedAX, "settled": selectionResult == .completed]
        let categoryAttachment = XCTAttachment(data: try JSONSerialization.data(withJSONObject: categoryEvidence, options: [.prettyPrinted, .sortedKeys]), uniformTypeIdentifier: "public.json")
        categoryAttachment.name = "project-category-after-selection-\(language).json"
        categoryAttachment.lifetime = .keepAlways
        add(categoryAttachment)
        XCTAssertEqual(selectionResult, .completed, "The selected category must reach the genuine semantic control: \(selectedAX)")
        XCTAssertTrue(selectedAX.contains(category), "Non-default category must actually be selected")
        for field in fields { replaceProjectText(projectTextControl(field, in: app), with: field.value, in: app) }
        try verifyProjectTextFields(fields, in: app, phase: "before-save", language: language, marker: marker, category: category, categoryLabel: categoryLabel)
        let save = app.buttons[text("保存", "Save")].firstMatch
        tapProjectControl(save, in: app)
        let project = app.links.matching(NSPredicate(format: "label == %@", marker)).firstMatch
        XCTAssertTrue(project.waitForExistence(timeout: 20))
        projectLinkAXValue = project.value as? String
        projectOriginalID = projectRecordID(projectLinkAXValue)
        capture(app, "project-text-fields-\(language)-saved")
        app.terminate()
        app.launch()
        XCTAssertTrue(assets.waitForExistence(timeout: 30))
        assets.tap()
        XCTAssertTrue(project.waitForExistence(timeout: 20))
        projectLinkAXValue = project.value as? String
        reachProjectControl(project, in: app)
        captureHierarchy(app, "project-text-fields-\(language)-cold-start-link")
        tapProjectControl(project, in: app)
        let edit = app.buttons[text("编辑", "Edit")].firstMatch
        XCTAssertTrue(edit.waitForExistence(timeout: 10))
        capture(app, "project-text-fields-\(language)-cold-start-detail")
        let materials = app.buttons[text("查看投递素材", "View submission materials")].firstMatch
        tapProjectControl(materials, in: app)
        // Verify actual detail content, then editor values; neither replaces
        // the subsequent native SQLite ID/payload comparison in CI evidence.
        for field in fields where field.multiline || field.key == "projectTitle" || field.key == "projectEmail" {
            let firstLine = field.value.components(separatedBy: "\n")[0]
            let value = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", firstLine)).firstMatch
            XCTAssertTrue(value.waitForExistence(timeout: 5), "Missing saved submission material: \(field.key)")
            XCTAssertEqual(value.label.split(whereSeparator: { $0.isWhitespace }).joined(separator: " "),
                           field.value.split(whereSeparator: { $0.isWhitespace }).joined(separator: " "),
                           "Detail must retain the complete material: \(field.key)")
            reachProjectControl(value, in: app)
        }
        capture(app, "project-text-fields-\(language)-materials")
        captureHierarchy(app, "project-text-fields-\(language)-materials-AX")
        tapProjectControl(edit, in: app)
        try verifyProjectTextFields(fields, in: app, phase: "cold-start-edit", language: language, marker: marker, category: category, categoryLabel: categoryLabel)
        for key in ["name", "projectMediumDescription", "notes"] {
            let field = fields.first { $0.key == key }!
            replaceProjectText(projectTextControl(field, in: app), with: "Cancelled \(key)", in: app)
        }
        let cancel = app.buttons[text("取消", "Cancel")].firstMatch
        tapProjectControl(cancel, in: app)
        XCTAssertTrue(edit.waitForExistence(timeout: 10))
        tapProjectControl(edit, in: app)
        try verifyProjectTextFields(fields, in: app, phase: "after-cancel", language: language, marker: marker, category: category, categoryLabel: categoryLabel)
        let originalName = fields.removeFirst()
        let renamed = ProjectTextField(key: "name", label: originalName.label, value: marker + " renamed", multiline: false, group: nil)
        fields.insert(renamed, at: 0)
        replaceProjectText(projectTextControl(renamed, in: app), with: renamed.value, in: app)
        tapProjectControl(save, in: app)
        XCTAssertTrue(edit.waitForExistence(timeout: 10))
        app.terminate()
        app.launch()
        XCTAssertTrue(assets.waitForExistence(timeout: 30))
        assets.tap()
        let renamedProject = app.links.matching(NSPredicate(format: "label == %@", renamed.value)).firstMatch
        XCTAssertTrue(renamedProject.waitForExistence(timeout: 20))
        projectLinkAXValue = renamedProject.value as? String
        tapProjectControl(renamedProject, in: app)
        XCTAssertTrue(edit.waitForExistence(timeout: 10))
        tapProjectControl(edit, in: app)
        try verifyProjectTextFields(fields, in: app, phase: "renamed-cold-start", language: language, marker: marker, category: category, categoryLabel: categoryLabel)
        tapProjectControl(cancel, in: app)
    }

    func testEnglishProjectTextFieldsSurviveColdStartCancelAndRename() throws {
        try verifyProjectTextFieldsColdStart(false)
    }

    func testChineseProjectTextFieldsSurviveColdStartCancelAndRename() throws {
        try verifyProjectTextFieldsColdStart(true)
    }

    // Native bridge smoke test: real authority initialization and transport
    // preparation only. It deliberately never opens export or activates TLS IO.
    private func mcpCheckboxes(in app: XCUIApplication) -> [XCUIElement] {
        let checkboxes = app.webViews.firstMatch.descendants(matching: .checkBox).allElementsBoundByIndex
        if !checkboxes.isEmpty { return checkboxes }
        let switches = app.webViews.firstMatch.descendants(matching: .switch).allElementsBoundByIndex
        XCTAssertFalse(switches.isEmpty, "The actual MCP scope must expose native-accessible checkbox controls")
        return switches
    }

    private func mcpCheckboxIsChecked(_ control: XCUIElement) -> Bool {
        if let value = control.value as? String {
            switch value.lowercased() {
            case "1", "checked", "on": return true
            case "0", "unchecked", "off": return false
            default: break
            }
        } else if let value = control.value as? NSNumber { return value.boolValue }
        XCTFail("MCP checkbox must expose an unambiguous checked value: \(control.label)")
        return false
    }

    func testEnglishNativeMcpPreparesAndExplicitlyStopsWithoutExportOrGrant() throws {
        let app = application("en")
        let marker = "iOS MCP prepare fixture \(UUID().uuidString.prefix(8))"
        let readyText = "The pairing file is ready. Export it through the system, then start waiting for your computer. The ticket expires in two minutes."
        projectNavigationTop = nil
        app.launch()
        defer { app.terminate() }
        let assets = app.links["Assets"].firstMatch
        XCTAssertTrue(assets.waitForExistence(timeout: 30))
        assets.tap()
        let addAsset = app.buttons["Add asset"].firstMatch
        tapProjectControl(addAsset, in: app)
        app.buttons["Continue"].firstMatch.tap()
        let name = app.textFields["Name"].firstMatch
        XCTAssertTrue(name.waitForExistence(timeout: 10))
        replaceProjectText(name, with: marker, in: app)
        let save = app.buttons["Save"].firstMatch
        tapProjectControl(save, in: app)
        let project = app.links.matching(NSPredicate(format: "label CONTAINS %@", marker)).firstMatch
        XCTAssertTrue(project.waitForExistence(timeout: 20), "The isolated project must be saved through the actual UI before selecting scope")
        capture(app, "ios-mcp-prepare-en-project-created")

        app.links["More"].firstMatch.tap()
        let access = app.links.matching(NSPredicate(format: "label BEGINSWITH %@", "Assistant access")).firstMatch
        XCTAssertTrue(access.waitForExistence(timeout: 10))
        tapProjectControl(access, in: app)
        let noConnection = app.staticTexts["No active local connection"].firstMatch
        XCTAssertTrue(noConnection.waitForExistence(timeout: 10))
        capture(app, "ios-mcp-prepare-en-no-initial-grant")
        let configure = app.links["Configure local access"].firstMatch
        tapProjectControl(configure, in: app)
        // 544 AX includes the associated hint in this field's accessible name.
        let addressControls = app.textFields.matching(NSPredicate(format: "label BEGINSWITH %@", "This device’s private IPv4 address"))
        let address = addressControls.firstMatch
        let nativeControlsAvailable = address.waitForExistence(timeout: 15)
        capture(app, "ios-mcp-prepare-en-settings-before-scope")
        captureHierarchy(app, "ios-mcp-prepare-en-settings-before-scope-AX")
        XCTAssertTrue(nativeControlsAvailable, "The real native MCP controls must be available; unsupported is a failure")
        XCTAssertEqual(addressControls.count, 1, "The actual labelled native address field must be unambiguous")
        let stateUnavailable = app.staticTexts["Access status could not be confirmed. Try again, or stop the connection."].firstMatch
        let initialStatus = XCTAttachment(string: "nativeStateUnavailablePresentInAX=\(stateUnavailable.exists); locatorMatches=\(addressControls.count); prepare/ready/stop contract remains required")
        initialStatus.name = "ios-mcp-prepare-en-initial-state-diagnostic"
        initialStatus.lifetime = .keepAlways
        add(initialStatus)
        let selected = mcpCheckboxes(in: app).filter { $0.label == marker }
        XCTAssertEqual(selected.count, 1, "Only the newly created synthetic project can be the selected scope")
        guard let selected = selected.first else { return }
        XCTAssertFalse(mcpCheckboxIsChecked(selected))
        tapProjectControl(selected, in: app)
        XCTAssertTrue(mcpCheckboxIsChecked(selected))
        replaceProjectText(address, with: "127.0.0.1", in: app)

        let fieldLabels = ["Type", "Name", "Category", "Tags", "Short description", "URL", "Status", "Next date"]
        let editableLabels = ["Name", "Category", "Tags", "Short description", "URL"]
        let allCheckboxes = mcpCheckboxes(in: app)
        for label in fieldLabels {
            let controls = allCheckboxes.filter { $0.label == label }
            XCTAssertEqual(controls.count, editableLabels.contains(label) ? 2 : 1, "Both real read and edit controls must be accounted for: \(label)")
            for (index, control) in controls.enumerated() {
                XCTAssertEqual(mcpCheckboxIsChecked(control), label == "Name" && index == 0,
                               "Only readable Name may be checked; all editable fields must be unchecked")
            }
        }
        // These are the other settings sections' actual checkboxes, outside MCP.
        let otherSettings = ["Enable in-app reminders", "Default renewal reminders", "Browser notifications",
                             "Activate this key automatically after unlocking the vault"]
        let recordCheckboxes = allCheckboxes.filter { !fieldLabels.contains($0.label) && !otherSettings.contains($0.label) }
        XCTAssertEqual(recordCheckboxes.filter { mcpCheckboxIsChecked($0) }.map { $0.label }, [marker],
                       "No other record may be included in the real native scope")
        captureHierarchy(app, "ios-mcp-prepare-en-selected-name-only-scope-AX")
        let prepare = app.buttons["Prepare pairing file"].firstMatch
        XCTAssertTrue(prepare.waitForExistence(timeout: 10))
        reachProjectControl(prepare, in: app)
        capture(app, "ios-mcp-prepare-en-before-prepare")
        captureHierarchy(app, "ios-mcp-prepare-en-before-prepare-AX")
        XCTAssertTrue(prepare.isEnabled)
        tapProjectControl(prepare, in: app)
        let ready = app.staticTexts[readyText].firstMatch
        let reachedReady = ready.waitForExistence(timeout: 45)
        capture(app, "ios-mcp-prepare-en-prepare-result")
        captureHierarchy(app, "ios-mcp-prepare-en-prepare-result-AX")
        XCTAssertTrue(reachedReady, "Actual iOS authority/Keychain and transport prepare must complete; unsupported or an error is not success")
        let export = app.links["Save or share file"].firstMatch
        let activate = app.buttons["Start waiting for computer"].firstMatch
        XCTAssertTrue(export.waitForExistence(timeout: 5))
        XCTAssertTrue(activate.waitForExistence(timeout: 5))
        XCTAssertFalse(activate.isEnabled, "Preparing without actual system delivery must not permit listener activation")
        XCTAssertFalse(app.staticTexts["Access granted"].exists)
        XCTAssertFalse(app.staticTexts["Waiting for a computer request. Check the client, comparison code and permissions on this device before approving."].exists)
        let stop = app.buttons["Stop connection"].firstMatch
        reachProjectControl(stop, in: app)
        capture(app, "ios-mcp-prepare-en-ready-activation-disabled")
        XCTAssertTrue(stop.isEnabled)
        tapProjectControl(stop, in: app)
        XCTAssertTrue(export.waitForNonExistence(timeout: 15), "Stop must discard the real prepared pairing file")
        XCTAssertTrue(activate.waitForNonExistence(timeout: 15))
        XCTAssertTrue(ready.waitForNonExistence(timeout: 15))
        XCTAssertTrue(stop.waitForNonExistence(timeout: 15), "A failed/unconfirmed stop must not be accepted")
        XCTAssertTrue(prepare.isEnabled)
        capture(app, "ios-mcp-prepare-en-explicitly-stopped")
        captureHierarchy(app, "ios-mcp-prepare-en-explicitly-stopped-AX")
        app.links["More"].firstMatch.tap()
        XCTAssertTrue(access.waitForExistence(timeout: 10))
        tapProjectControl(access, in: app)
        XCTAssertTrue(noConnection.waitForExistence(timeout: 10))
        XCTAssertFalse(app.staticTexts["Access granted"].exists)
        capture(app, "ios-mcp-prepare-en-no-final-grant")
        captureHierarchy(app, "ios-mcp-prepare-en-no-final-grant-AX")
        let manifest: [String: Any] = [
            "language": "en", "marker": marker, "address": "127.0.0.1",
            "selectedRecordNames": [marker], "readFields": ["name"], "writeFields": [String](),
            "readyReached": reachedReady, "activationDisabledBeforeDelivery": true,
            "explicitStopConfirmedByUI": true, "noActiveLocalConnectionAfterStop": true,
            "systemExportAttempted": false, "listenerActivated": false, "externalSDKTested": false,
            "evidenceBoundary": "Actual iOS UI prepare/stop only; no claim of system delivery, active TLS traffic, external pairing or storage encryption audit"
        ]
        let attachment = XCTAttachment(data: try JSONSerialization.data(withJSONObject: manifest, options: [.prettyPrinted, .sortedKeys]),
                                       uniformTypeIdentifier: "public.json")
        attachment.name = "ios-mcp-prepare-en-ui-checkpoint.json"
        attachment.lifetime = .keepAlways
        add(attachment)
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
