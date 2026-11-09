import Foundation

// MIRRORED FILE — an identical copy lives in the sibling app (ipad-app/ ⇄ iphone-app/).
// No shared Swift package yet: apply every change to BOTH copies and keep them byte-identical.

/// Google Drive OAuth — requires an **iOS** OAuth client from GCP.
/// Do NOT paste the Chrome extension `client_id` (→ Error 400: invalid_request).
public enum DriveOAuthConfig {
    /// iOS client id (`….apps.googleusercontent.com`) and Drive folder id are read
    /// from the app bundle (`Info.plist` → `DRIVE_OAUTH_CLIENT_ID` / `DRIVE_FOLDER_ID`)
    /// instead of being hardcoded in the source tree. Bundle: `com.example.LanguageCaption`.
    /// Then update `Info.plist` / `project.yml` URL scheme to `com.googleusercontent.apps.<prefix>`.
    static let clientId = Bundle.main.object(forInfoDictionaryKey: "DRIVE_OAUTH_CLIENT_ID") as? String ?? ""
    public static let folderId = Bundle.main.object(forInfoDictionaryKey: "DRIVE_FOLDER_ID") as? String ?? ""
    static let scope = "https://www.googleapis.com/auth/drive"
    static let authURL = URL(string: "https://accounts.google.com/o/oauth2/v2/auth")!
    static let tokenURL = URL(string: "https://oauth2.googleapis.com/token")!

    static var isConfigured: Bool { !clientId.isEmpty }

    /// `123-abc.apps.googleusercontent.com` → `com.googleusercontent.apps.123-abc`
    static var urlScheme: String {
        let prefix = clientId.replacingOccurrences(of: ".apps.googleusercontent.com", with: "")
        return "com.googleusercontent.apps.\(prefix)"
    }

    /// Google iOS clients expect reverse-client-id + `/oauth2redirect`.
    static var redirectURI: String { "\(urlScheme):/oauth2redirect" }
}
