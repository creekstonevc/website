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
  TaskRequest; FinishSession is sent at LLM completion. Audio reception runs
  independently, including after the text response stream closes.
- PCM16 mono at 24 kHz is relayed in audio SSE events. The AudioWorklet has a
  120 ms startup buffer and resamples to the browser's actual output rate.
  Playback starts before the full answer/audio file is available.
- A separate audio stream means audio failures/cancellation do not abort text.
  Existing complete-answer HMAC voice tickets remain unchanged for replay.

Bounds: one audio subscription per conversation, 32 global subscriptions,
12 starts/minute/conversation, 8,000 spoken characters by default, 120 seconds
provider timeout, 330 seconds total subscription timeout, 24 MiB generated
audio ceiling, 512 KiB gateway response backlog, 120 seconds browser PCM queue.
Disconnecting the audio stream cancels provider synthesis. No automatic retries
can accidentally replay/pay for a response twice.

`first audio` in the UI measures from voice-channel startup to the first sample
scheduled by the worklet. It includes the LLM wait, not just TTS latency.
It cannot measure physical speaker output or replace listening checks.

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
