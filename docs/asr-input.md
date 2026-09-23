# Hold-to-talk input

## Product behavior

- Text/Voice input is independent of the Text/Video presentation switch. Both switches sit beneath Yihao’s portrait/video. Voice input uses the existing black/gold, Space Grotesk identity, a narrower desktop transcript and fewer metadata labels. The text composer and Send button are hidden in Voice mode: hold to speak, release to send, then read the transcript. Switch back to Text to edit a draft. Mobile retains full width.
- Hold Space outside editable fields, or hold the microphone button on touch devices. A tap does not latch recording on. Release ends capture; the nonempty final transcription sends automatically through the normal chat send guards. Partial results only update the draft; blank results, cancelled captures and errors never auto-send. The recording lock is released before submission, and duplicate final callbacks are ignored. Typed drafts survive input-mode switches.
- Permission requests, setup, recording, finalization and errors have distinct feedback. A recording lasts at most55seconds. No audio is collected just by selecting Voice input.
- A new hold cancels the previous unfinished recognition. Late responses from the previous capture are ignored. Leaving the mode, changing conversation, blur, hidden tab and unmount close the microphone and recognition connection. A late microphone permission grant cannot restart cancelled capture.
- Local TTS playback is stopped when capture begins. Video audio is temporarily muted during recognition and restored afterward; the video session is not destroyed. This is not an LLM stop-generation feature. Input remains unavailable while a reply is generating.
- Multiline text uses bottom alignment for the prompt marker, textarea and send button.

## Streaming protocol

Source: [BytePlus ASR Streaming](https://docs.byteplus.com/en/docs/byteplusvoice/asrstreaming).

Browser AudioWorklet → 16kHz mono PCM16, 100ms frames → same-origin WebSocket `/api/agent/asr/stream` → Gateway → BytePlus `wss://voice.ap-southeast-1.bytepluses.com/api/v3/sauc/bigmodel_async`.

The Gateway reuses the server-only `BYTEPLUS_TTS_API_KEY`. Resource `volc.bigasr.sauc.duration` is authorized on the current account. On2026-09-23, `volc.seedasr.sauc.duration` (2.0) returned403 `requested resource not granted`; therefore use the authorized1.0 streaming model, not a silent fallback to batch transcription.

Binary upstream frames use gzip, JSON initialization and raw PCM audio; the final audio flag ends recognition. Full partial results replace the current recognition draft rather than appending deltas; only the final server flag finishes the turn. Enable dual-pass final correction.

## Security and bounds

- Origin allowlist + signed conversation cookie + matching sessionKey required before upgrade. Only the fixed ASR upstream is reachable; browser cannot choose URL, resource, model or headers.
- One active capture per conversation, maximum8 concurrent captures,12 starts per conversation per minute. A new capture closes the previous one.
- Maximum60seconds of PCM bytes,16KiB client WebSocket frames, bounded upstream responses/decompression and queue size;10second input idle timeout,75second total connection timeout,10second final result timeout.
- No audio storage, no audio/transcript/key logging. Log only request correlation, sanitized provider log ID and numeric/generic error code.
- Nginx upgrade forwarding is installed by `deploy.sh`; local `dev:agent` forwards upgrades as well. No production deployment was performed for this feature's development.

## Video expiry

`/video/open` and `/video/heartbeat` return `expiresAt` and `serverNow`. The client compensates for clock offset. Show an understated second-by-second reminder only in the final60seconds of the current connected session, not for an old or failed session. The deadline is the actual550second gateway lease (the provider has a600second cap); text chat is not expired. Reconnect receives a new deadline.

## Verification

- Real ASR1.0 handshake and final silent-audio response passed.
- Synthetic English speech returned incremental text and the final sentence “Hello, this is a speech recognition test for Creekstone.” No microphone or private recording used.
- Automated tests cover frame parsing/bounds, isolation/authentication, superseding a capture, finalization, late permission grant, discarded stale callbacks,48kHz→16kHz conversion and video clock-offset conversion.
- Desktop/mobile visual checks include compact voice controls and multiline bottom alignment. Real microphone permission UX and user speech remain manual acceptance checks.
