import Combine
import Foundation
import PhotosUI
import SwiftUI

@MainActor
final class ImportViewModel: ObservableObject {
    @Published var selectedItem: PhotosPickerItem?
    @Published private(set) var source: VideoSource?
    @Published private(set) var isLoading = false
    @Published private(set) var errorMessage: String?

    private let importer = VideoImporter()
    private let analyzer = AudioTrackAnalyzer()

    func importAndAnalyze(_ item: PhotosPickerItem?) async {
        guard let item else { return }

        isLoading = true
        errorMessage = nil
        source = nil

        do {
            let imported = try await importer.importVideo(from: item)
            source = try await analyzer.analyze(
                url: imported.localURL,
                displayName: imported.displayName
            )
        } catch {
            errorMessage = error.localizedDescription
        }

        isLoading = false
    }
}
