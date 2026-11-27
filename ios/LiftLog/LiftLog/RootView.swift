import SwiftUI
import LiftLogCore

/// Phase 0 placeholder shell: the three top-level areas of the redesign.
/// Real screens arrive in a later phase.
struct RootView: View {
    enum Tab: Hashable { case today, journey, progress }
    @State private var tab: Tab = .today

    var body: some View {
        TabView(selection: $tab) {
            PlaceholderScreen(title: "Today", symbol: "figure.strengthtraining.traditional",
                              blurb: "Your next workout, ready to log.")
                .tabItem { Label("Today", systemImage: "figure.strengthtraining.traditional") }
                .tag(Tab.today)
            PlaceholderScreen(title: "Journey", symbol: "map",
                              blurb: "Your training plan, block by block.")
                .tabItem { Label("Journey", systemImage: "map") }
                .tag(Tab.journey)
            PlaceholderScreen(title: "Progress", symbol: "chart.line.uptrend.xyaxis",
                              blurb: "Strength, volume and PRs over time.")
                .tabItem { Label("Progress", systemImage: "chart.line.uptrend.xyaxis") }
                .tag(Tab.progress)
        }
    }
}

struct PlaceholderScreen: View {
    let title: String
    let symbol: String
    let blurb: String

    var body: some View {
        NavigationStack {
            ContentUnavailableView {
                Label(title, systemImage: symbol)
            } description: {
                Text(blurb)
            }
            .navigationTitle(title)
        }
    }
}

#Preview { RootView() }
