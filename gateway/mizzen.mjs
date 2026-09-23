import { randomUUID } from "node:crypto";
import { GatewayError } from "./core.mjs";
import { BytePlusLiveVoice } from "./live-voice.mjs";
import { MizzenAudio } from "./mizzen-audio.mjs";

const fault = (code, message, status = 502) => new GatewayError(status, code, message);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function mizzenConfig(env = process.env) {
  return { base: (env.MIZZEN_BASE_URL || "https://avatar.preview.mizzen.top").replace(/\/$/, ""),
    inputKey: env.MIZZEN_INPUT_KEY || "", playbackKey: env.MIZZEN_PLAYBACK_KEY || "" };
}

export function createMizzenManager(config, { fetchImpl = fetch, makeAudio = (url, key) => new MizzenAudio(url, key),
  makeTts = (emit) => new BytePlusLiveVoice(config, emit), pollMs = 500,
  log = event => process.stderr.write(`${JSON.stringify(event)}\n`) } = {}) {
  const settings = config.mizzen || mizzenConfig({});
  const entries = new Map(), creating = new Set(), rates = new Map();
  let quarantined = false;
  const enabled = !!(settings.inputKey && settings.playbackKey);
  const safeCode = value => typeof value === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(value) ? value : null;
  const stateLog = (event, entry, payload) => log({ event, videoId: entry.id, upstreamSession: entry.upstream,
    state: ["starting", "ready", "receiving", "closing", "closed", "failed"].includes(payload.state) ? payload.state : "unknown",
    code: safeCode(payload.error?.code ?? payload.error), elapsedMs: Date.now() - entry.created });
  const clientLog = (entry, input) => {
    if (!input || typeof input !== 'object' || (entry.clientLogCount || 0) >= 40) return;
    const stages = ['ice_started', 'ice_complete', 'offer_sent', 'answer_applied', 'connection', 'ready', 'first_frame_timeout', 'closed'];
    const reasons = ['none', 'client_closed', 'ice_timeout', 'ice_failed', 'open_failed', 'offer_failed', 'answer_failed', 'connection_failed', 'heartbeat_failed', 'media_failed'];
    if (!stages.includes(input.stage)) return;
    const bounded = (value, max) => Number.isSafeInteger(value) && value >= 0 && value <= max ? value : null;
    entry.clientLogCount = (entry.clientLogCount || 0) + 1;
    log({ event: 'video.client_diagnostics', videoId: entry.id, upstreamSession: entry.upstream,
      source: 'browser', stage: input.stage, reason: reasons.includes(input.reason) ? input.reason : 'unknown',
      elapsedMs: bounded(input.elapsedMs, 3600000), iceElapsedMs: bounded(input.iceElapsedMs, 3600000),
      offerSent: input.offerSent === true,
      gathering: ['new', 'gathering', 'complete'].includes(input.gathering) ? input.gathering : 'unknown',
      connection: ['new', 'connecting', 'connected', 'disconnected', 'failed', 'closed'].includes(input.connection) ? input.connection : 'unknown',
      candidates: Object.fromEntries(['host', 'srflx', 'prflx', 'relay'].map(type => [type, bounded(input.candidates?.[type], 1000)])),
      iceErrorCodes: Array.isArray(input.iceErrorCodes) ? input.iceErrorCodes.slice(0, 8).map(code => bounded(code, 999)).filter(code => code !== null) : [],
    });
  };
  async function api(path, playback = false, method = "GET", body, idempotency) {
    const started = Date.now();
    const context = { operation: method, route: path.replace(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/, ":session"), upstreamSession: path.match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/)?.[0] ?? null };
    const base = new URL(settings.base);
    if (base.protocol !== "https:" || base.username || base.password) throw fault("video_configuration", "Video service configuration is invalid", 503);
    let response;
    try {
      response = await fetchImpl(`${settings.base}${path}`, { method, redirect: "error",
        signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${playback ? settings.playbackKey : settings.inputKey}`,
          ...(body ? { "Content-Type": "application/json" } : {}), ...(idempotency ? { "Idempotency-Key": idempotency } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}) });
    } catch { log({ event: "video.upstream_network", ...context, elapsedMs: Date.now() - started }); throw fault("video_network", "Video service did not respond. Text chat is still available."); }
    let payload;
    // Bounded response (ICE + SDP), never pass raw provider errors or credentials to the browser/logs.
    const reader = response.body?.getReader(); let text = "";
    try {
      if (reader) { const decoder = new TextDecoder(); for (;;) { const part = await reader.read(); if (part.done) break;
        text += decoder.decode(part.value, { stream: true }); if (text.length > 131072) throw new Error("oversize"); } }
      payload = JSON.parse(text);
    } catch { log({ event: "video.upstream_protocol", ...context, status: response.status }); throw fault("video_protocol", "Video service returned an invalid response."); }
    finally { await reader?.cancel().catch(() => {}); reader?.releaseLock(); }
    if (!response.ok) {
      log({ event: "video.upstream_http", ...context, status: response.status, code: safeCode(payload?.error?.code ?? payload?.error), elapsedMs: Date.now() - started });
      if (response.status === 404) throw fault("video_expired", "Video session expired. Reconnect to continue.", 404);
      if (response.status === 409) throw fault("video_busy", "Video service is busy or not ready. Text chat is still available.", 409);
      throw fault("video_unavailable", "Video service unavailable. Check server credentials and playback access.");
    }
    return payload;
  }
  function own(id, owner) {
    const entry = entries.get(id);
    if (!entry || entry.owner !== owner || entry.closed) throw fault("video_expired", "Video session expired. Reconnect to continue.", 409);
    return entry;
  }
  async function release(entry) {
    if (entry.closing) return entry.closing;
    entry.closed = true; entry.audio?.cancel(); entry.tts?.cancel();
    entry.closing = (async () => {
      try {
        await api(`/v1/sessions/${entry.upstream}`, false, "DELETE");
        for (let attempt = 0; attempt < 3; attempt++) {
          const final = await api(`/v1/sessions/${entry.upstream}`);
          stateLog("video.cleanup_state", entry, final);
          if (["closed", "failed"].includes(final.state)) { entries.delete(entry.id); return; }
          if (attempt < 2) await new Promise(resolve => setTimeout(resolve, pollMs));
        }
        throw fault("video_cleanup", "Video cleanup is still pending", 503);
      } catch (error) {
        if (error.code === "video_expired") { entries.delete(entry.id); return; }
        // Retain this occupied seat until cleanup is confirmed. Do not globally
        // quarantine healthy sessions because one known lease is slow to close.
        entry.cleanupAttempts = (entry.cleanupAttempts || 0) + 1;
        entry.retryAt = Date.now() + Math.min(60000, 10000 * entry.cleanupAttempts);
        log({ event: "video.cleanup_pending", videoId: entry.id, upstreamSession: entry.upstream, attempt: entry.cleanupAttempts, code: error.code || "cleanup_unconfirmed" });
        throw fault("video_cleanup", "Video cleanup is pending. Text chat remains available.", 503);
      }
    })();
    entry.closing.catch(() => { entry.closing = null; });
    return entry.closing;
  }
  const sweep = setInterval(() => {
    for (const entry of entries.values()) {
      if (entry.closed) {
        if (Date.now() >= entry.retryAt) void release(entry).catch(() => {});
      } else if (Date.now() - entry.seen > 45000 || Date.now() - entry.created > 550000) void release(entry).catch(() => {});
    }
  }, 5000); sweep.unref?.();

  return {
    enabled,
    async handle(action, owner, body) {
      if (action === "capabilities") return { enabled, reason: enabled ? null : "credentials_missing" };
      if (!enabled) throw fault("video_not_configured", "Video is not configured yet. Text chat is available.", 503);
      if (action === "open") {
        if (quarantined) throw fault("video_cleanup", "Video capacity requires operator confirmation.", 503);
        if (creating.has(owner)) throw fault("video_busy", "A video session is already starting.", 409);
        const now = Date.now(); for (const [key, value] of rates) if (now - value.at > 60000) rates.delete(key);
        const rate = rates.get(owner) || { at: now, count: 0 };
        if (++rate.count > 4 || rates.size > 1024) throw fault("video_rate_limit", "Please wait before reconnecting video.", 429);
        rates.set(owner, rate);
        creating.add(owner); let entry;
        try {
          // Pending cleanup still occupies a seat, but must not indefinitely block
          // its owner from reconnecting when another bounded seat is available.
          for (const old of entries.values()) if (old.owner === owner && (!old.closed || now >= old.retryAt)) await release(old).catch(() => {});
          if (entries.size + creating.size > 3) throw fault("video_busy", "All video seats are occupied. Text chat remains available.", 409);
          let result;
          try { result = await api("/v1/sessions", false, "POST", undefined, randomUUID()); }
          catch (error) { if (["video_network", "video_protocol"].includes(error.code)) quarantined = true; throw error; }
          if (!uuid.test(result.session_id || "")) { quarantined = true; throw fault("video_protocol", "Invalid video session response."); }
          entry = { id: randomUUID(), owner, upstream: result.session_id, created: now, seen: now, closed: false, connected: false, negotiated: false };
          entries.set(entry.id, entry);
          stateLog("video.created", entry, result);
          const started = Date.now();
          while (result.state === "starting" && Date.now() - started < 55000) {
            await new Promise(resolve => setTimeout(resolve, pollMs));
            if (entry.closed) throw fault("video_expired", "Video startup cancelled.", 409);
            entry.seen = Date.now(); result = await api(`/v1/sessions/${entry.upstream}`);
          }
          stateLog("video.startup_state", entry, result);
          if (result.state !== "ready" || result.error) throw fault("video_startup", "Video could not start. Text chat remains available.");
          const playback = await api(`/v2/sessions/${entry.upstream}/playback`, true);
          if (!Array.isArray(playback.iceServers) || playback.iceServers.length > 16) throw fault("video_protocol", "Invalid media configuration.");
          log({ event: "video.playback_ready", videoId: entry.id, upstreamSession: entry.upstream });
          return { videoId: entry.id, sessionId: entry.upstream, iceServers: playback.iceServers, expiresAt: entry.created + 550000, serverNow: Date.now() };
        } catch (error) { if (entry) await release(entry).catch(() => {}); throw error; }
        finally { creating.delete(owner); }
      }
      const entry = own(body.videoId, owner); entry.seen = Date.now();
      if (action === "close") { clientLog(entry, body.diagnostics); await release(entry); return { closed: true }; }
      if (action === "diagnostics") { clientLog(entry, body.diagnostics); return { accepted: true }; }
      if (action === "stats") {
        if (!entry.negotiated) throw fault("video_not_ready", "Connect playback first.", 409);
        const input = body.stats, payload = { session_id: entry.upstream };
        const required = ['frames_decoded', 'frames_dropped', 'packets_lost'];
        const counts = [...required, 'freeze_count', 'concealed_samples'];
        for (const key of [...counts, 'freeze_seconds', 'jitter_seconds', 'rtt_seconds']) {
          const value = input?.[key];
          if (value == null && !required.includes(key)) { payload[key] = null; continue; }
          if (typeof value !== 'number' || !Number.isFinite(value) ||
            (counts.includes(key) && !Number.isSafeInteger(value)) || (key !== 'packets_lost' && value < 0))
            throw fault("video_stats_invalid", "Invalid playback statistics.", 400);
          payload[key] = value;
        }
        if (entry.statsPending || Date.now() - (entry.lastStatsAt || 0) < 1000) return { accepted: false };
        entry.statsPending = true; entry.lastStatsAt = Date.now();
        try {
          const result = await api(`/v2/sessions/${entry.upstream}/stats`, true, "POST", payload);
          return { accepted: result.accepted === true };
        } finally { entry.statsPending = false; }
      }
      if (action === "heartbeat") {
        const status = await api(`/v1/sessions/${entry.upstream}`);
        if (!["ready", "receiving"].includes(status.state) || status.error) {
          stateLog("video.heartbeat_state", entry, status);
          // Cleanup must not replace the original session-state failure.
          void release(entry).catch(() => {});
          throw fault("video_expired", "Video session ended. Reconnect when ready.", 409);
        }
        return { state: status.state, inputActive: !!entry.active, expiresAt: entry.created + 550000, serverNow: Date.now() };
      }
      if (action === "offer") {
        if (entry.offering || entry.negotiated) throw fault("video_busy", "Reconnect before creating another playback connection.", 409);
        if (typeof body.sdp !== "string" || body.sdp.length > 60000 || !body.sdp.startsWith("v=0")) throw fault("video_offer", "Invalid media offer.", 400);
        entry.offering = true;
        try {
          const answer = await api(`/v2/sessions/${entry.upstream}/offer`, true, "POST", { sdp: body.sdp });
          if (answer.type !== "answer" || typeof answer.sdp !== "string" || answer.sdp.length > 65536) throw fault("video_protocol", "Invalid media answer.");
          entry.negotiated = true;
          log({ event: "video.offer_accepted", videoId: entry.id, upstreamSession: entry.upstream });
          return { type: "answer", sdp: answer.sdp, generation: answer.generation };
        } finally { entry.offering = false; }
      }
      if (action === "ready") {
        if (!entry.negotiated) throw fault("video_not_ready", "Connect playback first.", 409);
        if (!entry.audio) {
          const target = new URL(`/v1/sessions/${entry.upstream}/audio`, settings.base); target.protocol = "wss:";
          entry.audio = makeAudio(target.href, settings.inputKey);
          entry.audio.done.catch(() => {
            if (!entry.closed) {
              log({ event: "video.audio_input_failed", videoId: entry.id, upstreamSession: entry.upstream });
              void release(entry).catch(() => {});
            }
          });
          entry.audio.push(Buffer.alloc(1920));
        }
        entry.connected = true; return { ready: true };
      }
      throw fault("not_found", "Route was not found", 404);
    },
    voice(emit, owner, id) {
      const entry = own(id, owner);
      if (!entry.connected || entry.active) throw fault("video_not_ready", "Video is not ready for another reply.", 409);
      entry.active = true; let finished = false, cancelled = false, draining = false;
      const replyId = randomUUID();
      const audio = entry.audio;
      const fail = () => { if (cancelled) return; cancelled = true; emit("error", { code: "video_interrupted" }); void release(entry).catch(() => {}); };
      let tts;
      try { tts = makeTts((event, data) => {
        if (cancelled || finished || draining) return;
        if (event === "audio") {
          try {
            audio.push(Buffer.from(data.data, "base64"));
          } catch { fail(); }
        } else if (event === "done") {
          draining = true;
          void audio.drain({ tailMs: 300, onProgress: progress => log({
            event: "video.audio_tail", videoId: entry.id, upstreamSession: entry.upstream, replyId, ...progress,
          }) }).then(() => {
            if (cancelled) return;
            finished = true; entry.active = false; entry.tts = null;
            emit("done", {}); // Input drained, NOT playback complete. Retain the video lease.
          }).catch(fail);
        } else if (event === "error") fail();
        else emit(event, data);
      }); } catch { entry.active = false; void release(entry).catch(() => {}); throw fault("video_audio", "Video voice could not start. Text chat is still available."); }
      entry.tts = tts;
      return { push: text => tts.push(text), finish: () => tts.finish(), cancel: () => {
        if (finished || cancelled) return; cancelled = true; tts.cancel(); audio?.cancel(); void release(entry).catch(() => {});
      } };
    },
    close() { clearInterval(sweep); return Promise.allSettled([...entries.values()].map(release)); },
  };
}
