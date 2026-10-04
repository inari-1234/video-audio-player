import AudioToolbox
import AVFoundation
import CoreMedia
import Foundation

enum AudioAnalysisError: LocalizedError {
    case noAudioTrack
    case invalidDuration

    var errorDescription: String? {
        switch self {
        case .noAudioTrack:
            return "この動画には音声トラックがありません。"
        case .invalidDuration:
            return "動画の長さを取得できませんでした。"
        }
    }
}

struct AudioTrackAnalyzer {
    func analyze(url: URL, displayName: String) async throws -> VideoSource {
        let asset = AVURLAsset(url: url)

        async let durationValue = asset.load(.duration)
        async let tracksValue = asset.loadTracks(withMediaType: .audio)

        let (durationTime, audioTracks) = try await (durationValue, tracksValue)
        let duration = CMTimeGetSeconds(durationTime)

        guard duration.isFinite, duration >= 0 else {
            throw AudioAnalysisError.invalidDuration
        }

        guard !audioTracks.isEmpty else {
            throw AudioAnalysisError.noAudioTrack
        }

        var analyzedTracks: [AudioTrackInfo] = []
        analyzedTracks.reserveCapacity(audioTracks.count)

        for track in audioTracks {
            async let descriptionsValue = track.load(.formatDescriptions)
            async let bitrateValue = track.load(.estimatedDataRate)
            async let timeRangeValue = track.load(.timeRange)

            let (descriptions, bitrate, timeRange) = try await (
                descriptionsValue,
                bitrateValue,
                timeRangeValue
            )

            let firstDescription = descriptions.first
            let audioDescription = firstDescription.flatMap {
                CMAudioFormatDescriptionGetStreamBasicDescription($0)
            }

            let sampleRate = audioDescription?.pointee.mSampleRate ?? 0
            let channelCount = Int(audioDescription?.pointee.mChannelsPerFrame ?? 0)

            let codec: String
            if let firstDescription {
                codec = codecName(
                    for: CMFormatDescriptionGetMediaSubType(firstDescription)
                )
            } else {
                codec = "Unknown"
            }

            let trackDuration = CMTimeGetSeconds(timeRange.duration)

            analyzedTracks.append(
                AudioTrackInfo(
                    id: track.trackID,
                    codec: codec,
                    sampleRate: sampleRate,
                    channelCount: channelCount,
                    estimatedBitrate: Double(max(0, bitrate)),
                    duration: trackDuration.isFinite ? trackDuration : duration
                )
            )
        }

        return VideoSource(
            displayName: displayName,
            localURL: url,
            duration: duration,
            audioTracks: analyzedTracks
        )
    }

    private func codecName(for code: FourCharCode) -> String {
        switch code {
        case kAudioFormatMPEG4AAC:
            return "AAC"
        case kAudioFormatAppleLossless:
            return "ALAC"
        case kAudioFormatLinearPCM:
            return "PCM"
        case kAudioFormatMPEGLayer3:
            return "MP3"
        default:
            let text = code.fourCCString
            return text.isEmpty ? "Unknown" : text.uppercased()
        }
    }
}

private extension FourCharCode {
    var fourCCString: String {
        let bytes: [UInt8] = [
            UInt8((self >> 24) & 0xff),
            UInt8((self >> 16) & 0xff),
            UInt8((self >> 8) & 0xff),
            UInt8(self & 0xff)
        ]

        return String(bytes: bytes, encoding: .macOSRoman)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    }
}
