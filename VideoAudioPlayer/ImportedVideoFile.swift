import CoreTransferable
import Foundation
import PhotosUI
import UniformTypeIdentifiers

enum VideoImportError: LocalizedError {
    case noTransferableFile
    case couldNotCreateStorage

    var errorDescription: String? {
        switch self {
        case .noTransferableFile:
            return "選択した動画を読み込めませんでした。"
        case .couldNotCreateStorage:
            return "動画の作業領域を作成できませんでした。"
        }
    }
}

struct ImportedVideoFile: Transferable, Sendable {
    let localURL: URL
    let displayName: String

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(importedContentType: .movie) { received in
            let fileManager = FileManager.default
            guard let applicationSupport = fileManager.urls(
                for: .applicationSupportDirectory,
                in: .userDomainMask
            ).first else {
                throw VideoImportError.couldNotCreateStorage
            }

            let directory = applicationSupport
                .appendingPathComponent("ImportedVideos", isDirectory: true)

            try fileManager.createDirectory(
                at: directory,
                withIntermediateDirectories: true
            )

            let sourceName = received.file.lastPathComponent
            let sourceExtension = received.file.pathExtension
            let storedName = sourceExtension.isEmpty
                ? UUID().uuidString
                : "\(UUID().uuidString).\(sourceExtension)"

            let destination = directory.appendingPathComponent(storedName)
            try fileManager.copyItem(at: received.file, to: destination)

            return ImportedVideoFile(
                localURL: destination,
                displayName: sourceName.isEmpty ? "Selected Video" : sourceName
            )
        }
    }
}

struct VideoImporter {
    func importVideo(from item: PhotosPickerItem) async throws -> ImportedVideoFile {
        guard let imported = try await item.loadTransferable(type: ImportedVideoFile.self) else {
            throw VideoImportError.noTransferableFile
        }
        return imported
    }
}
