import AuthenticationServices
import CryptoKit
import Foundation
import OSLog
import Security
import UIKit

// MIRRORED FILE — an identical copy lives in the sibling app (ipad-app/ ⇄ iphone-app/).
// No shared Swift package yet: apply every change to BOTH copies and keep them byte-identical.

private let driveLog = Logger(subsystem: "com.example.LanguageCaption", category: "DriveAuth")

/// Google OAuth via `ASWebAuthenticationSession` + PKCE + Keychain. No GoogleSignIn SPM.
@MainActor
public final class DriveAuthService: NSObject {
    public static let shared = DriveAuthService()

    /// Keychain service per app (real bundle id) — the old placeholder was
    /// shared by the iPad and the iPhone app.
    private var keychainService: String {
        (Bundle.main.bundleIdentifier ?? "com.example.LanguageCaption") + ".drive"
    }
    /// Pre-2026-10 placeholder service (both apps wrote to it) — read once, then dropped.
    private static let legacyKeychainService = "com.example.LanguageCaption.drive"
    private let keychainAccount = "oauth"
    private var session: ASWebAuthenticationSession?
    /// One refresh at a time: concurrent callers await the same POST instead of
    /// racing each other (last-write-wins on the Keychain pair).
    private var refreshTask: Task<Tokens, Error>?

    public var hasToken: Bool { loadTokens() != nil }

    /// Interactive OAuth if needed; returns a usable access token.
    @discardableResult
    public func connect() async throws -> String {
        if let token = try await validAccessToken(interactive: false) { return token }
        return try await validAccessToken(interactive: true)
            ?? { throw DriveAuthError.noToken }()
    }

    func accessToken() async throws -> String {
        try await validAccessToken(interactive: false)
            ?? { throw DriveAuthError.notConnected }()
    }

    func disconnect() {
        deleteTokens()
    }

    // MARK: - Token lifecycle

    private func validAccessToken(interactive: Bool) async throws -> String? {
        guard DriveOAuthConfig.isConfigured else {
            if interactive { throw DriveAuthError.missingClientId }
            return nil
        }
        if var tokens = loadTokens() {
            if tokens.accessToken.isEmpty == false,
               tokens.expiresAt.timeIntervalSinceNow > 60 {
                return tokens.accessToken
            }
            if !tokens.refreshToken.isEmpty {
                do {
                    tokens = try await refreshedTokens(refreshToken: tokens.refreshToken)
                    return tokens.accessToken
                } catch {
                    // Never swallow the refresh failure silently — the caller would
                    // only see "not connected" and the cause would be lost.
                    driveLog.error("token refresh failed: \(error.localizedDescription, privacy: .public)")
                }
            }
            if !interactive { return nil }
        } else if !interactive {
            return nil
        }
        let tokens = try await authorize()
        try saveTokens(tokens)
        return tokens.accessToken
    }

    /// Single in-flight refresh: the first caller performs the POST, every other
    /// caller awaits the same result instead of refreshing again.
    private func refreshedTokens(refreshToken: String) async throws -> Tokens {
        if let existing = refreshTask { return try await existing.value }
        let task = Task<Tokens, Error> { [refreshToken] in
            let tokens = try await self.refresh(refreshToken)
            try self.saveTokens(tokens)
            return tokens
        }
        refreshTask = task
        defer { refreshTask = nil }
        return try await task.value
    }

    private func authorize() async throws -> Tokens {
        let pkce = Self.makePKCE()
        // CSRF guard: Google echoes `state` back — reject callbacks without it.
        let state = Self.randomToken(16)
        var comps = URLComponents(url: DriveOAuthConfig.authURL, resolvingAgainstBaseURL: false)!
        comps.queryItems = [
            URLQueryItem(name: "client_id", value: DriveOAuthConfig.clientId),
            URLQueryItem(name: "redirect_uri", value: DriveOAuthConfig.redirectURI),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "scope", value: DriveOAuthConfig.scope),
            URLQueryItem(name: "access_type", value: "offline"),
            URLQueryItem(name: "prompt", value: "consent"),
            URLQueryItem(name: "code_challenge", value: pkce.challenge),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
            URLQueryItem(name: "state", value: state),
        ]
        guard let url = comps.url else { throw DriveAuthError.badURL }

        let callback = try await withCheckedThrowingContinuation { (cont: CheckedContinuation<URL, Error>) in
            let session = ASWebAuthenticationSession(
                url: url,
                callbackURLScheme: DriveOAuthConfig.urlScheme
            ) { callbackURL, error in
                if let error {
                    cont.resume(throwing: error)
                } else if let callbackURL {
                    cont.resume(returning: callbackURL)
                } else {
                    cont.resume(throwing: DriveAuthError.cancelled)
                }
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            self.session = session
            if !session.start() {
                cont.resume(throwing: DriveAuthError.cancelled)
            }
        }
        self.session = nil

        let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
        if let oauthErr = items.first(where: { $0.name == "error" })?.value {
            if oauthErr == "invalid_request" { throw DriveAuthError.invalidRequest }
            let desc = items.first(where: { $0.name == "error_description" })?.value
            throw DriveAuthError.oauthError(oauthErr, desc)
        }
        // CSRF: the callback must carry the exact state we issued.
        guard items.first(where: { $0.name == "state" })?.value == state
        else { throw DriveAuthError.stateMismatch }
        guard let code = items.first(where: { $0.name == "code" })?.value
        else { throw DriveAuthError.noCode }

        return try await exchange(code: code, verifier: pkce.verifier)
    }

    private func exchange(code: String, verifier: String) async throws -> Tokens {
        var req = URLRequest(url: DriveOAuthConfig.tokenURL)
        req.httpMethod = "POST"
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        req.httpBody = form([
            "code": code,
            "client_id": DriveOAuthConfig.clientId,
            "redirect_uri": DriveOAuthConfig.redirectURI,
            "grant_type": "authorization_code",
            "code_verifier": verifier,
        ])
        return try await decodeTokens(req)
    }

    private func refresh(_ refreshToken: String) async throws -> Tokens {
        var req = URLRequest(url: DriveOAuthConfig.tokenURL)
        req.httpMethod = "POST"
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        req.httpBody = form([
            "refresh_token": refreshToken,
            "client_id": DriveOAuthConfig.clientId,
            "grant_type": "refresh_token",
        ])
        var tokens = try await decodeTokens(req)
        if tokens.refreshToken.isEmpty { tokens.refreshToken = refreshToken }
        return tokens
    }

    private func decodeTokens(_ req: URLRequest) async throws -> Tokens {
        let (data, res) = try await URLSession.shared.data(for: req)
        guard let http = res as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let body = String(data: data, encoding: .utf8) ?? ""
            if body.contains("invalid_request") { throw DriveAuthError.invalidRequest }
            throw DriveAuthError.tokenHTTP((res as? HTTPURLResponse)?.statusCode ?? 0, body)
        }
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let access = json["access_token"] as? String
        else { throw DriveAuthError.badTokenJSON }
        let expiresIn = (json["expires_in"] as? NSNumber)?.doubleValue ?? 3600
        return Tokens(
            accessToken: access,
            refreshToken: json["refresh_token"] as? String ?? "",
            expiresAt: Date().addingTimeInterval(expiresIn)
        )
    }

    private func form(_ fields: [String: String]) -> Data {
        fields
            .map { "\($0.key)=\($0.value.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? $0.value)" }
            .joined(separator: "&")
            .data(using: .utf8)!
    }

    /// PKCE S256: 32 random bytes → base64url verifier; SHA256(verifier) → base64url challenge.
    private static func makePKCE() -> (verifier: String, challenge: String) {
        var bytes = [UInt8](repeating: 0, count: 32)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        let verifier = Data(bytes).base64URLEncoded
        let challenge = Data(SHA256.hash(data: Data(verifier.utf8))).base64URLEncoded
        assert(!challenge.contains("+") && !challenge.contains("/") && !challenge.contains("="))
        return (verifier, challenge)
    }

    /// Random hex token for OAuth `state` (CSRF).
    private static func randomToken(_ bytes: Int) -> String {
        var buf = [UInt8](repeating: 0, count: bytes)
        _ = SecRandomCopyBytes(kSecRandomDefault, buf.count, &buf)
        return buf.map { String(format: "%02x", $0) }.joined()
    }

    // MARK: - Keychain

    private struct Tokens: Codable {
        var accessToken: String
        var refreshToken: String
        var expiresAt: Date
    }

    private func saveTokens(_ tokens: Tokens) throws {
        guard let data = try? JSONEncoder().encode(tokens) else {
            throw DriveAuthError.badTokenJSON
        }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount,
        ]
        let attrs: [String: Any] = [
            kSecValueData as String: data,
            // This-device-only: the token must not ride iCloud Keychain to another device.
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        // Update in place: a delete+add pair drops the token when the process dies
        // between the two calls.
        let status = SecItemUpdate(query as CFDictionary, attrs as CFDictionary)
        if status == errSecItemNotFound {
            let addStatus = SecItemAdd(query.merging(attrs) { $1 } as CFDictionary, nil)
            guard addStatus == errSecSuccess else {
                throw DriveAuthError.tokenHTTP(Int(addStatus), "Keychain save failed")
            }
        } else if status != errSecSuccess {
            throw DriveAuthError.tokenHTTP(Int(status), "Keychain save failed")
        }
        // The per-app item exists now — drop the shared legacy placeholder.
        SecItemDelete([
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.legacyKeychainService,
            kSecAttrAccount as String: keychainAccount,
        ] as CFDictionary)
    }

    private func loadTokens() -> Tokens? {
        if let tokens = readTokens(service: keychainService) { return tokens }
        // Legacy placeholder item — used once, then migrated on the next save.
        return readTokens(service: Self.legacyKeychainService)
    }

    private func readTokens(service: String) -> Tokens? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: keychainAccount,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data
        else { return nil }
        return try? JSONDecoder().decode(Tokens.self, from: data)
    }

    private func deleteTokens() {
        for service in [keychainService, Self.legacyKeychainService] {
            SecItemDelete([
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: service,
                kSecAttrAccount as String: keychainAccount,
            ] as CFDictionary)
        }
    }
}

private extension Data {
    var base64URLEncoded: String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

extension DriveAuthService: ASWebAuthenticationPresentationContextProviding {
    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        if let key = scenes.flatMap(\.windows).first(where: \.isKeyWindow) { return key }
        return scenes.flatMap(\.windows).first ?? ASPresentationAnchor()
    }
}

public enum DriveAuthError: LocalizedError {
    case missingClientId
    case invalidRequest
    case oauthError(String, String?)
    case notConnected
    case noToken
    case cancelled
    case noCode
    case stateMismatch
    case badURL
    case badTokenJSON
    case tokenHTTP(Int, String)

    public var errorDescription: String? {
        switch self {
        case .missingClientId:
            return "Cần OAuth client kiểu iOS trên GCP, không dùng client Chrome extension (xem COMMANDS.md)"
        case .invalidRequest:
            return "Cần OAuth client kiểu iOS trên GCP, không dùng client Chrome extension"
        case .oauthError(let err, let desc):
            return desc.map { "OAuth \(err): \($0)" } ?? "OAuth: \(err)"
        case .notConnected:
            return "Chưa Connect Drive"
        case .noToken:
            return "OAuth không trả token"
        case .cancelled:
            return "Đã huỷ OAuth"
        case .noCode:
            return "OAuth không có code"
        case .stateMismatch:
            return "OAuth state không khớp (CSRF?)"
        case .badURL:
            return "OAuth URL lỗi"
        case .badTokenJSON:
            return "Token JSON lỗi"
        case .tokenHTTP(let code, let body):
            return "Token \(code): \(body.prefix(120))"
        }
    }
}
