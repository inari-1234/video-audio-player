import Foundation

@main
struct AudioAnalysisSmokeTest {
    static func main() async throws {
        guard CommandLine.arguments.count == 2 else {
            fputs("Usage: test_audio_analysis /path/to/fixture.mov\n", stderr)
            exit(2)
        }

        let url = URL(fileURLWithPath: CommandLine.arguments[1])
        let source = try await AudioTrackAnalyzer().analyze(
            url: url,
            displayName: url.lastPathComponent
        )

        guard source.audioTracks.count == 1 else {
            fatalError("Expected exactly one audio track, got \(source.audioTracks.count)")
        }

        let track = source.audioTracks[0]
        guard track.codec == "AAC" else {
            fatalError("Expected AAC codec, got \(track.codec)")
        }
        guard abs(track.sampleRate - 48_000) < 1 else {
            fatalError("Expected 48 kHz, got \(track.sampleRate)")
        }
        guard track.channelCount == 1 else {
            fatalError("Expected mono fixture, got \(track.channelCount) channels")
        }
        guard track.estimatedBitrate > 0 else {
            fatalError("Expected positive bitrate, got \(track.estimatedBitrate)")
        }
        guard source.duration > 1.5 && source.duration < 2.5 else {
            fatalError("Unexpected duration: \(source.duration)")
        }

        print("Audio analysis smoke test: PASS")
        print("codec=\(track.codec) sampleRate=\(track.sampleRate) channels=\(track.channelCount) bitrate=\(track.estimatedBitrate) duration=\(source.duration)")
    }
}
