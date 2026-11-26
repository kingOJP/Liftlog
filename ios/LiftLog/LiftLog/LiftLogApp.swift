import SwiftUI
import LiftLogCore

@main
struct LiftLogApp: App {
    @State private var store = AppStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(store)
        }
    }
}

/// Owns the on-device SQLite store and hands it to the engines (they read
/// localStorage-equivalent keys through `LiftLogEnv.store`).
@Observable
final class AppStore {
    let local: LiftLogStore?

    init() {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let local = try? LiftLogStore(path: dir.appendingPathComponent("liftlog.sqlite").path)
        self.local = local
        if let local { LiftLogEnv.store = local }
    }
}
