import Foundation
import Crypto
import X509
import SwiftASN1
import NIOSSL

struct EphemeralIdentity {
    let certificatePem: String
    let spkiSha256: String
    let context: NIOSSLContext

    init(address: String) throws {
        guard let octets = AddressPolicy.octets(address) else { throw McpTransportError.invalid }
        let key = P256.Signing.PrivateKey()
        let name = try DistinguishedName { CommonName("KeepAny ephemeral local MCP") }
        let now = Date()
        let certificate = try Certificate(
            version: .v3,
            serialNumber: .init(bytes: withUnsafeBytes(of: UUID().uuid) { Array($0) }),
            publicKey: .init(key.publicKey),
            notValidBefore: now.addingTimeInterval(-60),
            notValidAfter: now.addingTimeInterval(24 * 60 * 60),
            issuer: name, subject: name, signatureAlgorithm: .ecdsaWithSHA256,
            extensions: Certificate.Extensions {
                Critical(BasicConstraints.notCertificateAuthority)
                Critical(KeyUsage(digitalSignature: true))
                try ExtendedKeyUsage([.serverAuth])
                SubjectAlternativeNames([.ipAddress(ASN1OctetString(contentBytes: ArraySlice(octets)))])
            }, issuerPrivateKey: .init(key)
        )
        certificatePem = try certificate.serializeAsPEM().pemString
        // Crypto's P256 DER public representation is SubjectPublicKeyInfo, not
        // the SEC1/X9.63 point. This is the pin used by the strict CLI client.
        spkiSha256 = SHA256.hash(data: key.publicKey.derRepresentation).map { String(format: "%02x", $0) }.joined()
        let nioCert = try NIOSSLCertificate(bytes: Array(certificatePem.utf8), format: .pem)
        let nioKey = try NIOSSLPrivateKey(bytes: Array(key.pemRepresentation.utf8), format: .pem)
        var config = TLSConfiguration.makeServerConfiguration(certificateChain: [.certificate(nioCert)], privateKey: .privateKey(nioKey))
        config.minimumTLSVersion = .tlsv12
        config.applicationProtocols = ["http/1.1"]
        config.shutdownTimeout = .seconds(1)
        context = try NIOSSLContext(configuration: config)
        // Neither the PEM private key nor a trust anchor is written to disk or
        // Keychain. BoringSSL retains only this session's in-memory identity.
    }
}
