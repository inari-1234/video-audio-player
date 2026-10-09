import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
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

export async function runCorrectionF0(
  source: Blob,
  options: { sampleRate: number; channels: number; previewSeconds?: number },
): Promise<CorrectionF0Result> {
  if (source.size > MAX_F0_INPUT_BYTES) {
    throw new Error('F0検証は入力80MB以下に制限しています。30〜60秒程度の音源で確認してください。');
  }
  if (options.channels !== 1 && options.channels !== 2) {
    throw new Error('F0検証はMono/Stereoのみ対象です。');
  }

  const totalStarted = performance.now();
  const engineLoadMs = await loadCorrectionEngine();
  const probe = await probeRequiredFilters();
  const token = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const inputName = `correction-${token}-input.m4a`;
  const outputName = `correction-${token}-output.m4a`;
  const previewSeconds = Math.max(5, Math.min(options.previewSeconds ?? 30, 60));
  const bitrate = options.channels === 1 ? 128_000 : 256_000;

  try {
    await ffmpeg.writeFile(inputName, await fetchFile(source));

    const inputMeasureRun = await execCapture([
      '-i', inputName,
      '-t', String(previewSeconds),
      '-vn',
      '-af', measurementFilter(),
      '-f', 'null', '-',
    ]);
    const inputMeasure = parseLastLoudnormMeasurement(inputMeasureRun.text);

    const prefilter = naturalPrefilter();
    const processedMeasureRun = await execCapture([
      '-i', inputName,
      '-t', String(previewSeconds),
      '-vn',
      '-af', `${prefilter},${measurementFilter()}`,
      '-f', 'null', '-',
    ]);
    const processedMeasure = parseLastLoudnormMeasurement(processedMeasureRun.text);

    const secondPassLoudnorm = buildMeasuredLoudnormFilter(processedMeasure);
    const encodeRun = await execCapture([
      '-i', inputName,
      '-t', String(previewSeconds),
      '-vn',
      '-af', `${prefilter},${secondPassLoudnorm},aresample=${options.sampleRate},${limiterFilter(F0_TARGET.truePeak)}`,
      '-c:a', 'aac',
      '-b:a', String(bitrate),
      '-ar', String(options.sampleRate),
      '-ac', String(options.channels),
      outputName,
    ]);
    const secondPass = parseLastLoudnormMeasurement(encodeRun.text);

    const verifyRun = await execCapture([
      '-i', outputName,
      '-vn',
      '-af', measurementFilter(),
      '-f', 'null', '-',
    ]);
    const outputMeasure = parseLastLoudnormMeasurement(verifyRun.text);

    const data = await ffmpeg.readFile(outputName);
    if (typeof data === 'string') throw new Error('補正版AACをバイナリとして取得できませんでした。');
    const output = new Blob([data.slice().buffer], { type: 'audio/mp4' });

    return {
      output,
      input: inputMeasure,
      preNormalize: processedMeasure,
      outputMeasure,
      secondPass,
      normalizationType: secondPass.normalizationType,
      filters: probe.filters,
      timings: {
        engineLoadMs,
        filterProbeMs: probe.ms,
        inputMeasureMs: inputMeasureRun.ms,
        processedMeasureMs: processedMeasureRun.ms,
        encodeMs: encodeRun.ms,
        verifyMs: verifyRun.ms,
        totalMs: performance.now() - totalStarted,
      },
      sampleRate: options.sampleRate,
      channels: options.channels,
      bitrate,
      previewSeconds,
      gatePass: outputMeasure.inputTP <= F0_TARGET.truePeak + 0.05,
    };
  } finally {
    await Promise.all([deleteIfExists(inputName), deleteIfExists(outputName)]);
  }
}
