/**
 * NativeAudioBridge — typed client for the Virtual-EXT Record native messaging host
 * (native-helper/host.js).
 *
 * Uses a PERSISTENT port (`chrome.runtime.connectNative`) rather than one-shot
 * `sendNativeMessage`, because the mirror links must live for the whole
 * recording session. When the port disconnects (recording stops, or the
 * extension context is torn down) the host tears the mirror links down too — a
 * clean, leak-free lifecycle.
 */

export const NATIVE_HOST_NAME = 'com.virtual_ext.record_audio';

export interface NativeError {
  code: string;
  message: string;
  details?: unknown;
}

interface NativeEnvelope<T = unknown> {
  ok: boolean;
  requestId?: number | string | null;
  action?: string;
  data?: T;
  error?: NativeError;
}

export interface AudioApplication {
  pid: number | null;
  nodeId: number;
  name: string;
  binary: string;
  media: string;
}

export interface VirtualDeviceInfo {
  sink: string;
  monitorSource: string;
  description: string;
  chromeLabelHint: string;
  moduleId: number | null;
  pulseSources?: Array<{ index: number; name: string; driver: string; state: string }>;
}

/**
 * Response from prepareApplicationAudio — authoritative capture identifiers
 * for Chrome getUserMedia (use sourceName / pulseSourceIndex, not labels).
 */
export interface PrepareAudioResult {
  success: boolean;
  /** Chrome-visible remap mic source — use this for getUserMedia */
  chromeCaptureSource: string;
  sourceName: string;
  /** Internal monitor — Chrome on Linux does not enumerate this */
  monitorSource: string;
  audioDeviceId: string;
  sinkName: string;
  pulseSourceIndex: number | null;
  chromeLabelHint: string;
  sessionName: string;
  sink: string;
  moduleId: number | null;
  remapModuleId?: number | null;
  pulseSources?: Array<{ index: number; name: string; driver: string; state: string; isMonitor?: boolean }>;
}

export interface CaptureGraphDiagnosis {
  sinkName: string;
  monitorSource: string;
  chromeCaptureSource: string;
  pulseSourcesShort: string;
  pulseSinksShort: string;
  pulseSources: Array<{ index: number; name: string; driver: string; state: string; isMonitor?: boolean }>;
  comparisonTable: Array<{
    pulseName: string;
    index: number;
    isMonitor: boolean;
    chromeVisible: boolean;
    note: string;
  }>;
  pwNodes: unknown[];
  wpctlStatus: string;
}

export interface CaptureDeviceValidation {
  valid: boolean;
  chromeCaptureSource: string;
  monitorSource: string;
  micPresent: boolean;
  monitorPresent: boolean;
  micIndex: number | null;
  monitorIndex: number | null;
  pulseSources: unknown[];
}

export interface EnvironmentInfo {
  pipewire: boolean;
  pwDump: boolean;
  pwLink: boolean;
  pactl: boolean;
  wpctl: boolean;
}

export interface MirrorResult {
  pid: number;
  nodeIds: number[];
  linksCreated: number;
  monitorSource: string;
}

export interface DefaultOutputMirrorResult {
  sourceSink: string | null;
  targetSink?: string | null;
  linksCreated: number;
  error?: string | null;
}

export interface MirrorAllResult {
  mirrored: number;
  defaultOutput: DefaultOutputMirrorResult;
  results: MirrorResult[];
}

type Pending = {
  resolve: (value: unknown) => void;
  reject: (reason: NativeError) => void;
};

export class NativeAudioBridge {
  private port: chrome.runtime.Port | null = null;
  private seq = 0;
  private pending = new Map<number, Pending>();
  private onDisconnect?: (err?: string) => void;

  isConnected(): boolean {
    return this.port !== null;
  }

  /** Open the persistent port. Safe to call repeatedly (no-op if connected). */
  connect(onDisconnect?: (err?: string) => void): void {
    if (this.port) return;
    if (onDisconnect) this.onDisconnect = onDisconnect;

    let port: chrome.runtime.Port;
    try {
      port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
    } catch {
      // connectNative throws synchronously if the host is not installed.
      this.port = null;
      this.onDisconnect?.('Native host not installed');
      return;
    }

    this.port = port;

    port.onMessage.addListener((raw) => {
      const msg = raw as NativeEnvelope;
      const id = typeof msg.requestId === 'number' ? msg.requestId : null;
      if (id == null) return;
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      if (msg.ok) {
        pending.resolve(msg.data);
      } else {
        pending.reject(msg.error ?? { code: 'UNKNOWN', message: 'Unknown native error' });
      }
    });

    port.onDisconnect.addListener(() => {
      // Ignore disconnect events from a replaced port (reconnect race).
      if (this.port !== port) return;
      const err = chrome.runtime.lastError?.message;
      this.port = null;
      for (const [, p] of this.pending) {
        p.reject({ code: 'DISCONNECTED', message: err ?? 'Native host disconnected' });
      }
      this.pending.clear();
      this.onDisconnect?.(err);
    });
  }

  disconnect(): void {
    const port = this.port;
    if (!port) return;
    this.port = null;
    try {
      port.disconnect();
    } catch {
      /* ignore */
    }
  }

  /** Tear down the port and open a fresh native messaging connection. */
  reconnect(onDisconnect?: (err?: string) => void): boolean {
    this.disconnect();
    this.connect(onDisconnect);
    return this.isConnected();
  }

  private send<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (!this.port) {
        reject({ code: 'NOT_CONNECTED', message: 'Native host is not connected' } as NativeError);
        return;
      }
      const requestId = ++this.seq;
      this.pending.set(requestId, {
        resolve: resolve as (v: unknown) => void,
        reject,
      });
      try {
        this.port.postMessage({ action, requestId, ...payload });
      } catch (err) {
        this.pending.delete(requestId);
        reject({ code: 'POST_FAILED', message: String(err) } as NativeError);
      }
    });
  }

  ping(): Promise<{ pong: boolean; version: string }> {
    return this.send('ping');
  }

  checkEnvironment(): Promise<EnvironmentInfo> {
    return this.send('checkEnvironment');
  }

  listApplications(): Promise<AudioApplication[]> {
    return this.send('listApplications');
  }

  createVirtualDevice(opts?: {
    sessionName?: string;
    sinkName?: string;
  }): Promise<VirtualDeviceInfo> {
    return this.send('createVirtualDevice', opts ?? {});
  }

  /**
   * High-level entry point used by the recording flow.
   * Creates the virtual sink and returns the audio device identifier that
   * getUserMedia should use. Does NOT mirror a specific application;
   * call mirrorApplicationAudio(pid) separately after the user selects an app.
   */
  prepareApplicationAudio(opts: {
    sessionName: string;
    sinkName: string;
  }): Promise<PrepareAudioResult> {
    return this.send('prepareApplicationAudio', opts);
  }

  mirrorApplicationAudio(
    pid: number,
    opts?: { sessionName?: string; sinkName?: string }
  ): Promise<MirrorResult> {
    return this.send('mirrorApplicationAudio', { pid, ...opts });
  }

  /** Mirror every currently-playing audio stream into the virtual sink. */
  mirrorAllApplications(opts?: {
    sessionName?: string;
    sinkName?: string;
  }): Promise<MirrorAllResult> {
    return this.send('mirrorAllApplications', opts ?? {});
  }

  stopMirror(pid?: number): Promise<unknown> {
    return this.send('stopMirror', pid != null ? { pid } : {});
  }

  cleanup(): Promise<unknown> {
    return this.send('cleanup');
  }

  getStatus(): Promise<unknown> {
    return this.send('getStatus');
  }

  diagnoseCaptureGraph(): Promise<CaptureGraphDiagnosis> {
    return this.send('diagnoseCaptureGraph');
  }

  validateCaptureDevice(): Promise<CaptureDeviceValidation> {
    return this.send('validateCaptureDevice');
  }
}
