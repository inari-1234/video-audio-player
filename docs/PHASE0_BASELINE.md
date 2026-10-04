# Phase 0 Baseline — FROZEN

## Product goal
Extract audio from videos on iPhone with quality preservation as the first priority, store the result locally, and later support background / lock-screen playback.

## Technical baseline
- Native iPhone app
- Swift + SwiftUI
- PhotosPicker / Transferable
- AVFoundation
- MediaPlayer in a later playback phase
- Local-first processing
- Never modify the source video

## Quality principle
If the original audio stream can be extracted without transcoding, do not re-encode it.
