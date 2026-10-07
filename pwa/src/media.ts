import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
} from 'mediabunny';

export type AudioInfo = {
  codec: string;
  codecParameter: string | null;
  sampleRate: number;
  channels: number;
  bitrate: number | null;
  duration: number;
};

export class LosslessCopyUnavailableError extends Error {
  constructor(message = 'この音声は無変換ではM4Aへ抽出できません。') {
    super(message);
    this.name = 'LosslessCopyUnavailableError';
  }
}

function makeInput(blob: Blob) {
  return new Input({
    source: new BlobSource(blob),
    formats: ALL_FORMATS,
  });
}

export async function inspectAudio(blob: Blob): Promise<AudioInfo> {
  const input = makeInput(blob);
  const track = await input.getPrimaryAudioTrack();
  if (!track) throw new Error('この動画には音声トラックがありません。');

  const [codec, codecParameter, sampleRate, channels, bitrate, duration] = await Promise.all([
    track.getCodec(),
    track.getCodecParameterString(),
    track.getSampleRate(),
    track.getNumberOfChannels(),
    track.getAverageBitrate(),
    track.computeDuration(),
  ]);

  return {
    codec: codec ?? 'unknown',
    codecParameter,
    sampleRate,
    channels,
    bitrate,
    duration,
  };
}

export async function extractAudioWithoutReencode(
  blob: Blob,
  onProgress?: (progress: number) => void,
): Promise<Blob> {
  const input = makeInput(blob);
  const audioTrack = await input.getPrimaryAudioTrack();
  if (!audioTrack) throw new Error('この動画には音声トラックがありません。');

  const target = new BufferTarget();
  const output = new Output({
    format: new Mp4OutputFormat(),
    target,
  });

  const conversion = await Conversion.init({
    input,
    output,
    tracks: 'primary',
    video: { discard: true },
    copy: { mode: 'forced' },
    showWarnings: false,
  });

  const audioWasDiscarded = conversion.discardedTracks.some(
    ({ track }) => track.type === 'audio',
  );
  const audioIsUtilized = conversion.utilizedTracks.some(
    (track) => track.type === 'audio',
  );

  if (!conversion.isValid || audioWasDiscarded || !audioIsUtilized) {
    throw new LosslessCopyUnavailableError();
  }

  conversion.onProgress = (progress) => onProgress?.(progress);
  await conversion.execute();

  if (!target.buffer) {
    throw new Error('抽出結果を生成できませんでした。');
  }

  return new Blob([target.buffer], { type: 'audio/mp4' });
}
