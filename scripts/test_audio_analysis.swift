import Foundation

@main
struct AudioAnalysisSmokeTest {
    static func main() async throws {
        guard CommandLine.arguments.count == 3 else {
            fputs("Usage: test_audio_analysis /path/to/stereo-aac.mov /path/to/no-audio.mov\n", stderr)
            exit(2)
        }

        let analyzer = AudioTrackAnalyzer()
        let positiveURL = URL(fileURLWithPath: CommandLine.arguments[1])
        let noAudioURL = URL(fileURLWithPath: CommandLine.arguments[2])

        let source = try await analyzer.analyze(
            url: positiveURL,
            displayName: positiveURL.lastPathComponent
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
        guard track.channelCount == 2 else {
            fatalError("Expected stereo fixture, got \(track.channelCount) channels")
        }
        guard track.estimatedBitrate > 0 else {
            fatalError("Expected positive bitrate, got \(track.estimatedBitrate)")
        }
        guard source.duration > 1.5 && source.duration < 2.5 else {
            fatalError("Unexpected duration: \(source.duration)")
        }

        print("Stereo AAC analysis: PASS")
        print("codec=\(track.codec) sampleRate=\(track.sampleRate) channels=\(track.channelCount) bitrate=\(track.estimatedBitrate) duration=\(source.duration)")

        do {
            _ = try await analyzer.analyze(
                url: noAudioURL,
                displayName: noAudioURL.lastPathComponent
            )
            fatalError("Expected noAudioTrack error for video without audio")
        } catch AudioAnalysisError.noAudioTrack {
            print("No-audio controlled rejection: PASS")
        } catch {
            fatalError("Expected noAudioTrack, got: \(error)")
        }
    }
}
