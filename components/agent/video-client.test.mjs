import test from "node:test";
import assert from "node:assert/strict";
import { AvatarConnection, videoCodecs, playbackStats, waitForIceGathering, iceCandidateCounts } from "./video-client.ts";

test('non-trickle ICE waits for completion, rejects partial timeout and cleans listeners on abort', async () => {
  const peer = new EventTarget(); peer.iceGatheringState = 'gathering';
  peer.localDescription = { sdp: 'a=candidate:1 1 UDP 1 192.0.2.1 1234 typ host\r\n' };
  const controller = new AbortController();
  await assert.rejects(waitForIceGathering(peer, controller.signal, 5), /ICE gathering timed out/);
  let completed = false;
  const waiting = waitForIceGathering(peer, controller.signal, 100).then(() => { completed = true; });
  await Promise.resolve(); assert.equal(completed, false);
  peer.iceGatheringState = 'complete'; peer.dispatchEvent(new Event('icegatheringstatechange')); await waiting;
  peer.iceGatheringState = 'gathering';
  const aborting = waitForIceGathering(peer, controller.signal, 100); controller.abort();
  await assert.rejects(aborting, /Cancelled/);
  await assert.rejects(waitForIceGathering(peer, controller.signal, 100), /Cancelled/);
  assert.deepEqual(iceCandidateCounts(peer.localDescription.sdp + 'a=candidate:2 1 UDP 1 192.0.2.2 1234 typ relay\r\n'),
    { host: 1, srflx: 0, prflx: 0, relay: 1 });
});

test('heartbeat is single-flight and an intentional close cancellation never produces a failure', async () => {
  const original = globalThis.fetch, calls = [], states = [];
  globalThis.fetch = async (url, options) => {
    calls.push(url);
    if (url.endsWith('/heartbeat')) return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    return Response.json({ closed: true });
  };
  const client = new AvatarConnection('session', element(), state => states.push(state));
  client.id = 'video';
  try {
    const pending = client.sendHeartbeat();
    await client.sendHeartbeat();
    assert.equal(calls.filter(url => url.endsWith('/heartbeat')).length, 1);
    client.close(); await pending;
    assert.deepEqual(states, []);
    assert.equal(calls.filter(url => url.endsWith('/close')).length, 1);
    await client.sendHeartbeat();
    assert.equal(calls.filter(url => url.endsWith('/heartbeat')).length, 1);
  } finally { client.close(); globalThis.fetch = original; }
});

test('playback telemetry uses cumulative real counters and selected-pair RTT, preserving unknowns and signed loss', () => {
  const rows = [
    { id: 'v', type: 'inbound-rtp', kind: 'video', framesDecoded: 250, framesDropped: 2, packetsLost: -3, transportId: 't', jitter: .02 },
    { id: 'a', type: 'inbound-rtp', kind: 'audio', packetsLost: 1 },
    { id: 't', type: 'transport', selectedCandidatePairId: 'selected' },
    { id: 'unused', type: 'candidate-pair', currentRoundTripTime: 9 },
    { id: 'selected', type: 'candidate-pair', currentRoundTripTime: .08 },
  ];
  const report = () => new Map(rows.map(row => [row.id, row]));
  assert.deepEqual(playbackStats(report()), { frames_decoded: 250, frames_dropped: 2, packets_lost: -2,
    freeze_count: null, freeze_seconds: null, jitter_seconds: .02, rtt_seconds: .08, concealed_samples: null });
  delete rows[2].selectedCandidatePairId;
  assert.equal(playbackStats(report()).rtt_seconds, null);
  delete rows[0].framesDropped;
  assert.equal(playbackStats(report()), null);
});

const h264 = { mimeType: "video/H264", sdpFmtpLine: "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f", clockRate: 90000 };
test("only the documented H264 packetization and profile are advertised", () => {
  assert.deepEqual(videoCodecs([h264, { mimeType: "video/VP8" }, { ...h264, sdpFmtpLine: "profile-level-id=640032;packetization-mode=1" },
    { ...h264, sdpFmtpLine: "profile-level-id=42e01f;packetization-mode=0" }]), [h264]);
});
function element() { return { srcObject: null, play: async () => {}, pause() {}, addEventListener() {}, removeEventListener() {}, cancelVideoFrameCallback() {} }; }
test("unconfigured preview never opens RTC/audio, preserves chat availability and releases no foreign session", async () => {
  const previous = globalThis.fetch, requests = [], states = [];
  globalThis.fetch = async (url) => { requests.push(url); return Response.json({ enabled: false }); };
  const client = new AvatarConnection("signed-session", element(), state => states.push(state));
  try {
    await client.connect(); assert.equal(states.at(-1).phase, "preview");
    assert.equal(await client.startReply(), undefined); client.close();
    assert.deepEqual(requests, ["/api/agent/video/capabilities"]);
  } finally { client.close(); globalThis.fetch = previous; }
});
test("video receives exactly two tracks, waits for ICE and first frame, routes reply without WebAudio, and cleans up", async () => {
  const saved = { fetch: globalThis.fetch, RTCPeerConnection: globalThis.RTCPeerConnection, RTCRtpReceiver: globalThis.RTCRtpReceiver, MediaStream: globalThis.MediaStream };
  const calls = [], states = [], transceivers = [], peers = []; let frame;
  class Peer {
    iceGatheringState = "complete"; connectionState = "new";
    constructor(options) { peers.push(this); assert.equal(options.bundlePolicy, "max-bundle"); }
    addTransceiver(kind, options) { transceivers.push({ kind, ...options }); return { setCodecPreferences: codecs => assert.deepEqual(codecs, [h264]) }; }
    async createOffer() { return { type: "offer", sdp: "v=0\r\n" }; }
    async getStats() { return new Map([['v', { id: 'v', type: 'inbound-rtp', kind: 'video', framesDecoded: 1, framesDropped: 0, packetsLost: 0 }]]); }
    async setLocalDescription(value) { this.localDescription = value; }
    async setRemoteDescription(value) { assert.equal(value.type, "answer"); this.connectionState = "connected"; this.onconnectionstatechange(); }
    addEventListener() {} removeEventListener() {}
    close() { this.connectionState = "closed"; }
  }
  globalThis.RTCPeerConnection = Peer;
  globalThis.RTCRtpReceiver = { getCapabilities: () => ({ codecs: [h264] }) };
  globalThis.MediaStream = class { addTrack() {} };
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body); calls.push({ url, body });
    if (url.endsWith("capabilities")) return Response.json({ enabled: true });
    if (url.endsWith("open")) return Response.json({ videoId: "opaque-video-id", sessionId: 'provider-session-id', iceServers: [], serverNow: 1000, expiresAt: 46000 });
    if (url.endsWith('/stats')) return new Response('', { status: 503 });
    if (url.endsWith("offer")) return Response.json({ type: "answer", sdp: "v=0\r\n" });
    if (url.endsWith("/voice/stream")) return new Response('event: ready\ndata: {}\n\nevent: done\ndata: {}\n\n');
    return Response.json({ ready: true });
  };
  const media = { ...element(), requestVideoFrameCallback(callback) { frame = callback; return 1; } };
  const client = new AvatarConnection("session-a", media, state => states.push(state));
  try {
    await client.connect(); assert.deepEqual(transceivers, [{ kind: "video", direction: "recvonly" }, { kind: "audio", direction: "recvonly" }]);
    assert.equal(await client.startReply(), undefined);
    frame(); await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(states.at(-1).phase, "connected");
    assert.ok(Math.abs(states.at(-1).expiresAt - Date.now() - 45000) < 1000);
    assert.equal(states.at(-1).sessionId, 'provider-session-id');
    await client.reportStats();
    assert.equal(calls.find(call => call.url.endsWith('/stats')).body.stats.frames_decoded, 1);
    assert.equal(states.at(-1).phase, 'connected', 'telemetry failure must not close playback');
    const voiceId = await client.startReply(); assert.match(voiceId, /^[a-f0-9-]{36}$/);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(calls.find(call => call.url.endsWith("/voice/stream")).body.videoId, "opaque-video-id");
    await client.startReply("signed-opening-ticket");
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(calls.filter(call => call.url.endsWith("/voice/stream")).at(-1).body.ticket, "signed-opening-ticket");
    client.close(); assert.equal(peers[0].connectionState, "closed"); assert.equal(media.srcObject, null);
    await client.reportStats();
    assert.equal(calls.filter(call => call.url.endsWith('/stats')).length, 1);
    assert.equal(calls.filter(call => call.url.endsWith("/close")).length, 1);
    assert.ok(calls.every(call => call.body.sessionKey === "session-a"));
  } finally { client.close(); Object.assign(globalThis, saved); }
});
