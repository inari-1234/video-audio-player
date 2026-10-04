import Foundation

struct VideoSource: Sendable {
    let displayName: String
    let localURL: URL
    let duration: Double
    let audioTracks: [AudioTrackInfo]
}
