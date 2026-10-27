import XCTest
import Foundation
import Crypto
import X509
import NIOCore
import NIOPosix
import NIOSSL
@testable import KeepAnyMcpTransportCore

final class SessionLeafTrustTests: XCTestCase {
    override func setUpWithError() throws {
        mcpCoreCaseStage("case-start", name: name)
        try super.setUpWithError()
        mcpCoreCaseStage("case-setup-complete", name: name)
    }

    override func tearDownWithError() throws {
        mcpCoreCaseStage("case-teardown-before", name: name)
        defer { mcpCoreCaseStage("case-teardown-after", name: name) }
        try super.tearDownWithError()
    }

    private struct Sample {
        let pem: String
        let pin: String
        var peer: NIOSSLCertificate { get throws { try NIOSSLCertificate(bytes: Array(pem.utf8), format: .pem) } }
    }

    private func productionSample() throws -> Sample {
        let identity = try EphemeralIdentity(address: "127.0.0.1")
        return Sample(pem: identity.certificatePem, pin: identity.spkiSha256)
    }

    /// Real signed synthetic certificates; only the selected constraint changes.
    /// No private key, DER or payload is logged or written to disk.
    private func sample(key: P256.Signing.PrivateKey = P256.Signing.PrivateKey(),
                        notBefore: Date = Date().addingTimeInterval(-60),
                        notAfter: Date = Date().addingTimeInterval(3600),
                        digitalSignature: Bool = true, serverPurpose: Bool = true,
                        wrongSigner: Bool = false) throws -> Sample {
        let signer = wrongSigner ? P256.Signing.PrivateKey() : key
        let name = try DistinguishedName { CommonName("KeepAny synthetic session trust") }
        let template = try Certificate(pemEncoded: productionSample().pem)
        let names = try XCTUnwrap(template.extensions.subjectAlternativeNames)
        let certificate = try Certificate(
            version: .v3,
            serialNumber: .init(bytes: withUnsafeBytes(of: UUID().uuid) { Array($0) }),
            publicKey: .init(key.publicKey),
            notValidBefore: notBefore, notValidAfter: notAfter,
            issuer: name, subject: name, signatureAlgorithm: .ecdsaWithSHA256,
            extensions: Certificate.Extensions {
                Critical(BasicConstraints.notCertificateAuthority)
                Critical(KeyUsage(digitalSignature: digitalSignature, keyAgreement: !digitalSignature))
                try ExtendedKeyUsage(serverPurpose ? [.serverAuth] : [.clientAuth])
                names
            }, issuerPrivateKey: .init(signer)
        )
        let pin = SHA256.hash(data: key.publicKey.derRepresentation).map { String(format: "%02x", $0) }.joined()
        return Sample(pem: try certificate.serializeAsPEM().pemString, pin: pin)
    }

    private func verified(_ expected: Sample, peers: [NIOSSLCertificate]? = nil, pin: String? = nil) throws -> Bool {
        let trust = try SessionLeafTrust(certificatePem: expected.pem, spkiSha256: pin ?? expected.pin)
        let chain: [NIOSSLCertificate]
        if let peers { chain = peers } else { chain = [try expected.peer] }
        let group = MultiThreadedEventLoopGroup(numberOfThreads: 1)
        defer { try? group.syncShutdownGracefully() }
        let loop = group.next(), promise = loop.makePromise(of: NIOSSLVerificationResult.self)
        // Exercise the exact asynchronous callback wired into TLSProbe, rather
        // than an independent duplicate of its certificate policy.
        try loop.submit { trust.callback(chain, promise) }.wait()
        switch try promise.futureResult.wait() {
        case .certificateVerified: return true
        case .failed: return false
        }
    }

    func testExactProductionSessionLeafAndSyntheticControlPassSecurity() throws {
        XCTAssertTrue(try verified(productionSample()))
        XCTAssertTrue(try verified(sample()))
    }

    func testAnotherLeafAndEmptyOrAdditionalChainAreRejected() throws {
        let expected = try productionSample(), other = try productionSample()
        XCTAssertFalse(try verified(expected, peers: [try other.peer]))
        XCTAssertFalse(try verified(expected, peers: []))
        XCTAssertFalse(try verified(expected, peers: [try expected.peer, try other.peer]))
        // Same SPKI is insufficient: a reissued certificate is a different
        // session leaf even when its public key is identical.
        let key = P256.Signing.PrivateKey()
        let original = try sample(key: key), reissued = try sample(key: key)
        XCTAssertEqual(original.pin, reissued.pin)
        XCTAssertTrue(try verified(original))
        XCTAssertFalse(try verified(original, peers: [try reissued.peer]))
    }

    func testWrongTupleSpkiIsRejected() throws {
        let expected = try productionSample(), other = try productionSample()
        XCTAssertFalse(try verified(expected, pin: other.pin))
    }

    func testExpiredAndNotYetValidLeavesAreRejected() throws {
        XCTAssertFalse(try verified(sample(notBefore: Date().addingTimeInterval(-7200), notAfter: Date().addingTimeInterval(-3600))))
        XCTAssertFalse(try verified(sample(notBefore: Date().addingTimeInterval(3600), notAfter: Date().addingTimeInterval(7200))))
    }

    func testClientOnlyPurposeIsRejectedDespiteExplicitLeafAnchor() throws {
        XCTAssertFalse(try verified(sample(serverPurpose: false)))
    }

    func testMissingDigitalSignatureUsageIsRejectedDespiteExplicitLeafAnchor() throws {
        XCTAssertFalse(try verified(sample(digitalSignature: false)))
    }

    func testInvalidSelfSignatureIsRejectedDespiteExplicitLeafAnchor() throws {
        XCTAssertFalse(try verified(sample(wrongSigner: true)))
    }

    func testMalformedExpectedTupleAndMultipleAnchorsAreRejected() throws {
        let expected = try productionSample(), other = try productionSample()
        XCTAssertThrowsError(try SessionLeafTrust(certificatePem: "not PEM", spkiSha256: expected.pin))
        XCTAssertThrowsError(try SessionLeafTrust(certificatePem: expected.pem, spkiSha256: "not a pin"))
        XCTAssertThrowsError(try SessionLeafTrust(certificatePem: expected.pem + "\n" + other.pem, spkiSha256: expected.pin))
    }
}
