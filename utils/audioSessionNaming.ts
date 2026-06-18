/**
 * Naming helpers for native audio virtual sinks.
 * The extension decides the human-readable session name from the capture source;
 * the PulseAudio sink_name is a sanitized slug derived from that label.
 */

const MAX_SESSION_NAME_LEN = 64;
const MAX_SINK_SLUG_LEN = 48;

/** Strip diacritics and collapse to a PulseAudio-safe sink_name slug. */
export function deriveSinkName(sessionName: string): string {
  const slug = sessionName
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, MAX_SINK_SLUG_LEN);
  return `dzi_${slug || 'rec'}`;
}

/**
 * Build the display name Chrome should show for the virtual capture device.
 * Derived from the selected capture target (window title, screen, tab).
 */
export function deriveSessionName(surface: string, videoTrackLabel?: string): string {
  if (surface === 'monitor') return 'Entire Screen';

  if (videoTrackLabel) {
    const label = videoTrackLabel.trim();
    // Chrome sometimes returns opaque ids like "window:123:0" — ignore those.
    if (label && !/^window:\d+/i.test(label)) {
      return label.slice(0, MAX_SESSION_NAME_LEN);
    }
  }

  if (surface === 'window') return 'Application Window';
  if (surface === 'browser') return 'Browser Tab';
  return 'Recording';
}

/** Opaque Chrome window id from getDisplayMedia (not a human title). */
export function isOpaqueWindowLabel(label: string): boolean {
  return /^window:\d+/i.test(label.trim());
}

/** Silent remap device on some PipeWire setups — never record from this label. */
export function isAvoidDeviceLabel(label: string, sessionName: string): boolean {
  const l = label.toLowerCase();
  const s = sessionName.toLowerCase();
  if (!l.includes(s) && !l.includes('dzi')) return false;
  return l.startsWith('mirror of ');
}

/** Score an audioinput label for the mirrored virtual sink (session + PulseAudio slug). */
export function scoreDeviceLabel(
  label: string,
  sessionName: string,
  sinkName?: string
): number {
  const l = label.toLowerCase();
  const s = sessionName.toLowerCase();
  const slug = (sinkName ?? '').toLowerCase().replace(/^dzi_/, '');

  if (isAvoidDeviceLabel(label, sessionName)) return 5;

  if (l === s) return 100;
  if (sinkName && l.includes(sinkName.toLowerCase())) return 95;
  if (slug && l.includes(slug)) return 90;
  if (l.startsWith('monitor of ') && l.includes(s)) return 80;
  if (l.includes(s) && !l.includes('mirror of')) return 85;
  if (l.includes(s)) return 55;
  if (sinkName && l.includes('dzi') && !l.includes('mirror of') && !l.includes('monitor of')) return 45;
  if (l.includes('dzi') && !l.includes('mirror of') && !l.includes('monitor of')) return 40;
  if (l.includes('dzi')) return 15;
  return 0;
}
