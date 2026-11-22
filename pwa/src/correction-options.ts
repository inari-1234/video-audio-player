// F0 feasibility only. Do not silently shorten a requested preview beyond the 30-minute cap.
export const MAX_CORRECTION_PREVIEW_SECONDS = 30 * 60;
export const CORRECTION_PREVIEW_CHOICES = [30, 60, 180, 300, 600, 1200, 1800] as const;

export function resolveCorrectionDuration(requestedSeconds: number, sourceSeconds?: number): number {
  if (!Number.isFinite(requestedSeconds) || !Number.isInteger(requestedSeconds) ||
      requestedSeconds < 1 || requestedSeconds > MAX_CORRECTION_PREVIEW_SECONDS) {
    throw new RangeError('音量補正F0の検証上限は30分（1800秒）です。');
  }
  if (sourceSeconds !== undefined && Number.isFinite(sourceSeconds) && sourceSeconds > 0) {
    return Math.min(requestedSeconds, sourceSeconds);
  }
  return requestedSeconds;
}
