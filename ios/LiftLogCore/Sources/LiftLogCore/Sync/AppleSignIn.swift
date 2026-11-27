#if os(iOS) && canImport(AuthenticationServices)
import AuthenticationServices
import UIKit

/// Runs the system Sign in with Apple sheet and returns what the worker needs.
/// Works once the app is signed with a team that has the Sign in with Apple
/// capability (a paid Apple Developer account); until then the sheet fails.
@MainActor
public final class AppleSignIn: NSObject, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    public struct Credential: Sendable {
        public var identityToken: String
        public var rawNonce: String
        public var name: String?
    }

    private var continuation: CheckedContinuation<Credential, Error>?
    private var rawNonce = ""

    public override init() { super.init() }

    public func signIn() async throws -> Credential {
        let nonce = AuthService.makeNonce()
        rawNonce = nonce.raw
        let request = ASAuthorizationAppleIDProvider().createRequest()
        request.requestedScopes = [.fullName, .email]
        request.nonce = nonce.sha256
        let controller = ASAuthorizationController(authorizationRequests: [request])
        controller.delegate = self
        controller.presentationContextProvider = self
        return try await withCheckedThrowingContinuation { c in
            continuation = c
            controller.performRequests()
        }
    }

    public nonisolated func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        MainActor.assumeIsolated {
            guard let cred = authorization.credential as? ASAuthorizationAppleIDCredential,
                  let data = cred.identityToken, let token = String(data: data, encoding: .utf8) else {
                continuation?.resume(throwing: ASAuthorizationError(.invalidResponse)); continuation = nil; return
            }
            let name = cred.fullName.flatMap { PersonNameComponentsFormatter().string(from: $0) }.flatMap { $0.isEmpty ? nil : $0 }
            continuation?.resume(returning: Credential(identityToken: token, rawNonce: rawNonce, name: name))
            continuation = nil
        }
    }

    public nonisolated func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        MainActor.assumeIsolated { continuation?.resume(throwing: error); continuation = nil }
    }

    public nonisolated func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow }.first ?? ASPresentationAnchor()
        }
    }
}
#endif
