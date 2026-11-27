import Foundation

public protocol HTTPTransport: Sendable {
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse)
}

public struct URLSessionTransport: HTTPTransport {
    public init() {}
    public func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        return (data, http)
    }
}

public enum LiftLogAPIError: Error, Equatable {
    case unauthorized
    case http(Int, String)
    case nonJSON
}

func jsonRequest(_ url: URL, method: String, token: String?, body: (any Encodable)? = nil) throws -> URLRequest {
    var r = URLRequest(url: url)
    r.httpMethod = method
    if let token { r.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
    if let body {
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        r.httpBody = try JSONEncoder().encode(AnyEncodableBox(body))
    }
    return r
}

struct AnyEncodableBox: Encodable {
    let value: any Encodable
    init(_ value: any Encodable) { self.value = value }
    func encode(to encoder: Encoder) throws { try value.encode(to: encoder) }
}
