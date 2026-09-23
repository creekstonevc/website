import test from "node:test";
import assert from "node:assert/strict";
import { AvatarConnection, videoCodecs } from "./video-client.ts";

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
    if (url.endsWith("open")) return Response.json({ videoId: "opaque-video-id", iceServers: [] });
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
    const voiceId = await client.startReply(); assert.match(voiceId, /^[a-f0-9-]{36}$/);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(calls.find(call => call.url.endsWith("/voice/stream")).body.videoId, "opaque-video-id");
    await client.startReply("signed-opening-ticket");
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(calls.filter(call => call.url.endsWith("/voice/stream")).at(-1).body.ticket, "signed-opening-ticket");
    client.close(); assert.equal(peers[0].connectionState, "closed"); assert.equal(media.srcObject, null);
    assert.equal(calls.filter(call => call.url.endsWith("/close")).length, 1);
    assert.ok(calls.every(call => call.body.sessionKey === "session-a"));
  } finally { client.close(); Object.assign(globalThis, saved); }
});
