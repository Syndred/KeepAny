import Foundation
import Dispatch
import Security
import Crypto
import X509
import NIOSSL

enum SessionLeafTrustError: Error {
    case invalidExpectedLeaf
}

/// Test-client trust for exactly one explicitly supplied, ephemeral session leaf.
/// This does not change the server identity or NIOSSL's post-handshake hostname
/// validation: callers must retain TLSConfiguration.fullVerification.
struct SessionLeafTrust: Sendable {
    private let expectedDER: Data
    private let expectedSpki: String

    init(certificatePem: String, spkiSha256: String) throws {
        guard certificatePem.utf8.count <= 32_768,
              spkiSha256.utf8.count == 64,
              spkiSha256.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }) else {
            throw SessionLeafTrustError.invalidExpectedLeaf
        }
        do {
            let certificates = try NIOSSLCertificate.fromPEMBytes(Array(certificatePem.utf8))
            guard certificates.count == 1 else { throw SessionLeafTrustError.invalidExpectedLeaf }
            expectedDER = Data(try certificates[0].toDERBytes())
            expectedSpki = spkiSha256
        } catch {
            throw SessionLeafTrustError.invalidExpectedLeaf
        }
    }

    var callback: NIOSSLCustomVerificationCallback {
        { chain, promise in
            // Security trust evaluation may involve local system services. Never
            // block the NIO event loop. Network fetching and ambient anchors
            // are disabled on this evaluation's private trust object.
            DispatchQueue.global(qos: .userInitiated).async {
                promise.succeed(self.accepts(chain) ? .certificateVerified : .failed)
            }
        }
    }

    private func accepts(_ chain: [NIOSSLCertificate]) -> Bool {
        do {
            guard chain.count == 1,
                  Data(try chain[0].toDERBytes()) == expectedDER else { return false }
            let certificate = try Certificate(derEncoded: Array(expectedDER))
            let now = Date()
            // A trusted anchor can receive special treatment from a platform
            // evaluator. Enforce the session leaf contract independently first.
            guard certificate.issuer == certificate.subject,
                  certificate.publicKey.isValidSignature(certificate.signature, for: certificate),
                  certificate.notValidBefore <= now, now <= certificate.notValidAfter,
                  try certificate.extensions.basicConstraints == .notCertificateAuthority,
                  try certificate.extensions.keyUsage?.digitalSignature == true,
                  try certificate.extensions.extendedKeyUsage?.contains(.serverAuth) == true else { return false }
            let keyDER = Data(try certificate.publicKey.serializeAsPEM().derBytes)
            let pin = SHA256.hash(data: keyDER).map { String(format: "%02x", $0) }.joined()
            guard pin == expectedSpki,
                  let leaf = SecCertificateCreateWithData(nil, expectedDER as CFData) else { return false }

            // Server-purpose policy here; IP SAN is still checked by NIOSSL's
            // fullVerification after this callback, using the actual peer IP.
            let policy = SecPolicyCreateSSL(true, nil)
            var optionalTrust: SecTrust?
            guard SecTrustCreateWithCertificates([leaf] as CFArray, policy, &optionalTrust) == errSecSuccess,
                  let trust = optionalTrust,
                  SecTrustSetAnchorCertificates(trust, [leaf] as CFArray) == errSecSuccess,
                  SecTrustSetAnchorCertificatesOnly(trust, true) == errSecSuccess,
                  SecTrustSetNetworkFetchAllowed(trust, false) == errSecSuccess,
                  SecTrustSetVerifyDate(trust, now as CFDate) == errSecSuccess else { return false }
            // No default/system anchor fallback and no error/PEM logging.
            return SecTrustEvaluateWithError(trust, nil)
        } catch {
            return false
        }
    }
}
