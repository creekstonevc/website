# Hold-to-talk input

## Product behavior

- Text/Voice input is independent of the Text/Video presentation switch. Both switches sit beneath Yihao’s portrait/video. Voice input uses the existing black/gold, Space Grotesk identity, a narrower desktop transcript and fewer metadata labels. The text composer and Send button are hidden in Voice mode: hold to speak, release to send, then read the transcript. Switch back to Text to edit a draft. Mobile retains full width.
- Hold Space outside editable fields, or hold the microphone button on touch devices. A tap does not latch recording on. Release ends capture; the nonempty final transcription sends automatically through the normal chat send guards. Partial results only update the draft; blank results, cancelled captures and errors never auto-send. The recording lock is released before submission, and duplicate final callbacks are ignored. Typed drafts survive input-mode switches.
- To cancel on touch, slide outside the talk button: the button changes to “Release to cancel”; sliding back resumes the normal release-to-send gesture. Release outside discards the recording, even during microphone setup. On desktop, Escape or Backspace cancels setup, recording or final recognition. Hints are visible while holding. Cancellation closes the microphone/ASR connection, restores the draft from before this hold, and ignores late results; it does not send a message. Pointer cancellation/capture loss also discards instead of sending. The existing ASR Ready output-interruption behavior remains unchanged.
- Instructions follow how each hold started, not viewport width: cancellation guidance and status share one reserved slot above the button on both desktop and mobile. Guidance takes priority while cancellation is available; idle, cancelled, finalizing, disabled and error states occupy that same slot otherwise. There is no separate status line below the button. Space holds show the highlighted Escape / Backspace shortcut; touch holds show slide-off/lift-finger instructions, and mouse holds show move-off/release instructions. Sliding outside changes the copy in that same upper area. Pointer holds do not show keyboard cancellation copy or the Space badge. Switching input methods updates the instructions for the next hold, including on hybrid devices.
- On phones (up to 700px wide), the composer uses compact Text/Voice tabs and a shared 22px hint/status slot above the 48px talk button: cancellation guidance takes priority while holding; idle, cancelled, finalizing, disabled and error states use that same slot otherwise. There is no separate status row below the button on mobile. Shorter slide-out instructions keep the button in place throughout the gesture. Video and reconnect controls are visually smaller while retaining 44px touch targets; diagnostic video-session details are hidden on phones, unchanged on desktop.
- Mobile video uses the available width at 16:9, capped at 30% of viewport height / 260px (26% on short screens). The video is contained without stretching when the frame reaches its height cap. Reconnect appears in the frame center on both desktop and mobile; on mobile, the Video switch is centered underneath. Error text remains readable/scrollable below the reconnect action. On extremely short viewports, including a visible keyboard, the shell can scroll to preserve a usable input area and bounded transcript rather than clipping controls. Other desktop controls retain their positions.
- Permission requests, setup, recording, finalization and errors have distinct feedback. A recording lasts at most55seconds. No audio is collected just by selecting Voice input.
- A new hold cancels the previous unfinished recognition. Late responses from the previous capture are ignored. Leaving the mode, changing conversation, blur, hidden tab and unmount close the microphone and recognition connection. A late microphone permission grant cannot restart cancelled capture.
- Output interruption starts only after ASR Ready and microphone capture setup succeed, not on initial Space/pointer down. Early release, denied permission and connection failure leave the previous output alone. Local TTS playback stops; video uses the soft-interruption path described in `realtime-avatar.md`. Video audio stays muted after release, cancellation or an empty transcript, and is restored only when a subsequent reply starts sending PCM. This is not an LLM stop-generation feature. Input remains unavailable while a reply is generating.
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
