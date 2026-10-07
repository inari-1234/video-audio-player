import 'fake-indexeddb/auto';
import {
  deleteLibraryTrack,
  getLibraryAudio,
  listLibraryTracks,
  renameLibraryTrack,
  saveLibraryTrack,
  type LibraryTrackMeta,
} from '../src/library';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const id = 'test-track-001';
const blob = new Blob(['audio-payload'], { type: 'audio/mp4' });
const meta: LibraryTrackMeta = {
  id,
  title: 'Original title',
  originalName: 'fixture.mov',
  createdAt: 1_700_000_000_000,
  duration: 3,
  codec: 'aac',
  sampleRate: 48_000,
  channels: 2,
  bitrate: 192_000,
  size: blob.size,
  extractionMode: 'passthrough',
};

await saveLibraryTrack(meta, blob);

let tracks = await listLibraryTracks();
assert(tracks.length === 1, `expected 1 track after save, got ${tracks.length}`);
assert(tracks[0]?.title === 'Original title', 'saved metadata mismatch');
assert(tracks[0]?.extractionMode === 'passthrough', 'extraction provenance mismatch');

const restoredBlob = await getLibraryAudio(id);
assert(restoredBlob.type === 'audio/mp4', `unexpected blob type: ${restoredBlob.type}`);
assert((await restoredBlob.text()) === 'audio-payload', 'stored Blob payload mismatch');

await renameLibraryTrack(id, 'Renamed title');
tracks = await listLibraryTracks();
assert(tracks[0]?.title === 'Renamed title', 'rename did not persist');

await deleteLibraryTrack(id);
tracks = await listLibraryTracks();
assert(tracks.length === 0, `expected 0 tracks after delete, got ${tracks.length}`);

let missingBlobRejected = false;
try {
  await getLibraryAudio(id);
} catch {
  missingBlobRejected = true;
}
assert(missingBlobRejected, 'deleted audio Blob remained readable');

console.log('PWA library IndexedDB smoke test: PASS');
