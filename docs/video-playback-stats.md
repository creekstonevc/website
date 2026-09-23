# Video playback diagnostics

The browser samples the current RTCPeerConnection with getStats every 3 seconds while connected. Reports never overlap; collection and transport errors do not interrupt playback. Closing/replacing the connection stops its timer and aborts outstanding requests.

POST /api/agent/video/stats uses the existing same-origin, signed conversation authorization and owned videoId. The gateway supplies the upstream session_id itself and forwards only validated metrics to POST /v2/sessions/{session_id}/stats using the server-only PLAYBACK_KEY. It permits at most one in-flight report and one report per second per session.

- frames_decoded / frames_dropped: sum of video inbound-rtp cumulative counters.
- packets_lost: sum of inbound audio/video packetsLost, preserving signed integers.
- freeze_count / freeze_seconds: video freezeCount / totalFreezesDuration.
- jitter_seconds: video inbound jitter (not audio jitter).
- rtt_seconds: currentRoundTripTime of the candidate pair selected by the video transport. Not end-to-end audio-to-video latency.
- concealed_samples: cumulative audio concealedSamples.

Missing optional metrics are null; missing required metrics cause that sample to be skipped. Counters are not deltas and are not replaced with synthetic zeroes.

Expand **Video session** beneath the video and use **Copy session ID** for the actual provider session ID, not the website's opaque videoId. If clipboard access fails, the full ID remains selectable. The ID also remains available on a failed connection for troubleshooting; reconnecting replaces it. No playback/input credentials are exposed.
