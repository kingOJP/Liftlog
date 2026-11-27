import Foundation
#if canImport(Security)
import Security
#endif

/// Where the native session token (the worker's `Authorization: Bearer` value) lives.
public protocol TokenStore: AnyObject {
    func token() -> String?
    func setToken(_ token: String?)
}

public final class InMemoryTokenStore: TokenStore {
    private var value: String?
    public init(_ token: String? = nil) { value = token }
    public func token() -> String? { value }
    public func setToken(_ token: String?) { value = token }
}

#if canImport(Security)
/// Keychain-backed token storage: readable after first unlock (so background
/// sync works on a locked phone), never synced to iCloud or restored to another device.
public final class KeychainTokenStore: TokenStore {
    let service: String
    let account: String

    public init(service: String = "app.liftlog.ios.session", account: String = "liftlog") {
        self.service = service; self.account = account
    }

    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
    }

    public func token() -> String? {
        var q = query
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    public func setToken(_ token: String?) {
        guard let token else { SecItemDelete(query as CFDictionary); return }
        let data = Data(token.utf8)
        let update: [String: Any] = [kSecValueData as String: data]
        if SecItemUpdate(query as CFDictionary, update as CFDictionary) == errSecItemNotFound {
            var add = query
            add[kSecValueData as String] = data
            add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            SecItemAdd(add as CFDictionary, nil)
        }
    }
}
#endif
