export type LoudnormMeasurement = {
  inputI: number;
  inputTP: number;
  inputLRA: number;
  inputThresh: number;
  outputI: number;
  outputTP: number;
  outputLRA: number;
  outputThresh: number;
  normalizationType: 'linear' | 'dynamic' | 'unknown';
  targetOffset: number;
};

function finiteNumber(value: unknown, name: string): number {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`loudnorm ${name} が数値ではありません。`);
  return number;
}

export function parseLastLoudnormMeasurement(logText: string): LoudnormMeasurement {
  const matches = logText.match(/\{\s*"input_i"[\s\S]*?\}/g);
  if (!matches?.length) throw new Error('loudnormの測定JSONを取得できませんでした。');

  const raw = JSON.parse(matches[matches.length - 1]) as Record<string, unknown>;
  const normalizationRaw = String(raw.normalization_type ?? 'unknown').toLowerCase();
  const normalizationType = normalizationRaw === 'linear' || normalizationRaw === 'dynamic'
    ? normalizationRaw
    : 'unknown';

  return {
    inputI: finiteNumber(raw.input_i, 'input_i'),
    inputTP: finiteNumber(raw.input_tp, 'input_tp'),
    inputLRA: finiteNumber(raw.input_lra, 'input_lra'),
    inputThresh: finiteNumber(raw.input_thresh, 'input_thresh'),
    outputI: finiteNumber(raw.output_i, 'output_i'),
    outputTP: finiteNumber(raw.output_tp, 'output_tp'),
    outputLRA: finiteNumber(raw.output_lra, 'output_lra'),
    outputThresh: finiteNumber(raw.output_thresh, 'output_thresh'),
    normalizationType,
    targetOffset: finiteNumber(raw.target_offset, 'target_offset'),
  };
}

export type LoudnessTarget = {
  integrated: number;
  lra: number;
  truePeak: number;
};

export const F0_TARGET: LoudnessTarget = {
  integrated: -16,
  lra: 11,
  truePeak: -1.5,
};

function num(value: number) {
  return Number(value.toFixed(3)).toString();
}

export function buildMeasuredLoudnormFilter(
  measured: LoudnormMeasurement,
  target: LoudnessTarget = F0_TARGET,
) {
  return [
    'loudnorm=',
    `I=${num(target.integrated)}:`,
    `LRA=${num(target.lra)}:`,
    `TP=${num(target.truePeak)}:`,
    `measured_I=${num(measured.inputI)}:`,
    `measured_TP=${num(measured.inputTP)}:`,
    `measured_LRA=${num(measured.inputLRA)}:`,
    `measured_thresh=${num(measured.inputThresh)}:`,
    `offset=${num(measured.targetOffset)}:`,
    'linear=true:print_format=json',
  ].join('');
}

export function dbToLinear(db: number) {
  return 10 ** (db / 20);
}
