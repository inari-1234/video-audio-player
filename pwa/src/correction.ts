import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { resolveCorrectionDuration } from './correction-options';
import {
  F0_TARGET,
  buildMeasuredLoudnormFilter,
  dbToLinear,
  parseLastLoudnormMeasurement,
  type LoudnormMeasurement,
} from './loudness';

const CORE_BASE_URL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm';
const REQUIRED_FILTERS = ['dynaudnorm', 'acompressor', 'loudnorm', 'aresample', 'alimiter'] as const;
const MAX_F0_INPUT_BYTES = 80 * 1024 * 1024;

const ffmpeg = new FFmpeg();
let correctionRunning = false;
let correctionCancelled = false;
let loadPromise: Promise<void> | null = null;
let logSink: string[] | null = null;

ffmpeg.on('log', ({ message }) => {
  logSink?.push(message);
});

export type CorrectionStageTiming = {
  engineLoadMs: number;
  filterProbeMs: number;
  inputMeasureMs: number;
  processedMeasureMs: number;
  encodeMs: number;
  verifyMs: number;
  totalMs: number;
};

export type CorrectionF0Result = {
  output: Blob;
  input: LoudnormMeasurement;
  preNormalize: LoudnormMeasurement;
  outputMeasure: LoudnormMeasurement;
  secondPass: LoudnormMeasurement;
  normalizationType: LoudnormMeasurement['normalizationType'];
  filters: Record<(typeof REQUIRED_FILTERS)[number], boolean>;
  timings: CorrectionStageTiming;
  sampleRate: number;
  channels: number;
  bitrate: number;
  previewSeconds: number;
  gatePass: boolean;
};

export async function loadCorrectionEngine(): Promise<number> {
  if (ffmpeg.loaded) return 0;
  if (!loadPromise) {
    const started = performance.now();
    loadPromise = (async () => {
      const coreURL = await toBlobURL(`${CORE_BASE_URL}/ffmpeg-core.js`, 'text/javascript');
      const wasmURL = await toBlobURL(`${CORE_BASE_URL}/ffmpeg-core.wasm`, 'application/wasm');
      await ffmpeg.load({ coreURL, wasmURL });
    })().catch((error) => {
      loadPromise = null;
      throw error;
    });
    await loadPromise;
    return performance.now() - started;
  }
  await loadPromise;
  return 0;
}

async function execCapture(args: string[]) {
  const logs: string[] = [];
  logSink = logs;
  const started = performance.now();
  try {
    const code = await ffmpeg.exec(args);
    const text = logs.join('\n');
    if (code !== 0) throw new Error(`ffmpeg.wasmが終了コード${code}で失敗しました。\n${text.slice(-1200)}`);
    return { text, ms: performance.now() - started };
  } finally {
    logSink = null;
  }
}

async function probeRequiredFilters() {
  const result = await execCapture(['-filters']);
  const filters = Object.fromEntries(
    REQUIRED_FILTERS.map((filter) => [filter, new RegExp(`\\b${filter}\\b`).test(result.text)]),
  ) as Record<(typeof REQUIRED_FILTERS)[number], boolean>;

  const missing = REQUIRED_FILTERS.filter((filter) => !filters[filter]);
  if (missing.length) throw new Error(`補正に必要なFFmpegフィルターがありません: ${missing.join(', ')}`);
  return { filters, ms: result.ms };
}

function naturalPrefilter() {
  // maxgain=2.0 limits slow gain lift to about +6 dB; threshold avoids aggressively lifting the noise floor.
  return [
    'dynaudnorm=f=1000:g=31:p=0.95:m=2.0:t=0.02:n=1',
    'acompressor=threshold=0.125:ratio=1.5:attack=20:release=250:makeup=1',
  ].join(',');
}

function measurementFilter(truePeak = F0_TARGET.truePeak) {
  return `loudnorm=I=${F0_TARGET.integrated}:LRA=${F0_TARGET.lra}:TP=${truePeak}:print_format=json`;
}

function limiterFilter(truePeak: number) {
  return `alimiter=limit=${dbToLinear(truePeak).toFixed(6)}:attack=5:release=50:level=0`;
}

async function deleteIfExists(path: string) {
  try {
    await ffmpeg.deleteFile(path);
  } catch {
    // Cleanup is best-effort and must not mask the measured result.
  }
}

// terminate() rejects pending operations and releases the WASM worker. The next run reloads it.
export function cancelCorrectionF0(): boolean {
  if (!correctionRunning || correctionCancelled) return false;
  correctionCancelled = true;
  ffmpeg.terminate();
  loadPromise = null;
  return true;
}

function assertNotCancelled(): void {
  if (correctionCancelled) throw new Error('音量補正検証を中断しました。');
}

export async function runCorrectionF0(
  source: Blob,
  options: {
    sampleRate: number;
    channels: number;
    previewSeconds?: number;
    sourceDuration?: number;
    onStage?: (stage: string) => void;
  },
): Promise<CorrectionF0Result> {
  if (correctionRunning) throw new Error('別の音量補正検証を実行中です。');
  const previewSeconds = resolveCorrectionDuration(options.previewSeconds ?? 30, options.sourceDuration);
  if (source.size > MAX_F0_INPUT_BYTES) {
    throw new Error('メモリ保護のためF0の入力音源は80MB以下に制限しています。30分に設定してもこの制限は変わりません。');
  }
  if (options.channels !== 1 && options.channels !== 2) {
    throw new Error('F0検証はMono/Stereoのみ対象です。');
  }
  correctionRunning = true;
  correctionCancelled = false;
  const totalStarted = performance.now();
  const bitrate = options.channels === 1 ? 128_000 : 256_000;
  let inputName: string | null = null;
  let outputName: string | null = null;
  const stage = (label: string) => { assertNotCancelled(); options.onStage?.(label); };

  try {
    stage('FFmpeg core読込');
    const engineLoadMs = await loadCorrectionEngine();
    assertNotCancelled();
    stage('必要フィルター確認');
    const probe = await probeRequiredFilters();
    assertNotCancelled();
    const token = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    inputName = `correction-${token}-input.m4a`;
    outputName = `correction-${token}-output.m4a`;

    stage('入力音源をメモリに読み込み');
    const bytes = await fetchFile(source);
    assertNotCancelled();
    await ffmpeg.writeFile(inputName, bytes);
    assertNotCancelled();

    stage('原音ラウドネス測定（1/4）');
    const inputMeasureRun = await execCapture([
      '-i', inputName, '-t', String(previewSeconds), '-vn',
      '-af', measurementFilter(), '-f', 'null', '-',
    ]);
    assertNotCancelled();
    const inputMeasure = parseLastLoudnormMeasurement(inputMeasureRun.text);

    stage('前段処理後ラウドネス測定（2/4）');
    const prefilter = naturalPrefilter();
    const processedMeasureRun = await execCapture([
      '-i', inputName, '-t', String(previewSeconds), '-vn',
      '-af', `${prefilter},${measurementFilter()}`, '-f', 'null', '-',
    ]);
    assertNotCancelled();
    const processedMeasure = parseLastLoudnormMeasurement(processedMeasureRun.text);

    stage('2-pass正規化・AAC生成（3/4）');
    const secondPassLoudnorm = buildMeasuredLoudnormFilter(processedMeasure);
    const encodeRun = await execCapture([
      '-i', inputName, '-t', String(previewSeconds), '-vn',
      '-af', `${prefilter},${secondPassLoudnorm},aresample=${options.sampleRate},${limiterFilter(F0_TARGET.truePeak)}`,
      '-c:a', 'aac', '-b:a', String(bitrate),
      '-ar', String(options.sampleRate), '-ac', String(options.channels),
      outputName,
    ]);
    assertNotCancelled();
    const secondPass = parseLastLoudnormMeasurement(encodeRun.text);

    stage('生成AACのTrue Peak再測定（4/4）');
    const verifyRun = await execCapture([
      '-i', outputName, '-vn', '-af', measurementFilter(), '-f', 'null', '-',
    ]);
    assertNotCancelled();
    const outputMeasure = parseLastLoudnormMeasurement(verifyRun.text);

    stage('プレビュー音源を読み出し');
    const data = await ffmpeg.readFile(outputName);
    assertNotCancelled();
    if (typeof data === 'string') throw new Error('補正版AACをバイナリとして取得できませんでした。');
    const output = new Blob([data.slice().buffer], { type: 'audio/mp4' });

    return {
      output, input: inputMeasure, preNormalize: processedMeasure, outputMeasure,
      secondPass, normalizationType: secondPass.normalizationType, filters: probe.filters,
      timings: {
        engineLoadMs, filterProbeMs: probe.ms, inputMeasureMs: inputMeasureRun.ms,
        processedMeasureMs: processedMeasureRun.ms, encodeMs: encodeRun.ms,
        verifyMs: verifyRun.ms, totalMs: performance.now() - totalStarted,
      },
      sampleRate: options.sampleRate, channels: options.channels, bitrate, previewSeconds,
      gatePass: outputMeasure.inputTP <= F0_TARGET.truePeak + 0.05,
    };
  } catch (error) {
    if (correctionCancelled) throw new Error('音量補正検証を中断しました。原音とライブラリは変更されていません。');
    throw error;
  } finally {
    if (correctionCancelled) {
      ffmpeg.terminate();
      loadPromise = null;
    } else if (inputName && outputName) {
      await Promise.all([deleteIfExists(inputName), deleteIfExists(outputName)]);
    }
    correctionRunning = false;
    correctionCancelled = false;
  }
}
