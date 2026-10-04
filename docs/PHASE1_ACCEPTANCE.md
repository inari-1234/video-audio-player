# Phase 1 — iOS Foundation + Video Import + Audio Analysis

## Acceptance gates
- P1-01: Select a video with PhotosPicker
- P1-02: Do not load the full movie into RAM as Data
- P1-03: Copy the received file into app-controlled storage
- P1-04: Detect audio tracks
- P1-05: Read codec
- P1-06: Read sample rate
- P1-07: Read channel count
- P1-08: Read estimated bitrate
- P1-09: Read duration
- P1-10: Report video-without-audio as a controlled error
- P1-11: Surface import / analysis failures to the UI
- P1-12: Never modify the source asset

Phase 1 is not COMPLETE until build CI and real-device checks are both passed.
