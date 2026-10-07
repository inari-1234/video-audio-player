import './style.css';
import { extractAudioWithoutReencode, inspectAudio } from './media';

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
const player = byId<HTMLAudioElement>('player');
const downloadLink = byId<HTMLAnchorElement>('download-link');

let selectedFile: File | null = null;
let outputUrl: string | null = null;

function formatDuration(seconds: number) {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

function setMessage(text: string, isError = false) {
  message.textContent = text;
  message.classList.toggle('error', isError);
}

function configureMediaSession(title: string) {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title,
    artist: 'Video Audio PWA',
    album: '動画から抽出',
  });

  navigator.mediaSession.setActionHandler('play', () => void player.play());
  navigator.mediaSession.setActionHandler('pause', () => player.pause());
  navigator.mediaSession.setActionHandler('seekbackward', (details) => {
    player.currentTime = Math.max(0, player.currentTime - (details.seekOffset ?? 10));
  });
  navigator.mediaSession.setActionHandler('seekforward', (details) => {
    player.currentTime = Math.min(player.duration || Infinity, player.currentTime + (details.seekOffset ?? 10));
  });
  navigator.mediaSession.setActionHandler('seekto', (details) => {
    if (typeof details.seekTime === 'number') player.currentTime = details.seekTime;
  });
}

player.addEventListener('play', () => {
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
});
player.addEventListener('pause', () => {
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
});

input.addEventListener('change', async () => {
  selectedFile = input.files?.[0] ?? null;
  extractButton.disabled = true;
  playerCard.classList.add('hidden');
  progress.classList.add('hidden');
  progress.value = 0;
  setMessage('');

  if (outputUrl) {
    URL.revokeObjectURL(outputUrl);
    outputUrl = null;
  }

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
  if (!selectedFile) return;

  extractButton.disabled = true;
  progress.classList.remove('hidden');
  progress.value = 0;
  setMessage('再エンコードせず音声パケットをコピーしています…');

  try {
    const audioBlob = await extractAudioWithoutReencode(selectedFile, (value) => {
      progress.value = value;
    });

    if (outputUrl) URL.revokeObjectURL(outputUrl);
    outputUrl = URL.createObjectURL(audioBlob);
    player.src = outputUrl;

    const stem = selectedFile.name.replace(/\.[^.]+$/, '') || 'audio';
    downloadLink.href = outputUrl;
    downloadLink.download = `${stem}.m4a`;
    configureMediaSession(stem);

    progress.value = 1;
    playerCard.classList.remove('hidden');
    setMessage(`無変換抽出PASS · 出力 ${(audioBlob.size / 1024 / 1024).toFixed(1)} MB`);
  } catch (error) {
    setMessage(error instanceof Error ? error.message : '抽出に失敗しました。', true);
  } finally {
    extractButton.disabled = false;
  }
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js');
  });
}
