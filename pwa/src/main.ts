import './style.css';
import { extractAudioWithoutReencode, inspectAudio, type AudioInfo } from './media';
import {
  deleteLibraryTrack,
  getLibraryAudio,
  getStorageUsage,
  listLibraryTracks,
  renameLibraryTrack,
  requestPersistentStorage,
  saveLibraryTrack,
  type LibraryTrackMeta,
} from './library';

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const input = byId<HTMLInputElement>('video-input');
const fileName = byId<HTMLParagraphElement>('file-name');
const analysisCard = byId<HTMLElement>('analysis-card');
const analysisStatus = byId<HTMLSpanElement>('analysis-status');
const codec = byId<HTMLElement>('codec');
const sampleRate = byId<HTMLElement>('sample-rate');
const channels = byId<HTMLElement>('channels');
const bitrate = byId<HTMLElement>('bitrate');
const duration = byId<HTMLElement>('duration');
const extractButton = byId<HTMLButtonElement>('extract-button');
const progress = byId<HTMLProgressElement>('progress');
const message = byId<HTMLParagraphElement>('message');
const playerCard = byId<HTMLElement>('player-card');
const playerTitle = byId<HTMLElement>('player-title');
const player = byId<HTMLAudioElement>('player');
const downloadLink = byId<HTMLAnchorElement>('download-link');
const libraryCount = byId<HTMLElement>('library-count');
const libraryEmpty = byId<HTMLElement>('library-empty');
const libraryList = byId<HTMLElement>('library-list');
const storageStatus = byId<HTMLElement>('storage-status');

let selectedFile: File | null = null;
let selectedInfo: AudioInfo | null = null;
let outputUrl: string | null = null;
let currentTrackId: string | null = null;

function formatDuration(seconds: number) {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

function formatBytes(bytes: number | null) {
  if (bytes == null) return '不明';
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function setMessage(text: string, isError = false) {
  message.textContent = text;
  message.classList.toggle('error', isError);
}

function makeTrackId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function safeFileName(title: string) {
  const normalized = title.replace(/[\\/:*?"<>|]/g, '_').trim();
  return `${normalized || 'audio'}.m4a`;
}

function configureMediaSession(title: string) {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title,
    artist: 'Video Audio',
    album: 'ローカル音源ライブラリ',
  });

  const actions: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
    ['play', () => void player.play()],
    ['pause', () => player.pause()],
    ['seekbackward', (details) => {
      player.currentTime = Math.max(0, player.currentTime - (details.seekOffset ?? 10));
    }],
    ['seekforward', (details) => {
      player.currentTime = Math.min(player.duration || Infinity, player.currentTime + (details.seekOffset ?? 10));
    }],
    ['seekto', (details) => {
      if (typeof details.seekTime === 'number') player.currentTime = details.seekTime;
    }],
  ];

  for (const [action, handler] of actions) {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch {
      // Unsupported actions are optional; playback itself remains available.
    }
  }
}

function setPlayerSource(blob: Blob, title: string, trackId: string | null) {
  player.pause();
  if (outputUrl) URL.revokeObjectURL(outputUrl);
  outputUrl = URL.createObjectURL(blob);
  currentTrackId = trackId;
  player.src = outputUrl;
  playerTitle.textContent = title;
  downloadLink.href = outputUrl;
  downloadLink.download = safeFileName(title);
  configureMediaSession(title);
  playerCard.classList.remove('hidden');
}

async function refreshStorageStatus() {
  try {
    const [persistent, estimate] = await Promise.all([
      requestPersistentStorage(),
      getStorageUsage(),
    ]);
    const persistenceLabel = persistent === true ? '永続保存: 有効' : persistent === false ? '永続保存: 端末管理' : '永続保存: 判定不可';
    storageStatus.textContent = `${persistenceLabel} · 使用 ${formatBytes(estimate.usage)} / 上限 ${formatBytes(estimate.quota)}`;
  } catch {
    storageStatus.textContent = '保存領域の状態を取得できませんでした。';
  }
}

function makeButton(label: string, className: string, onClick: () => void | Promise<void>) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.className = className;
  button.addEventListener('click', () => void onClick());
  return button;
}

async function playLibraryTrack(track: LibraryTrackMeta) {
  const blob = await getLibraryAudio(track.id);
  setPlayerSource(blob, track.title, track.id);
  try {
    await player.play();
  } catch {
    // iOS may require a second explicit tap on the native audio control.
  }
}

async function renameTrack(track: LibraryTrackMeta) {
  const nextTitle = window.prompt('音源名を変更', track.title);
  if (nextTitle == null || nextTitle.trim() === track.title) return;
  await renameLibraryTrack(track.id, nextTitle);
  if (currentTrackId === track.id) {
    playerTitle.textContent = nextTitle.trim();
    downloadLink.download = safeFileName(nextTitle.trim());
    configureMediaSession(nextTitle.trim());
  }
  await renderLibrary();
}

async function removeTrack(track: LibraryTrackMeta) {
  if (!window.confirm(`「${track.title}」を削除しますか？`)) return;
  await deleteLibraryTrack(track.id);
  if (currentTrackId === track.id) {
    player.pause();
    player.removeAttribute('src');
    player.load();
    if (outputUrl) URL.revokeObjectURL(outputUrl);
    outputUrl = null;
    currentTrackId = null;
    playerCard.classList.add('hidden');
  }
  await Promise.all([renderLibrary(), refreshStorageStatus()]);
}

async function renderLibrary() {
  const tracks = await listLibraryTracks();
  libraryList.replaceChildren();
  libraryCount.textContent = `${tracks.length}件`;
  libraryEmpty.classList.toggle('hidden', tracks.length > 0);

  for (const track of tracks) {
    const row = document.createElement('article');
    row.className = 'track-row';

    const details = document.createElement('div');
    details.className = 'track-details';

    const title = document.createElement('strong');
    title.textContent = track.title;

    const meta = document.createElement('span');
    meta.textContent = `${formatDuration(track.duration)} · ${track.codec.toUpperCase()} · ${(track.sampleRate / 1000).toFixed(track.sampleRate % 1000 === 0 ? 0 : 1)} kHz · ${track.channels === 2 ? 'Stereo' : `${track.channels}ch`} · ${formatBytes(track.size)}`;

    const origin = document.createElement('span');
    origin.textContent = `元: ${track.originalName} · 無変換抽出`;

    details.append(title, meta, origin);

    const actions = document.createElement('div');
    actions.className = 'track-actions';
    actions.append(
      makeButton('再生', 'mini primary', () => playLibraryTrack(track)),
      makeButton('名前変更', 'mini secondary', () => renameTrack(track)),
      makeButton('削除', 'mini danger', () => removeTrack(track)),
    );

    row.append(details, actions);
    libraryList.append(row);
  }
}

player.addEventListener('play', () => {
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
});
player.addEventListener('pause', () => {
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
});

input.addEventListener('change', async () => {
  selectedFile = input.files?.[0] ?? null;
  selectedInfo = null;
  extractButton.disabled = true;
  progress.classList.add('hidden');
  progress.value = 0;
  setMessage('');

  if (!selectedFile) {
    fileName.textContent = '未選択';
    analysisCard.classList.add('hidden');
    return;
  }

  fileName.textContent = `${selectedFile.name} · ${(selectedFile.size / 1024 / 1024).toFixed(1)} MB`;
  analysisCard.classList.remove('hidden');
  analysisStatus.textContent = '解析中';
  analysisStatus.classList.remove('success');

  try {
    const info = await inspectAudio(selectedFile);
    selectedInfo = info;
    codec.textContent = info.codecParameter ?? info.codec.toUpperCase();
    sampleRate.textContent = `${(info.sampleRate / 1000).toFixed(info.sampleRate % 1000 === 0 ? 0 : 1)} kHz`;
    channels.textContent = info.channels === 1 ? 'Mono' : info.channels === 2 ? 'Stereo' : `${info.channels} ch`;
    bitrate.textContent = info.bitrate ? `${Math.round(info.bitrate / 1000)} kbps` : 'Unknown';
    duration.textContent = formatDuration(info.duration);
    analysisStatus.textContent = '解析完了';
    analysisStatus.classList.add('success');
    extractButton.disabled = false;
  } catch (error) {
    analysisStatus.textContent = '解析失敗';
    setMessage(error instanceof Error ? error.message : '解析に失敗しました。', true);
  }
});

extractButton.addEventListener('click', async () => {
  if (!selectedFile || !selectedInfo) return;

  extractButton.disabled = true;
  progress.classList.remove('hidden');
  progress.value = 0;
  setMessage('再エンコードせず音声パケットをコピーしています…');

  try {
    const sourceFile = selectedFile;
    const sourceInfo = selectedInfo;
    const audioBlob = await extractAudioWithoutReencode(sourceFile, (value) => {
      progress.value = value;
    });

    const stem = sourceFile.name.replace(/\.[^.]+$/, '') || 'audio';
    const id = makeTrackId();
    const track: LibraryTrackMeta = {
      id,
      title: stem,
      originalName: sourceFile.name,
      createdAt: Date.now(),
      duration: sourceInfo.duration,
      codec: sourceInfo.codecParameter ?? sourceInfo.codec,
      sampleRate: sourceInfo.sampleRate,
      channels: sourceInfo.channels,
      bitrate: sourceInfo.bitrate,
      size: audioBlob.size,
      extractionMode: 'passthrough',
    };

    setPlayerSource(audioBlob, stem, id);

    try {
      await saveLibraryTrack(track, audioBlob);
      progress.value = 1;
      setMessage(`無変換抽出・ライブラリ保存PASS · ${formatBytes(audioBlob.size)}`);
      await Promise.all([renderLibrary(), refreshStorageStatus()]);
    } catch (storageError) {
      setMessage(
        `抽出は成功しましたがライブラリ保存に失敗しました。ファイル保存を利用してください。${storageError instanceof Error ? ` (${storageError.message})` : ''}`,
        true,
      );
    }
  } catch (error) {
    setMessage(error instanceof Error ? error.message : '抽出に失敗しました。', true);
  } finally {
    extractButton.disabled = false;
  }
});

async function initialize() {
  await Promise.all([renderLibrary(), refreshStorageStatus()]);
}

void initialize().catch((error) => {
  storageStatus.textContent = error instanceof Error ? error.message : '音源ライブラリを読み込めませんでした。';
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('./sw.js');
  });
}
