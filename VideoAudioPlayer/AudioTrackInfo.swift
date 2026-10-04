import Foundation

struct AudioTrackInfo: Identifiable, Equatable, Sendable {
    let id: Int32
    let codec: String
    let sampleRate: Double
    let channelCount: Int
    let estimatedBitrate: Double
    let duration: Double

    var channelDescription: String {
        switch channelCount {
        case 1: return "Mono"
        case 2: return "Stereo"
        case let value where value > 2: return "\(value) ch"
        default: return "Unknown"
        }
    }

    var bitrateDescription: String {
        guard estimatedBitrate > 0 else { return "Unknown" }
        return "\(Int((estimatedBitrate / 1_000).rounded())) kbps"
    }

    var sampleRateDescription: String {
        guard sampleRate > 0 else { return "Unknown" }
        let value = sampleRate / 1_000
        if value.rounded() == value {
            return "\(Int(value)) kHz"
        }
        return String(format: "%.1f kHz", value)
    }
}
