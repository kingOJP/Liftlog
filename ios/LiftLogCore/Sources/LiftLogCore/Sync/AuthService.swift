import Foundation
import CryptoKit

public struct AuthUser: Codable, Hashable, Sendable {
    public var id: String
    public var email: String
    public var name: String?
}

public struct LinkedIdentity: Codable, Hashable, Sendable {
    public var provider: String
    public var email: String?
}

public struct AuthSession: Codable, Hashable, Sendable {
    public var token: String
    public var expiresAt: Double
    public var user: AuthUser
    public var identities: [LinkedIdentity]
    public var created: Bool?
    /// "auto" (verified-email match), "explicit" (linked via Google / from a session) or nil
    public var linked: String?
}

/// An Apple identity that matched no account: the app must ask
/// "Already use LiftLog? Sign in with Google to link" before anything is created.
public struct LinkRequired: Codable, Hashable, Sendable {
    public var linkToken: String
    public var expiresAt: Double
    public var email: String?
    public var prompt: String
}

public enum AuthOutcome: Hashable, Sendable {
    case signedIn(AuthSession)
    case linkRequired(LinkRequired)
}

public enum AuthError: Error, Equatable {
    case invalidToken
    case identityInUse
    case linkExpired
    case notConfigured
    case unauthorized
    case http(Int)
}

public enum AuthProvider: String, Sendable { case apple, google }

/// Native sign-in against the worker (worker/identity.ts). The real Sign in
/// with Apple button produces the identity token + raw nonce (`AppleSignIn`);
/// the Google iOS SDK produces the Google ID token. The session token is kept
/// in the `TokenStore` (Keychain on device) and sent as `Authorization: Bearer`.
public final class AuthService: @unchecked Sendable {
    let baseURL: URL
    public let tokens: TokenStore
    let transport: HTTPTransport

    public init(baseURL: URL, tokens: TokenStore, transport: HTTPTransport = URLSessionTransport()) {
        self.baseURL = baseURL; self.tokens = tokens; self.transport = transport
    }

    public var isSignedIn: Bool { tokens.token() != nil }

    /// A fresh nonce: send `sha256` to Apple, `raw` to the worker.
    public static func makeNonce() -> (raw: String, sha256: String) {
        let raw = (0..<32).map { _ in String(format: "%02x", UInt8.random(in: 0...255)) }.joined()
        let digest = SHA256.hash(data: Data(raw.utf8)).map { String(format: "%02x", $0) }.joined()
        return (raw, digest)
    }

    public func signInWithApple(identityToken: String, rawNonce: String?, name: String? = nil) async throws -> AuthOutcome {
        var body = ["identityToken": identityToken]
        if let rawNonce { body["rawNonce"] = rawNonce }
        if let name { body["name"] = name }
        return try await signIn("/api/auth/apple", body)
    }

    /// Google sign-in; with a `linkToken` it also attaches the pending Apple identity to that account.
    public func signInWithGoogle(idToken: String, linkToken: String? = nil) async throws -> AuthOutcome {
        var body = ["idToken": idToken]
        if let linkToken { body["linkToken"] = linkToken }
        return try await signIn("/api/auth/google/native", body)
    }

    /// The explicit "I'm new to LiftLog" answer to a link prompt.
    public func createAppleAccount(linkToken: String) async throws -> AuthOutcome {
        try await signIn("/api/auth/apple/create", ["linkToken": linkToken])
    }

    /// Link another sign-in to the signed-in account (Settings → Sign-in methods).
    public func link(_ provider: AuthProvider, token: String, rawNonce: String? = nil) async throws -> [LinkedIdentity] {
        var body = ["provider": provider.rawValue, provider == .apple ? "identityToken" : "idToken": token]
        if let rawNonce { body["rawNonce"] = rawNonce }
        let (data, res) = try await send("/api/auth/link", "POST", body)
        try check(res, data)
        return try JSONDecoder().decode(IdentitiesBody.self, from: data).identities
    }

    public func identities() async throws -> [LinkedIdentity] {
        let (data, res) = try await send("/api/auth/identities", "GET", nil)
        try check(res, data)
        return try JSONDecoder().decode(IdentitiesBody.self, from: data).identities
    }

    /// Permanently deletes the account and all of its data on the server. Explicit, user-initiated only.
    public func deleteAccount() async throws {
        let (data, res) = try await send("/api/account", "DELETE", ["confirm": "delete-account"])
        try check(res, data)
        tokens.setToken(nil)
    }

    public func signOut() async {
        _ = try? await send("/api/auth/native/logout", "POST", [String: String]())
        tokens.setToken(nil)
    }

    private struct IdentitiesBody: Decodable { var identities: [LinkedIdentity] }

    private func send(_ path: String, _ method: String, _ body: [String: String]?) async throws -> (Data, HTTPURLResponse) {
        let r = try jsonRequest(baseURL.appendingPathComponent(path), method: method, token: tokens.token(), body: body)
        return try await transport.send(r)
    }

    private func signIn(_ path: String, _ body: [String: String]) async throws -> AuthOutcome {
        let (data, res) = try await send(path, "POST", body)
        if res.statusCode == 409, let link = try? JSONDecoder().decode(LinkRequired.self, from: data) {
            return .linkRequired(link)
        }
        try check(res, data)
        let session = try JSONDecoder().decode(AuthSession.self, from: data)
        tokens.setToken(session.token)
        return .signedIn(session)
    }

    private func check(_ res: HTTPURLResponse, _ data: Data) throws {
        if (200..<300).contains(res.statusCode) { return }
        let error = (try? JSONDecoder().decode([String: String].self, from: data))?["error"]
        switch (res.statusCode, error) {
        case (401, "invalid_token"): throw AuthError.invalidToken
        case (401, _): throw AuthError.unauthorized
        case (409, _): throw AuthError.identityInUse
        case (410, _): throw AuthError.linkExpired
        case (503, _): throw AuthError.notConfigured
        default: throw AuthError.http(res.statusCode)
        }
    }
}
