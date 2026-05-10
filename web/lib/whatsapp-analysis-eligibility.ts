export type AnalysisThreadTiming = {
  last_analyzed_at: string | null;
  extraction_watermark_at: string | null;
  last_message_at: string | null;
};

/**
 * Analyze is blocked until newer customer messages arrive (or the merchant resets analysis).
 */
export function canAnalyzeThreadState(timing: AnalysisThreadTiming): boolean {
  if (!timing.last_analyzed_at) return true;

  const lastMsg = timing.last_message_at?.trim()
    ? Date.parse(timing.last_message_at)
    : NaN;
  const watermark = timing.extraction_watermark_at?.trim()
    ? Date.parse(timing.extraction_watermark_at)
    : NaN;

  if (!Number.isFinite(lastMsg)) {
    return false;
  }

  if (!timing.extraction_watermark_at?.trim()) {
    return true;
  }

  if (!Number.isFinite(watermark)) return true;

  return lastMsg > watermark;
}
