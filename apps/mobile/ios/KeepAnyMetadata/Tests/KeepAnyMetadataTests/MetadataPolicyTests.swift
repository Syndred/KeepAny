import XCTest
@testable import KeepAnyMetadata

final class MetadataPolicyTests: XCTestCase {
    func testOriginalPublicAddressPolicy() {
        for address in ["127.0.0.1", "10.0.0.1", "100.64.0.1", "169.254.1.1", "172.16.0.1", "192.168.1.1", "192.0.2.1", "198.18.0.1", "198.51.100.1", "203.0.113.1", "224.0.0.1", "::1", "::ffff:8.8.8.8", "fc00::1", "fe80::1", "2001:db8::1", "2002:808:808::1"] { XCTAssertFalse(MetadataPolicy.publicAddress(address), address) }
        for address in ["8.8.8.8", "1.1.1.1", "2001:4860:4860::8888", "2606:4700:4700::1111"] { XCTAssertTrue(MetadataPolicy.publicAddress(address), address) }
    }
    func testUrlAndCancellationPolicy() throws {
        XCTAssertEqual(try MetadataPolicy.target("https://example.com/page#private").absoluteString, "https://example.com/page")
        for value in ["file:///private", "https://user:password@example.com/", "https://example.com/" + String(repeating: "x", count: 2048)] { XCTAssertThrowsError(try MetadataPolicy.target(value)) }
        let budget = MetadataBudget()
        budget.cancel()
        XCTAssertThrowsError(try budget.remaining())
    }
}
