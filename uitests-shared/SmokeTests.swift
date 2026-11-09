import XCTest

/// Automated form of the manual simulator launch check: the app must reach the
/// foreground AND render its main UI (not just stay alive as a process).
/// Shared by both apps — each UITest target includes this one file.
final class SmokeTests: XCTestCase {
    func testLaunchShowsPlayer() {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(
            app.wait(for: .runningForeground, timeout: 30),
            "app must reach foreground"
        )
        let urlField = app.textFields["Language Caption URL"]
        XCTAssertTrue(
            urlField.waitForExistence(timeout: 30),
            "URL field must render (proves the main view loaded, not a black screen)"
        )
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.lifetime = .keepAlways
        add(shot)
    }
}
