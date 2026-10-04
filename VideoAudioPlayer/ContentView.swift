import PhotosUI
import SwiftUI

struct ContentView: View {
    @StateObject private var viewModel = ImportViewModel()

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    PhotosPicker(
                        selection: $viewModel.selectedItem,
                        matching: .videos,
                        preferredItemEncoding: .current
                    ) {
                        Label("動画を選択", systemImage: "video.badge.plus")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                } header: {
                    Text("動画から音源を作る")
                } footer: {
                    Text("工程1では音声を抽出せず、元動画の音声情報だけを解析します。")
                }

                if viewModel.isLoading {
                    Section {
                        HStack {
                            ProgressView()
                            Text("動画と音声トラックを解析中…")
                        }
                    }
                }

                if let source = viewModel.source {
                    Section("選択した動画") {
                        LabeledContent("ファイル", value: source.displayName)
                        LabeledContent("長さ", value: durationText(source.duration))
                        LabeledContent("音声トラック", value: "\(source.audioTracks.count)")
                    }

                    ForEach(Array(source.audioTracks.enumerated()), id: \.element.id) { index, track in
                        Section("音声情報 \(index + 1)") {
                            LabeledContent("Codec", value: track.codec)
                            LabeledContent("Sample Rate", value: track.sampleRateDescription)
                            LabeledContent("Channels", value: track.channelDescription)
                            LabeledContent("Bitrate", value: track.bitrateDescription)
                            LabeledContent("Duration", value: durationText(track.duration))
                        }
                    }

                    Section {
                        Label("解析完了", systemImage: "checkmark.circle.fill")
                            .foregroundStyle(.green)
                    }
                }

                if let error = viewModel.errorMessage {
                    Section("解析できませんでした") {
                        Label(error, systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(.orange)
                    }
                }
            }
            .navigationTitle("Video Audio")
            .onChange(of: viewModel.selectedItem) { _, newItem in
                Task {
                    await viewModel.importAndAnalyze(newItem)
                }
            }
        }
    }

    private func durationText(_ seconds: Double) -> String {
        guard seconds.isFinite, seconds >= 0 else { return "--:--" }
        let total = Int(seconds.rounded())
        let hours = total / 3600
        let minutes = (total % 3600) / 60
        let remainingSeconds = total % 60

        if hours > 0 {
            return String(format: "%d:%02d:%02d", hours, minutes, remainingSeconds)
        }
        return String(format: "%d:%02d", minutes, remainingSeconds)
    }
}
