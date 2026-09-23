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

## Connection lifecycle diagnostics

The provider document (revision 3, checked 2026-09-23) explicitly requires complete ICE gathering, forbids Trickle ICE and supplies temporary TURN configuration. Keep the documented 15s gathering deadline; never submit an incomplete offer on timeout. A candidate count does not prove that a route is usable. TURN connectivity failures still require network/provider investigation, not an unsupported signaling fallback.

Heartbeat starts 15s after open completes. The next heartbeat is scheduled 15s after the preceding one settles, with only one request in flight. Closing cancels its timer/request without replacing the original failure with a heartbeat error.

Nginx gives stats/diagnostics their own 60 requests/minute telemetry budget, separate from the 24 requests/minute lifecycle/cancel budget. Periodic stats must not consume capacity needed for heartbeat, open or close.

POST /api/agent/video/diagnostics accepts owned-session, bounded, whitelisted browser lifecycle data. `video.client_diagnostics` records stages, elapsed/ICE times, host/srflx/prflx/relay counts, numeric ICE errors, offerSent, gathering/connection states, and the close reason. Close carries a final snapshot before cleanup so timeout diagnostics survive connection cancellation. At most 40 diagnostic events per session. Do not log SDP, addresses, TURN URLs/credentials or raw error strings. Browser reports are marked as client-provided, not independently verified server facts.

Filter gateway logs by videoId or upstreamSession; `reason=ice_timeout` with `offerSent=false` identifies ICE preparation failure, while `reason=heartbeat_failed` identifies a genuine heartbeat failure. A 499 alone indicates request cancellation, not its cause.
