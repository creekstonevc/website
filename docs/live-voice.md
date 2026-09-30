# Local live voice preview

```bash
npm run dev:agent -- --server-credentials
```

Open http://localhost:3100/agent/, turn **Live voice on**, then send a message.
The existing **Play voice** action still replays completed answers.
**Stop audio** cancels only speech, not the LLM response. Starting another turn,
switching conversations or replaying a saved answer stops the previous audio.
The toggle applies to subsequent messages; it does not replay an already-running
answer or automatically read the hidden greeting.

The local server listens on 127.0.0.1 only. With `--server-credentials`, it reads
only Boids/BytePlus configuration from the existing `ssh creekstone` environment
file. Credentials stay in server process memory, never in HTML or a newly
written local env file. It generates a separate signing secret and local cookie
name; production cookies and conversations are not imported. Local test chats
still use the real upstream APIs and incur their usual usage charges.

Without that flag, the command reads `.env.local`; see `.env.example` for keys.
The local signing secret is ephemeral, so restarting the server creates a new
local conversation rather than accepting old cookies. This is a local-only
preview, not a deployment command.

## Transport

- Browser opens same-origin `POST /api/agent/voice/stream` with a random UUID
  and its current session selector. The signed HttpOnly cookie is authoritative.
- `/responses` claims that UUID once, under the same conversation. Only server
  observed `response.output_text.delta` content can reach TTS. Browser text,
  reasoning and tool events cannot be submitted directly to the voice channel.
- Gateway opens BytePlus V3 `/tts/bidirection` using `seed-icl-2.0` and the
  existing cloned speaker. Text is incrementally cleaned and sent through
  TaskRequest; video sends FinishSession at LLM completion, while pure audio
  finishes each bounded sentence group independently (see below). Audio reception runs
  independently, including after the text response stream closes.
- PCM16 mono at 24 kHz is relayed in audio SSE events. The AudioWorklet has a
  120 ms startup buffer and resamples to the browser's actual output rate.
  Playback starts before the full answer/audio file is available.
- A separate audio stream means audio failures/cancellation do not abort text.
  Existing complete-answer HMAC voice tickets remain unchanged for replay.

Bounds: one audio subscription per conversation, 32 global subscriptions,
12 starts/minute/conversation, 8,000 spoken characters by default, 120 seconds
per provider session, 330 seconds total subscription timeout, 24 MiB generated
audio ceiling, 512 KiB gateway response backlog, 120 seconds browser PCM queue.
Disconnecting the audio stream cancels provider synthesis. No automatic retries
can accidentally replay/pay for a response twice.

`first audio` in the UI measures from voice-channel startup to the first sample
scheduled by the worklet. It includes the LLM wait, not just TTS latency.
It cannot measure physical speaker output or replace listening checks.

## Pure-audio speech highlighting

- Both **Play voice** (signed-ticket replay) and **Live voice** now use the PCM
  streaming player. Replay sends the existing signed `ticket` to `/voice/stream`;
  it still requires the signed conversation cookie and matching session selector.
  No arbitrary browser text is accepted for synthesis. `/tts` remains available
  for existing clients; its MP3/cache format is unchanged.
- Pure audio synthesizes bounded sentence groups in separate TTS sessions;
  one current group plus at most one look-ahead preserves streaming playback.
  The gateway emits `segment: { text, startSample, endSample: null }` **before**
  that group's first PCM, then updates `endSample` after its last PCM. Positions
  are exact byte-count / 2 offsets in the concatenated 24 kHz mono stream.
  Audio stays ordered even if look-ahead completes first. No subtitles or guessed
  word durations are needed. The video TTS path/interruption protocol is unchanged.
- Seed ICL 2.0's optional event **364 / TTSSubtitle** has session-absolute word
  timestamps, but may arrive several seconds after audio. The low-level adapter
  can still decode it; pure audio no longer relies on it for highlighting.
- The AudioWorklet reports **consumed** source samples about every 80 ms.
  Downloaded/queued audio, network arrival time, and character-rate estimates do
  not drive highlighting. Pause and buffer underruns do not advance this clock.
  Device/Bluetooth output latency is not measured by this browser cursor.
- Sentence groups accumulate at least **24 letters/digits/CJK characters** before
  a sentence-ending mark or paragraph break; punctuation/whitespace do not count.
  A short final group is permitted. TTS batches are capped at 160 UTF-16 code
  units (prefer natural breaks; never split surrogate pairs). A long rendered
  group may span multiple audio batches. Matching uses the entire submitted
  batch, not greedy individual subtitle words; it ignores punctuation/case/width,
  preserves Markdown emphasis/lists and advances through repeated phrases in order.
  Code and link labels are excluded, matching the live TTS filter.
- At paragraph boundaries, literal numbered headings (for example `**3. Title**`)
  may remain in the DOM while TTS strips the enumeration. Alignment tries both
  the original and enumeration-free indexes, using the same original-position
  cursor and choosing the earliest match. This preserves cross-paragraph groups
  without skipping repeated phrases or ignoring quantities/decimals in prose.
- Default following centers the active group smoothly. Wheel/touch/keyboard or
  scrollbar browsing detaches it; new text/cues cannot reclaim scrolling.
  Manually moving back toward the active group within **35%–65% of list height**
  resumes following after scrolling settles for **180 ms** (and a held touch or
  scrollbar is released). Momentum can cross the exact center within this band
  without cancelling re-entry; scrolling through and out of the band stays
  detached. A small scroll away alone does not resume; returning does, even
  without first leaving the band. At the first/last sentence, the band follows
  the nearest reachable scroll position rather than an impossible visual center.
  The **Back to speaking** icon explicitly resumes; the next playback starts
  following. This compact control (smaller on mobile) appears only when detached
  and more than one transcript viewport above the bottom, not on every gesture.
  Its accessible label and tooltip retain the action name; without playback it
  returns to the latest message instead.
  Reduced-motion preference disables scrolling/color animations.
- Each group is highlighted from its first consumed sample, regardless of late
  subtitles. If adjacent Markdown groups share an audio batch, they highlight
  together rather than inventing an internal timing. Unmatched text is not given
  guessed timings. Thinking/reasoning stays outside the spoken text and mapping.
  Stopping,
  changing conversations, starting another response, or entering video clears
  both the highlight and old playback mapping.

Local deterministic browser QA (silent PCM; no upstream usage):

```bash
npm run build
QA_PORT=3101 QA_SPEECH=1 node scripts/agent-qa-server.mjs
```

The `linebreak` prompt reproduces a short sentence followed by a numbered bold
heading. Replay its reply to check a batch spanning both paragraphs and wrapping
across visual lines; the fixture uses silent PCM and no upstream API calls.

Live protocol checks on 2026-09-29: the original multi-sentence session returned
its first audio at ~3.5 seconds but its first subtitle only at ~13.2 seconds.
The bounded-batch regression probe delivered every text boundary before PCM,
with continuous sample offsets; first audio (~5.3 seconds in that run) arrived
before the final LLM-text submission. This is not a latency guarantee; network
or synthesis delays can still cause normal buffering. Prefetch is limited to
two sessions, 4 MiB buffered PCM per batch and 24 MiB total generated audio.
The deterministic QA fixture also sends late/unmatched subtitles, not idealized
subtitle-before-audio events.
Browser regression checks confirmed that both the second and third assistant
replies (with reasoning blocks) start highlighting their first body group;
reasoning is never highlighted, pause preserves the group, and Back to speaking
centers that group in the message list.

## Verification

```bash
npm run gateway:test
npm run agent:test
npm run typecheck
npm run lint
npm run build
```

Includes binary-frame parsing, true duplex order, partial Markdown filtering,
session isolation, opt-in behavior, cancellation, PCM resampling and buffering.
Live upstream test on 2026-09-21: existing cloned voice returned first PCM at
approximately 2.6 seconds, before FinishSession, then accepted a second sentence.
This single sample is not a latency guarantee.

## Production deployment

`deploy.sh` installs `live-voice.mjs` and the separately locked `ws` dependency
from `gateway/package-lock.json` into the standalone gateway directory. It checks
module loading as the service user before restarting the gateway. Nginx exposes
the two exact routes `/api/agent/voice/stream` and `/api/agent/voice/cancel`;
the audio route disables buffering/compression and has a 345-second read timeout.
Audio subscriptions have their own connection-limit zone so text and audio can
remain open together. Both routes retain same-origin/signed-session checks.
The existing release snapshot includes the gateway dependencies and Nginx config.

The website remains a static export with a separate private gateway service.
Running the local preview command alone does not change production configuration.

Reference: https://docs.byteplus.com/en/docs/byteplusvoice/streaming_tts
