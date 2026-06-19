#!/usr/bin/env node
/**
 * Virtual-EXT Record — Native Messaging Host
 * ==========================================
 *
 * Mirrors the audio of a specific Linux application into a virtual audio device
 * WITHOUT moving / muting / changing the user's current output.
 *
 *   Application ──┬──> Real speaker / headphone   (original link, untouched)
 *                 └──> virtual_ext_record_sink            (extra link we add = the mirror)
 *                            │
 *                            └──> virtual_ext_record_sink.monitor  (internal PipeWire monitor)
 *                                      │
 *                                      └──> virtual_ext_record_sink_mic  (module-remap-source)
 *                                                │
 *                                                └──> Chrome getUserMedia (audioinput)
 *
 * Chrome on Linux does NOT enumerate .monitor sources as microphones (Chromium #931749).
 * We remap the monitor into a virtual mic source Chrome can see.
 *
 * Runtime: plain Node.js (ESM). No third-party dependencies — only Node builtins
 * and the standard Linux audio CLIs (`pactl`, `pw-dump`, `pw-link`). This file is
 * the program Chrome launches as the Native Messaging Host (`node host.js`).
 *
 * PROTOCOL NOTE: stdout is reserved for the Native Messaging wire protocol
 * (4-byte little-endian length prefix + UTF-8 JSON). Nothing else may be printed
 * to stdout or the channel is corrupted — all diagnostics go to stderr + a log
 * file (see Logger).
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

const execFileAsync = promisify(execFile);

const HOST_VERSION = '1.1.0';

const DEFAULT_SESSION_NAME = 'Recording';
const DEFAULT_SINK_NAME = 'Virtual-EXT_rec';

/** Sanitize a human label into a PulseAudio sink_name (extension provides the label). */
function sanitizeSinkName(name) {
  const raw = String(name ?? '').trim().toLowerCase();
  // Extension already sends deriveSinkName() values like "Virtual-EXT_entire_screen".
  if (/^virtual-ext_[a-z0-9_]+$/.test(raw)) {
    return `Virtual-EXT_${raw.slice('virtual-ext_'.length)}`.slice(0, 48);
  }
  if (/^virtual_[a-z0-9_]+$/.test(raw)) {
    return raw.slice(0, 48);
  }
  const slug = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 44);
  return `Virtual-EXT_${slug || 'rec'}`;
}

/** Chrome-visible remap source name derived from sink_name. */
function chromeCaptureSourceName(sinkName) {
  return `${sinkName}_mic`;
}

function sanitizeSessionName(name) {
  const trimmed = String(name ?? '').trim();
  return trimmed.slice(0, 64) || DEFAULT_SESSION_NAME;
}

// ---------------------------------------------------------------------------
// Logger — stderr + rotating-ish single file. NEVER writes to stdout.
// ---------------------------------------------------------------------------

class Logger {
  constructor() {
    this.logFile = null;
    try {
      const dir = join(process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'Virtual-EXT-record');
      mkdirSync(dir, { recursive: true });
      this.logFile = join(dir, 'native-host.log');
    } catch {
      try {
        this.logFile = join(tmpdir(), 'Virtual-EXT-record-native-host.log');
      } catch {
        this.logFile = null;
      }
    }
  }

  _write(level, msg, extra) {
    const line =
      `${new Date().toISOString()} [${level}] ${msg}` +
      (extra !== undefined ? ` ${safeJson(extra)}` : '') +
      '\n';
    try {
      process.stderr.write(line);
    } catch {
      /* ignore */
    }
    if (this.logFile) {
      try {
        appendFileSync(this.logFile, line);
      } catch {
        /* ignore */
      }
    }
  }

  info(msg, extra) {
    this._write('INFO', msg, extra);
  }
  warn(msg, extra) {
    this._write('WARN', msg, extra);
  }
  error(msg, extra) {
    this._write('ERROR', msg, extra);
  }
  debug(msg, extra) {
    if (process.env.EXT_REC_DEBUG) this._write('DEBUG', msg, extra);
  }
}

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

const log = new Logger();

// ---------------------------------------------------------------------------
// Typed-ish error so handlers can attach a stable machine-readable code.
// ---------------------------------------------------------------------------

class HostError extends Error {
  /** @param {string} code @param {string} message @param {object} [details] */
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

const ErrorCode = {
  PIPEWIRE_UNAVAILABLE: 'PIPEWIRE_UNAVAILABLE',
  TOOL_MISSING: 'TOOL_MISSING',
  APP_NOT_FOUND: 'APP_NOT_FOUND',
  STREAM_NOT_FOUND: 'STREAM_NOT_FOUND',
  DEVICE_NOT_READY: 'DEVICE_NOT_READY',
  LINK_FAILED: 'LINK_FAILED',
  CLEANUP_FAILED: 'CLEANUP_FAILED',
  BAD_REQUEST: 'BAD_REQUEST',
  UNKNOWN_ACTION: 'UNKNOWN_ACTION',
  INTERNAL: 'INTERNAL',
};

// ---------------------------------------------------------------------------
// Command runner — execFile (no shell) so arguments are never interpolated.
// ---------------------------------------------------------------------------

/**
 * @param {string} cmd
 * @param {string[]} args
 * @returns {Promise<{stdout:string, stderr:string}>}
 */
async function run(cmd, args, { allowFail = false } = {}) {
  log.debug('exec', { cmd, args });
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      maxBuffer: 64 * 1024 * 1024,
      timeout: 15_000,
      env: ensureAudioEnv(process.env),
    });
    return { stdout, stderr };
  } catch (err) {
    if (allowFail) {
      return { stdout: err.stdout || '', stderr: err.stderr || String(err) };
    }
    const detail = (err.stderr || err.message || '').toString().trim();
    throw new HostError(ErrorCode.INTERNAL, `Command failed: ${cmd} ${args.join(' ')} — ${detail}`, {
      cmd,
      args,
    });
  }
}

/** Make sure XDG_RUNTIME_DIR / DBUS exist; Chrome usually inherits them. */
function ensureAudioEnv(env) {
  const out = { ...env };
  const uid = process.getuid?.() ?? '';
  if (!out.XDG_RUNTIME_DIR) {
    out.XDG_RUNTIME_DIR = `/run/user/${uid}`;
  }
  if (!out.DBUS_SESSION_BUS_ADDRESS) {
    out.DBUS_SESSION_BUS_ADDRESS = `unix:path=${out.XDG_RUNTIME_DIR}/bus`;
  }
  return out;
}

async function hasTool(name) {
  try {
    await execFileAsync('which', [name], { env: ensureAudioEnv(process.env) });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// PipeWireManager — discovers nodes/ports and manages graph links via pw-link.
// ---------------------------------------------------------------------------

class PipeWireManager {
  /**
   * @returns {Promise<{pipewire:boolean, pwDump:boolean, pwLink:boolean, pactl:boolean, wpctl:boolean}>}
   */
  async checkAvailable() {
    const [pwDump, pwLink, pactl, wpctl, pipewire] = await Promise.all([
      hasTool('pw-dump'),
      hasTool('pw-link'),
      hasTool('pactl'),
      hasTool('wpctl'),
      hasTool('pipewire'),
    ]);
    return { pipewire, pwDump, pwLink, pactl, wpctl };
  }

  /** Full PipeWire object graph as parsed JSON. */
  async dump() {
    const { stdout } = await run('pw-dump', []);
    try {
      return JSON.parse(stdout);
    } catch (err) {
      throw new HostError(ErrorCode.PIPEWIRE_UNAVAILABLE, 'Could not parse pw-dump output', {
        message: String(err),
      });
    }
  }

  /**
   * Find all application playback streams (the things that produce audio).
   * media.class === "Stream/Output/Audio".
   * @returns {Promise<Array<{id:number, serial:number, pid:number|null, name:string,
   *   appName:string, binary:string, mediaName:string}>>}
   */
  async discoverNodes() {
    const objs = await this.dump();
    const nodes = [];
    for (const o of objs) {
      const props = o?.info?.props;
      if (!props) continue;
      if (props['media.class'] !== 'Stream/Output/Audio') continue;
      const pidRaw = props['application.process.id'];
      nodes.push({
        id: o.id,
        serial: props['object.serial'] ?? null,
        pid: pidRaw != null ? Number(pidRaw) : null,
        name: props['node.name'] || props['application.name'] || `node-${o.id}`,
        appName: props['application.name'] || '',
        binary: props['application.process.binary'] || '',
        mediaName: props['media.name'] || '',
      });
    }
    return nodes;
  }

  /**
   * Audio ports for a given node id and direction.
   * @param {number} nodeId
   * @param {'in'|'out'} direction
   * @returns {Promise<Array<{id:number, channel:string, name:string}>>}
   */
  async discoverPorts(nodeId, direction) {
    const objs = await this.dump();
    const ports = [];
    for (const o of objs) {
      if (o.type !== 'PipeWire:Interface:Port') continue;
      const props = o?.info?.props;
      if (!props) continue;
      if (Number(props['node.id']) !== Number(nodeId)) continue;
      if (props['port.direction'] !== direction) continue;
      // Audio ports carry an audio.channel (FL/FR/MONO/...). Skip control/midi.
      const channel = props['audio.channel'];
      if (!channel) continue;
      ports.push({
        id: o.id,
        channel,
        name: props['port.name'] || `${nodeId}:${channel}`,
      });
    }
    return ports;
  }

  /** Input ports of a sink, found by the sink's node.name. */
  async discoverSinkInputPorts(sinkName) {
    const objs = await this.dump();
    // First resolve the sink node id from its node.name.
    let sinkNodeId = null;
    for (const o of objs) {
      const props = o?.info?.props;
      if (props && props['media.class'] === 'Audio/Sink' && props['node.name'] === sinkName) {
        sinkNodeId = o.id;
        break;
      }
    }
    if (sinkNodeId == null) return [];
    return this.discoverPorts(sinkNodeId, 'in');
  }

  /** Monitor output ports of a sink (tap everything playing on that sink). */
  async discoverSinkMonitorPorts(sinkName) {
    const objs = await this.dump();
    let sinkNodeId = null;
    for (const o of objs) {
      const props = o?.info?.props;
      if (props && props['media.class'] === 'Audio/Sink' && props['node.name'] === sinkName) {
        sinkNodeId = o.id;
        break;
      }
    }
    if (sinkNodeId == null) return [];
    return this.discoverPorts(sinkNodeId, 'out');
  }

  /**
   * Create channel-matched links output→input. FL→FL, FR→FR; mono fans out to all.
   * @param {Array<{id:number, channel:string}>} outPorts
   * @param {Array<{id:number, channel:string}>} inPorts
   * @returns {Promise<Array<{outId:number, inId:number, outCh:string, inCh:string}>>}
   */
  async createLinks(outPorts, inPorts) {
    if (!outPorts.length) {
      throw new HostError(ErrorCode.STREAM_NOT_FOUND, 'Application has no audio output ports');
    }
    if (!inPorts.length) {
      throw new HostError(ErrorCode.DEVICE_NOT_READY, 'Virtual sink has no input ports');
    }

    const pairs = matchChannels(outPorts, inPorts);
    const created = [];
    for (const { out, in: inp } of pairs) {
      try {
        // `pw-link <output-id> <input-id>` adds an additional graph edge.
        await run('pw-link', [String(out.id), String(inp.id)]);
        created.push({ outId: out.id, inId: inp.id, outCh: out.channel, inCh: inp.channel });
      } catch (err) {
        // "File exists" => link already present; treat as success (idempotent).
        const msg = String(err?.message || '');
        if (/exist/i.test(msg)) {
          created.push({ outId: out.id, inId: inp.id, outCh: out.channel, inCh: inp.channel });
          continue;
        }
        log.warn('pw-link failed', { out: out.id, in: inp.id, msg });
      }
    }
    if (!created.length) {
      throw new HostError(ErrorCode.LINK_FAILED, 'Failed to create any mirror link');
    }
    return created;
  }

  /** Remove a set of links by their (output,input) port id pairs. */
  async removeLinks(links) {
    let failures = 0;
    for (const l of links) {
      try {
        await run('pw-link', ['-d', String(l.outId), String(l.inId)], { allowFail: true });
      } catch (err) {
        failures += 1;
        log.warn('failed to remove link', { link: l, err: String(err) });
      }
    }
    return { removed: links.length - failures, failures };
  }
}

/** Pair output ports to input ports by channel; mono fans to every input. */
function matchChannels(outPorts, inPorts) {
  const pairs = [];
  for (const out of outPorts) {
    let targets = inPorts.filter((i) => i.channel === out.channel);
    if (targets.length === 0) {
      // mono source → feed all sink inputs; or unknown channel → best effort.
      targets = out.channel === 'MONO' || outPorts.length === 1 ? inPorts : [];
    }
    for (const t of targets) {
      pairs.push({ out, in: t });
    }
  }
  return pairs;
}

// ---------------------------------------------------------------------------
// AudioManager — orchestrates the virtual sink (pactl) + mirror links.
// ---------------------------------------------------------------------------

class AudioManager {
  constructor() {
    this.pw = new PipeWireManager();
    /** pactl module index for the null sink we loaded, or null if reusing/none. */
    this.sinkModuleId = null;
    /** pactl module index for module-remap-source (Chrome-visible mic). */
    this.remapModuleId = null;
    /** PulseAudio sink_name for the current session (slug, set by extension). */
    this.sinkName = DEFAULT_SINK_NAME;
    /** Human-readable name Chrome shows — decided by the extension. */
    this.sessionName = DEFAULT_SESSION_NAME;
    /** Monitor source name derived from sinkName (internal, not Chrome-visible). */
    this.monitorSource = `${DEFAULT_SINK_NAME}.monitor`;
    /** Remapped virtual mic source Chrome can enumerate. */
    this.chromeCaptureSource = chromeCaptureSourceName(DEFAULT_SINK_NAME);
    /** @type {Map<number, {pid:number, nodeIds:number[], links:Array}>} keyed by pid */
    this.mirrors = new Map();
    /** Default output sink monitor → virtual sink (Entire Screen system-wide tap). */
    this.defaultOutputMirror = null;
  }

  _deviceInfo(pulseSources = []) {
    const remapEntry =
      pulseSources.find((s) => s.name === this.chromeCaptureSource) ??
      pulseSources.find((s) => !s.name.endsWith('.monitor') && s.name.includes(this.sinkName));
    const monitorEntry = pulseSources.find((s) => s.name === this.monitorSource);
    return {
      sink: this.sinkName,
      sinkName: this.sinkName,
      monitorSource: this.monitorSource,
      chromeCaptureSource: this.chromeCaptureSource,
      sourceName: this.chromeCaptureSource,
      audioDeviceId: this.chromeCaptureSource,
      description: this.sessionName,
      sessionName: this.sessionName,
      chromeLabelHint: this.sessionName,
      pulseSourceIndex: remapEntry?.index ?? monitorEntry?.index ?? null,
      moduleId: this.sinkModuleId,
      remapModuleId: this.remapModuleId,
      pulseSources,
    };
  }

  async ensureEnvironment() {
    const tools = await this.pw.checkAvailable();
    if (!tools.pactl) {
      throw new HostError(ErrorCode.TOOL_MISSING, '`pactl` not found. Install pipewire-pulse / pulseaudio-utils.');
    }
    if (!tools.pwDump || !tools.pwLink) {
      throw new HostError(
        ErrorCode.PIPEWIRE_UNAVAILABLE,
        'PipeWire tools (pw-dump/pw-link) not found. This host requires PipeWire.'
      );
    }
    return tools;
  }

  /** Is our null sink currently present in the graph? returns module index or null. */
  async _findExistingSinkModule(sinkName = this.sinkName) {
    const { stdout } = await run('pactl', ['list', 'short', 'modules'], { allowFail: true });
    for (const line of stdout.split('\n')) {
      if (!line.trim()) continue;
      const [idx, name, ...rest] = line.split('\t');
      const args = rest.join(' ');
      if (name === 'module-null-sink' && args.includes(`sink_name=${sinkName}`)) {
        return Number(idx);
      }
    }
    return null;
  }

  async _sinkExists(sinkName = this.sinkName) {
    const { stdout } = await run('pactl', ['list', 'short', 'sinks'], { allowFail: true });
    return stdout.split('\n').some((l) => l.split('\t')[1] === sinkName);
  }

  /** PulseAudio capture sources tied to our virtual sink (monitor + remap mic). */
  async _listPulseSources(sinkName = this.sinkName) {
    const monitor = `${sinkName}.monitor`;
    const mic = chromeCaptureSourceName(sinkName);
    const { stdout } = await run('pactl', ['list', 'short', 'sources'], { allowFail: true });
    const sources = [];
    for (const line of stdout.split('\n')) {
      if (!line.trim()) continue;
      const [index, name, driver, ...rest] = line.split('\t');
      if (name === monitor || name === mic || name === sinkName || name.includes(sinkName)) {
        sources.push({
          index: Number(index),
          name,
          driver: driver ?? '',
          state: rest.join('\t').trim(),
          isMonitor: name.endsWith('.monitor'),
        });
      }
    }
    return sources;
  }

  async _findExistingRemapModule(captureSource = this.chromeCaptureSource) {
    const { stdout } = await run('pactl', ['list', 'short', 'modules'], { allowFail: true });
    for (const line of stdout.split('\n')) {
      if (!line.trim()) continue;
      const [idx, name, ...rest] = line.split('\t');
      const args = rest.join(' ');
      if (name === 'module-remap-source' && args.includes(`source_name=${captureSource}`)) {
        return Number(idx);
      }
    }
    return null;
  }

  async _sourceExists(sourceName) {
    const { stdout } = await run('pactl', ['list', 'short', 'sources'], { allowFail: true });
    return stdout.split('\n').some((l) => l.split('\t')[1] === sourceName);
  }

  /**
   * Clone the null-sink monitor into a Chrome-visible virtual microphone.
   * Chrome on Linux filters .monitor sources from enumerateDevices().
   */
  async _ensureChromeCaptureSource(sessionName) {
    const desc = sessionName.replace(/"/g, "'");
    const captureSource = this.chromeCaptureSource;

    const existing = await this._findExistingRemapModule(captureSource);
    if (existing != null || (await this._sourceExists(captureSource))) {
      this.remapModuleId = existing;
      log.info('chrome capture source already present', { captureSource, module: existing });
      await run('pactl', ['set-source-mute', captureSource, '0'], { allowFail: true });
      return;
    }

    const { stdout } = await run('pactl', [
      'load-module',
      'module-remap-source',
      `master=${this.monitorSource}`,
      `source_name=${captureSource}`,
      `source_properties=device.description="${desc}"`,
    ]);
    this.remapModuleId = Number(stdout.trim());
    await run('pactl', ['set-source-mute', captureSource, '0'], { allowFail: true });
    log.info('chrome capture source created', {
      captureSource,
      master: this.monitorSource,
      module: this.remapModuleId,
    });
  }

  async _unloadRemap(captureSource = this.chromeCaptureSource) {
    const { stdout } = await run('pactl', ['list', 'short', 'modules'], { allowFail: true });
    const toUnload = [];
    for (const line of stdout.split('\n')) {
      if (!line.trim()) continue;
      const [idx, name, ...rest] = line.split('\t');
      const args = rest.join(' ');
      if (name === 'module-remap-source' && /source_name=Virtual-EXT_/.test(args)) {
        if (!captureSource || args.includes(`source_name=${captureSource}`)) {
          toUnload.push(idx);
        }
      }
    }
    for (const idx of toUnload) {
      await run('pactl', ['unload-module', idx], { allowFail: true });
    }
    if (toUnload.length) {
      log.info('unloaded remap modules', { captureSource, count: toUnload.length });
    }
    if (!captureSource || captureSource === this.chromeCaptureSource) {
      this.remapModuleId = null;
    }
  }

  /** Unload a single null-sink module by sink_name. */
  async _unloadSink(sinkName) {
    const { stdout } = await run('pactl', ['list', 'short', 'modules'], { allowFail: true });
    const toUnload = [];
    for (const line of stdout.split('\n')) {
      if (!line.trim()) continue;
      const [idx, name, ...rest] = line.split('\t');
      if (name === 'module-null-sink' && rest.join(' ').includes(`sink_name=${sinkName}`)) {
        toUnload.push(idx);
      }
    }
    for (const idx of toUnload) {
      await run('pactl', ['unload-module', idx], { allowFail: true });
    }
    if (toUnload.length) {
      log.info('unloaded sink module', { sinkName, count: toUnload.length });
    }
    if (sinkName === this.sinkName) {
      this.sinkModuleId = null;
    }
  }

  /**
   * Create the virtual sink for this recording session (idempotent per sink_name).
   * @param {{sessionName?: string, sinkName?: string}} [opts]
   */
  async createVirtualDevice(opts = {}) {
    await this.ensureEnvironment();

    const sessionName = sanitizeSessionName(opts.sessionName ?? this.sessionName);
    const sinkName = opts.sinkName ? sanitizeSinkName(opts.sinkName) : sanitizeSinkName(sessionName);

    // Tear down a previous session sink when the extension picks a new name.
    if (this.sinkName && this.sinkName !== sinkName && (await this._sinkExists(this.sinkName))) {
      await this.stopMirror();
      await this._unloadSink(this.sinkName);
    }

    if (this.sinkName && this.sinkName !== sinkName && (await this._sinkExists(this.sinkName))) {
      await this.stopMirror();
      await this._unloadRemap();
      await this._unloadSink(this.sinkName);
    }

    this.sessionName = sessionName;
    this.sinkName = sinkName;
    this.monitorSource = `${sinkName}.monitor`;
    this.chromeCaptureSource = chromeCaptureSourceName(sinkName);

    const existingModule = await this._findExistingSinkModule(sinkName);
    if (existingModule != null || (await this._sinkExists(sinkName))) {
      this.sinkModuleId = existingModule;
      log.info('virtual sink already present, reusing', { sinkName, sessionName, module: existingModule });
    } else {
      const desc = sessionName.replace(/"/g, "'");
      const { stdout } = await run('pactl', [
        'load-module',
        'module-null-sink',
        `sink_name=${sinkName}`,
        `sink_properties=device.description="${desc}"`,
        `source_properties=device.description="${desc}"`,
      ]);
      this.sinkModuleId = Number(stdout.trim());
      log.info('virtual sink created', { sinkName, sessionName, module: this.sinkModuleId });
    }

    await run('pactl', ['set-source-mute', this.monitorSource, '0'], { allowFail: true });
    await this._ensureChromeCaptureSource(sessionName);

    const pulseSources = await this._listPulseSources(sinkName);
    log.info('pulse capture sources', { sinkName, chromeCaptureSource: this.chromeCaptureSource, pulseSources });

    return { ...this._deviceInfo(pulseSources) };
  }

  async listApplications() {
    await this.ensureEnvironment();
    const nodes = await this.pw.discoverNodes();
    return nodes.map((n) => ({
      pid: n.pid,
      nodeId: n.id,
      name: n.appName || n.name,
      binary: n.binary,
      media: n.mediaName,
    }));
  }

  async _getDefaultPulseSink() {
    const { stdout } = await run('pactl', ['get-default-sink']);
    const name = stdout.trim();
    if (!name) {
      throw new HostError(ErrorCode.DEVICE_NOT_READY, 'Could not resolve default PulseAudio sink');
    }
    return name;
  }

  /**
   * Tap the default output sink monitor and link it into the virtual sink.
   * Captures all system audio without moving playback away from the real speakers.
   */
  async mirrorDefaultOutputMonitor(opts = {}) {
    await this.createVirtualDevice(opts);

    const { stdout: sinkInputsRaw } = await run('pactl', ['list', 'short', 'sink-inputs'], {
      allowFail: true,
    });
    const sinkInputLines = sinkInputsRaw.split('\n').filter((l) => l.trim());
    log.info('mirrorDefaultOutput: sink-inputs', {
      count: sinkInputLines.length,
      preview: sinkInputLines.slice(0, 8),
    });

    const defaultSink = await this._getDefaultPulseSink();
    log.info('mirrorDefaultOutput: default sink', { defaultSink, targetSink: this.sinkName });

    if (this.defaultOutputMirror?.links?.length) {
      await this.pw.removeLinks(this.defaultOutputMirror.links);
      this.defaultOutputMirror = null;
    }

    const monitorOutPorts = await this.pw.discoverSinkMonitorPorts(defaultSink);
    const virtualInPorts = await this.pw.discoverSinkInputPorts(this.sinkName);
    if (!monitorOutPorts.length) {
      throw new HostError(
        ErrorCode.DEVICE_NOT_READY,
        `Default sink "${defaultSink}" has no monitor output ports`
      );
    }
    if (!virtualInPorts.length) {
      throw new HostError(ErrorCode.DEVICE_NOT_READY, 'Virtual sink is not ready (no input ports)');
    }

    log.info('mirrorDefaultOutput: ports', {
      monitorOut: monitorOutPorts.map((p) => ({ id: p.id, ch: p.channel, name: p.name })),
      virtualIn: virtualInPorts.map((p) => ({ id: p.id, ch: p.channel, name: p.name })),
    });

    const links = await this.pw.createLinks(monitorOutPorts, virtualInPorts);
    log.info('mirrorDefaultOutput: links created', { defaultSink, targetSink: this.sinkName, links });

    this.defaultOutputMirror = { sourceSink: defaultSink, links };
    return {
      sourceSink: defaultSink,
      targetSink: this.sinkName,
      linksCreated: links.length,
      links,
    };
  }

  /**
   * Mirror every audio stream belonging to `pid` into the virtual sink.
   * @param {number} pid
   * @param {{sessionName?: string, sinkName?: string}} [opts]
   */
  async mirrorApplication(pid, opts = {}) {
    if (!Number.isInteger(pid) || pid <= 0) {
      throw new HostError(ErrorCode.BAD_REQUEST, 'A valid numeric "pid" is required');
    }
    await this.createVirtualDevice(opts);

    const nodes = await this.pw.discoverNodes();
    const matching = nodes.filter((n) => n.pid === pid);
    if (matching.length === 0) {
      throw new HostError(
        ErrorCode.APP_NOT_FOUND,
        `No active audio stream found for pid ${pid}. The app must be playing audio.`,
        { availablePids: nodes.map((n) => n.pid).filter(Boolean) }
      );
    }

    const sinkInPorts = await this.pw.discoverSinkInputPorts(this.sinkName);
    if (!sinkInPorts.length) {
      throw new HostError(ErrorCode.DEVICE_NOT_READY, 'Virtual sink is not ready (no input ports)');
    }

    const allLinks = [];
    const nodeIds = [];
    for (const node of matching) {
      const outPorts = await this.pw.discoverPorts(node.id, 'out');
      if (!outPorts.length) {
        log.warn('node has no output ports yet', { node: node.id });
        continue;
      }
      const links = await this.pw.createLinks(outPorts, sinkInPorts);
      allLinks.push(...links);
      nodeIds.push(node.id);
    }

    if (!allLinks.length) {
      throw new HostError(ErrorCode.LINK_FAILED, `Could not mirror pid ${pid} (no links created)`);
    }

    const prev = this.mirrors.get(pid);
    if (prev) {
      this.mirrors.set(pid, {
        pid,
        nodeIds: [...new Set([...prev.nodeIds, ...nodeIds])],
        links: [...prev.links, ...allLinks],
      });
    } else {
      this.mirrors.set(pid, { pid, nodeIds, links: allLinks });
    }

    log.info('mirroring established', { pid, sink: this.sinkName, links: allLinks.length, nodeIds });
    return {
      pid,
      nodeIds,
      linksCreated: allLinks.length,
      monitorSource: this.monitorSource,
      chromeLabelHint: this.sessionName,
    };
  }

  /**
   * Mirror every currently-playing audio stream into the virtual sink.
   * Entire Screen: default output monitor tap first, then per-app streams.
   */
  async mirrorAllApplications(opts = {}) {
    let defaultOutput = { sourceSink: null, targetSink: null, linksCreated: 0, error: null };
    try {
      defaultOutput = await this.mirrorDefaultOutputMonitor(opts);
    } catch (err) {
      log.warn('mirrorAllApplications: default output mirror failed', { err: err.message });
      defaultOutput = {
        sourceSink: null,
        targetSink: this.sinkName,
        linksCreated: 0,
        error: err.message,
      };
    }

    const nodes = await this.pw.discoverNodes();
    log.info('mirrorAllApplications: Stream/Output/Audio', {
      count: nodes.length,
      streams: nodes.map((n) => ({ pid: n.pid, name: n.appName || n.name, nodeId: n.id })),
    });

    const results = [];
    const seenPids = new Set();
    for (const node of nodes) {
      if (!node.pid || seenPids.has(node.pid)) continue;
      seenPids.add(node.pid);
      try {
        const r = await this.mirrorApplication(node.pid);
        results.push(r);
      } catch (err) {
        log.warn('mirrorAll: skipping node', { nodeId: node.id, pid: node.pid, err: err.message });
      }
    }

    log.info('mirrorAllApplications done', {
      defaultLinks: defaultOutput.linksCreated ?? 0,
      appMirrored: results.length,
    });
    return { mirrored: results.length, defaultOutput, results };
  }

  /** Remove the mirror for a pid, or all mirrors when pid is omitted. */
  async stopMirror(pid) {
    const targets = pid != null ? [pid] : [...this.mirrors.keys()];
    let removed = 0;
    let failures = 0;

    if (pid == null && this.defaultOutputMirror?.links?.length) {
      const res = await this.pw.removeLinks(this.defaultOutputMirror.links);
      removed += res.removed;
      failures += res.failures;
      log.info('stopMirror: default output links removed', {
        sourceSink: this.defaultOutputMirror.sourceSink,
        removed: res.removed,
      });
      this.defaultOutputMirror = null;
    }

    for (const p of targets) {
      const mirror = this.mirrors.get(p);
      if (!mirror) continue;
      const res = await this.pw.removeLinks(mirror.links);
      removed += res.removed;
      failures += res.failures;
      this.mirrors.delete(p);
    }
    log.info('stopMirror', { pid: pid ?? 'all', removed, failures });
    return { stopped: targets, linksRemoved: removed, failures };
  }

  /** Remove every link and unload every null sink we (or a previous run) created. */
  async cleanup() {
    let errors = [];

    // 1. Drop all tracked mirror links.
    try {
      await this.stopMirror();
    } catch (err) {
      errors.push(String(err));
    }

    // 2. Unload remap modules before null-sinks (remap depends on monitor).
    try {
      const { stdout } = await run('pactl', ['list', 'short', 'modules'], { allowFail: true });
      const remapUnload = [];
      for (const line of stdout.split('\n')) {
        if (!line.trim()) continue;
        const [idx, name, ...rest] = line.split('\t');
        const args = rest.join(' ');
        if (name === 'module-remap-source' && /source_name=Virtual-EXT_/.test(args)) {
          remapUnload.push(idx);
        }
      }
      for (const idx of remapUnload) {
        await run('pactl', ['unload-module', idx], { allowFail: true });
      }
      this.remapModuleId = null;
      if (remapUnload.length) {
        log.info('cleanup unloaded remap modules', { count: remapUnload.length });
      }
    } catch (err) {
      errors.push(String(err));
    }

    // 3. Unload ALL Virtual-EXT_* null-sink modules (current + leftovers from prior sessions).
    try {
      const { stdout } = await run('pactl', ['list', 'short', 'modules'], { allowFail: true });
      const toUnload = [];
      for (const line of stdout.split('\n')) {
        if (!line.trim()) continue;
        const [idx, name, ...rest] = line.split('\t');
        const args = rest.join(' ');
        if (name === 'module-null-sink' && /sink_name=Virtual-EXT_/.test(args)) {
          toUnload.push(idx);
        }
      }
      for (const idx of toUnload) {
        await run('pactl', ['unload-module', idx], { allowFail: true });
      }
      this.sinkModuleId = null;
      log.info('cleanup unloaded sink modules', { count: toUnload.length });
    } catch (err) {
      errors.push(String(err));
    }

    if (errors.length) {
      throw new HostError(ErrorCode.CLEANUP_FAILED, 'Cleanup completed with errors', { errors });
    }
    return { cleaned: true };
  }

  status() {
    return {
      sink: this.sinkName,
      monitorSource: this.monitorSource,
      chromeCaptureSource: this.chromeCaptureSource,
      sessionName: this.sessionName,
      sinkModuleId: this.sinkModuleId,
      remapModuleId: this.remapModuleId,
      mirrors: [...this.mirrors.values()].map((m) => ({
        pid: m.pid,
        nodeIds: m.nodeIds,
        links: m.links.length,
      })),
      defaultOutputMirror: this.defaultOutputMirror
        ? {
            sourceSink: this.defaultOutputMirror.sourceSink,
            links: this.defaultOutputMirror.links.length,
          }
        : null,
    };
  }

  /** Collect pactl + PipeWire node data for Chrome visibility debugging. */
  async diagnoseCaptureGraph() {
    await this.ensureEnvironment();
    const sinkName = this.sinkName;
    const pulseSourcesShort = await run('pactl', ['list', 'short', 'sources'], { allowFail: true });
    const pulseSinksShort = await run('pactl', ['list', 'short', 'sinks'], { allowFail: true });
    const pulseSources = await this._listPulseSources(sinkName);

    let wpctlStatus = '';
    try {
      const tools = await this.pw.checkAvailable();
      if (tools.wpctl) {
        const r = await run('wpctl', ['status'], { allowFail: true });
        wpctlStatus = r.stdout.split('\n').slice(0, 40).join('\n');
      }
    } catch {
      /* ignore */
    }

    const pwNodes = [];
    try {
      const objs = await this.pw.dump();
      for (const o of objs) {
        const props = o?.info?.props;
        if (!props) continue;
        const nodeName = props['node.name'] || '';
        const mediaName = props['media.name'] || '';
        if (!nodeName.includes('Virtual-EXT_') && !mediaName.includes('Virtual-EXT_')) continue;
        pwNodes.push({
          id: o.id,
          nodeName,
          description: props['node.description'] || '',
          mediaClass: props['media.class'] || '',
          objectSerial: props['object.serial'] ?? null,
        });
      }
    } catch (err) {
      pwNodes.push({ error: String(err) });
    }

    const comparisonTable = pulseSources.map((s) => ({
      pulseName: s.name,
      index: s.index,
      isMonitor: s.isMonitor ?? s.name.endsWith('.monitor'),
      chromeVisible: !(s.isMonitor ?? s.name.endsWith('.monitor')),
      note: (s.isMonitor ?? s.name.endsWith('.monitor'))
        ? 'Chrome filters monitor sources on Linux'
        : 'Chrome should enumerate this as audioinput',
    }));

    return {
      sinkName,
      monitorSource: this.monitorSource,
      chromeCaptureSource: this.chromeCaptureSource,
      pulseSourcesShort: pulseSourcesShort.stdout.trim(),
      pulseSinksShort: pulseSinksShort.stdout.trim(),
      pulseSources,
      comparisonTable,
      pwNodes,
      wpctlStatus,
    };
  }

  /** Assert remap mic exists in pactl (not just .monitor). */
  async validateCaptureDevice() {
    const pulseSources = await this._listPulseSources(this.sinkName);
    const mic = pulseSources.find((s) => s.name === this.chromeCaptureSource);
    const monitor = pulseSources.find((s) => s.name === this.monitorSource);
    return {
      valid: Boolean(mic),
      chromeCaptureSource: this.chromeCaptureSource,
      monitorSource: this.monitorSource,
      micPresent: Boolean(mic),
      monitorPresent: Boolean(monitor),
      micIndex: mic?.index ?? null,
      monitorIndex: monitor?.index ?? null,
      pulseSources,
    };
  }
}

// ---------------------------------------------------------------------------
// NativeHost — Native Messaging wire protocol + command dispatch.
// ---------------------------------------------------------------------------

class NativeHost {
  constructor() {
    this.audio = new AudioManager();
    /** @type {Buffer} accumulates partial stdin frames */
    this.buffer = Buffer.alloc(0);
    this.handlers = {
      ping: () => ({ pong: true, version: HOST_VERSION }),
      checkEnvironment: () => this.audio.pw.checkAvailable(),
      listApplications: () => this.audio.listApplications(),
      createVirtualDevice: (req) =>
        this.audio.createVirtualDevice({
          sessionName: req.sessionName,
          sinkName: req.sinkName,
        }),
      prepareApplicationAudio: async (req) => {
        const sessionName = sanitizeSessionName(req.sessionName ?? DEFAULT_SESSION_NAME);
        const sinkName = req.sinkName
          ? sanitizeSinkName(req.sinkName)
          : sanitizeSinkName(sessionName);
        const info = await this.audio.createVirtualDevice({ sessionName, sinkName });
        return {
          success: true,
          audioDeviceId: info.sourceName,
          sourceName: info.sourceName,
          chromeCaptureSource: info.chromeCaptureSource,
          monitorSource: info.monitorSource,
          sinkName: info.sinkName,
          sink: info.sinkName,
          pulseSourceIndex: info.pulseSourceIndex,
          chromeLabelHint: info.chromeLabelHint,
          sessionName: info.sessionName,
          moduleId: info.moduleId,
          remapModuleId: info.remapModuleId,
          pulseSources: info.pulseSources ?? [],
        };
      },
      diagnoseCaptureGraph: () => this.audio.diagnoseCaptureGraph(),
      validateCaptureDevice: () => this.audio.validateCaptureDevice(),
      mirrorApplicationAudio: (req) =>
        this.audio.mirrorApplication(Number(req.pid), {
          sessionName: req.sessionName,
          sinkName: req.sinkName,
        }),
      mirrorAllApplications: (req) =>
        this.audio.mirrorAllApplications({
          sessionName: req.sessionName,
          sinkName: req.sinkName,
        }),
      stopMirror: (req) => this.audio.stopMirror(req.pid != null ? Number(req.pid) : undefined),
      cleanup: () => this.audio.cleanup(),
      getStatus: () => this.audio.status(),
    };
  }

  start() {
    log.info('native host starting', { version: HOST_VERSION, pid: process.pid });
    process.stdin.on('data', (chunk) => this._onData(chunk));
    process.stdin.on('end', () => this._shutdown('stdin-end'));
    process.stdin.on('error', (err) => {
      log.error('stdin error', { err: String(err) });
      this._shutdown('stdin-error');
    });
    // Best-effort cleanup if the process is told to stop.
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
      process.on(sig, () => this._shutdown(sig));
    }
  }

  _onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    // Drain as many complete frames as are buffered.
    while (this.buffer.length >= 4) {
      const len = this.buffer.readUInt32LE(0);
      if (len > 64 * 1024 * 1024) {
        log.error('frame too large, dropping connection', { len });
        this._shutdown('frame-too-large');
        return;
      }
      if (this.buffer.length < 4 + len) break; // wait for more data
      const body = this.buffer.subarray(4, 4 + len).toString('utf8');
      this.buffer = this.buffer.subarray(4 + len);
      this._handleRaw(body);
    }
  }

  async _handleRaw(body) {
    let msg;
    try {
      msg = JSON.parse(body);
    } catch (err) {
      this._send({ ok: false, error: { code: ErrorCode.BAD_REQUEST, message: 'Invalid JSON' } });
      return;
    }
    const requestId = msg.requestId ?? msg.id ?? null;
    const action = msg.action;
    log.info('request', { requestId, action });

    const handler = this.handlers[action];
    if (!handler) {
      this._send({
        ok: false,
        requestId,
        action,
        error: { code: ErrorCode.UNKNOWN_ACTION, message: `Unknown action: ${action}` },
      });
      return;
    }

    try {
      const data = await handler(msg);
      this._send({ ok: true, requestId, action, data });
    } catch (err) {
      const he =
        err instanceof HostError
          ? err
          : new HostError(ErrorCode.INTERNAL, err?.message || 'Internal error');
      log.error('handler failed', { action, code: he.code, message: he.message, details: he.details });
      this._send({
        ok: false,
        requestId,
        action,
        error: { code: he.code, message: he.message, details: he.details },
      });
    }
  }

  _send(obj) {
    const json = Buffer.from(JSON.stringify(obj), 'utf8');
    const header = Buffer.alloc(4);
    header.writeUInt32LE(json.length, 0);
    try {
      process.stdout.write(Buffer.concat([header, json]));
    } catch (err) {
      log.error('failed to write response', { err: String(err) });
    }
  }

  async _shutdown(reason) {
    if (this._shuttingDown) return;
    this._shuttingDown = true;
    log.info('shutting down', { reason });
    // Best-effort: remove mirror links so we never leave the graph half-wired.
    // We deliberately keep the virtual sink loaded across sendNativeMessage
    // calls (each call spawns a fresh host process), so only links are torn down
    // here; full sink teardown happens via the explicit `cleanup` action.
    try {
      await this.audio.stopMirror();
    } catch (err) {
      log.warn('shutdown stopMirror failed', { err: String(err) });
    }
    process.exit(0);
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

new NativeHost().start();

export { AudioManager, PipeWireManager, NativeHost, HostError, ErrorCode };
