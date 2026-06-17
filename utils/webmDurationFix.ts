import fixWebmDurationLib from 'fix-webm-duration';

/**
 * Patches WebM blobs from MediaRecorder with a seekable Duration element.
 */
export async function fixWebmDuration(blob: Blob, durationMs: number): Promise<Blob> {
  if (!blob.type.includes('webm')) {
    return blob;
  }

  try {
    return await fixWebmDurationLib(blob, durationMs, { logger: false });
  } catch (err) {
    console.warn('WebM duration fix failed, returning original blob:', err);
    return blob;
  }
}
