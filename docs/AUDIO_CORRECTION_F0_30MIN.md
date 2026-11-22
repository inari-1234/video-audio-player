# Audio Correction F0 — 30-minute feasibility

Branch: `candidate/audio-correction-f0-30min`

User goal: evaluate gradual loudness variation throughout a parade recording, with a selectable maximum of 30 minutes.

## Scope
- Preview choices: 30 sec, 60 sec, 3, 5, 10, 20, 30 min. Longer requests fail explicitly.
- If input audio is shorter than selected duration, process to the audio end.
- Preserve original AAC and persistent library. Preview only, no overwrite or save.
- Continue original/loudnorm-preprocessed/2-pass normalization/AAC re-decode TP measurement.
- iPhone PWA: keep foreground during testing; terminate button frees FFmpeg worker memory.
- Input AUDIO blob still limited to 80 MiB. This is NOT 30-minute reliability certification.
- Single-thread FFmpeg.wasm MEMFS may crash on low-memory devices. Advance duration gradually.
- Validate 30-second F0, then 3/5/10/20/30-minute durations with an actual parade recording.
- Record total time, encode time, LUFS, true peak, normalization type and whether the PWA stayed alive.
- No production promotion on CI alone; real-iPhone 30-minute gate remains pending.

## Regression gates
- TypeScript/typecheck; IndexedDB CRUD; correct 1800-second boundary and shorter-source clipping.
- FFmpeg filter probe and chain -> AAC; unchanged-packet identity of original extraction.
- Candidate CI success and Pages deploy. A real iPhone must separately pass a full-length run.
