# Creekstone Ventures — Agent-Native Experience

An independent Next.js experience for Creekstone Ventures.

The root route is a componentized App Router application. Creekstone’s
content, visual identity, sections, styling, and runtime behavior are
independently editable. The original motion reference is retained only as a
frozen engineering fixture and is not served.

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:3100`.

## Production deployment

Production uses a static Next.js export served by Nginx, matching the original
Creekstone deployment model. Three exact same-origin API routes terminate at a
private Node gateway bound to `127.0.0.1:8790`. The gateway validates request
bodies, binds each browser to a Boids conversation with a signed, HttpOnly
cookie, restores recent history, forces the published Yihao Agent model,
streams Boids responses, signs short-lived voice tickets, and renders ticketed
replies through BytePlus Voice Replication. Neither provider key nor a raw
conversation credential reaches the application JavaScript.

On the configured server, the project lives at `/root/creekstone-website`.
Create `/root/creekstone-website/.env.local` from `.env.example` and provide
the Boids key, BytePlus key, and cloned speaker ID, then run:

```bash
npm run deploy
```

The deployment script runs the gateway tests, builds both `/` and `/agent/`,
installs the gateway as a hardened `systemd` service, writes provider secrets
to `/etc/creekstone-agent-gateway.env`, configures exact Nginx routes and rate
limits, snapshots the current release under `/root/creekstone-deploy-backups`,
validates Nginx, and activates the new static export.

Gateway checks:

```bash
npm run gateway:test
systemctl status creekstone-agent-gateway
curl http://127.0.0.1:8790/health
```

Public routes are intentionally limited to:

```text
POST /api/agent/conversations
POST /api/agent/responses
POST /api/agent/tts
```

TTS accepts only an HMAC-signed ticket emitted with an Agent response. It does
not accept arbitrary text, model IDs, speaker IDs, or BytePlus parameters.
An active signed conversation grants an expired voice ticket a bounded 24-hour
grace period; older tickets require reloading history to obtain fresh tickets.

The conversation cookie lasts 30 days, is scoped to `/api/agent`, and is the
active browser credential. A second signed, HttpOnly archive cookie retains up
to ten recent conversations (subject to cookie size and 30-day expiry). The UI
receives only opaque selectors; arbitrary upstream IDs cannot open a session.
Clearing cookies removes browser access, and this is not cross-device history.
Old conversations are never deleted when starting a new one. The first empty session
silently submits the fixed user prompt `Hi`; the gateway removes only that
oldest internal prompt when returning history, while preserving later user
messages with the same text. `New conversation` switches the active cookie and
generates a fresh Agent opening. Conversation titles and per-conversation drafts
are kept in localStorage; pending-request recovery is kept in sessionStorage.
Do not enter sensitive drafts on a shared browser.

### Agent interaction and recovery

- Manual transcript scrolling pauses the smooth bottom-follow animation;
  scrolling down to the bottom or sending the next message resumes it.
- IME composition, Safari keyCode 229 and the composition-end Enter are ignored
  for submission. Shift+Enter inserts a newline. The composer grows to 144px,
  displays the 4,000-character limit and restores drafts without stealing focus.
- Only explicitly rejected requests offer **Retry sending**. A lost stream or
  unknown outcome preserves partial text and offers **Sync history**, never an
  automatic resend. This is not stream reconnection or regeneration.
- A stream requires `response.completed`; EOF, `[DONE]` alone, `response.failed`,
  `response.incomplete` and empty output are not treated as success.
- **Load earlier messages** passes `{ after }` through the conversation route to
  Boids `GET /conversations/{id}/items?order=desc&limit=100&after=...`. The last raw
  item ID is the next cursor, including tool/reasoning-only pages. The reading
  position is preserved. A missing/ignored cursor fails explicitly without
  replacing current messages. Boids pagination support is assumed, not live-verified.
- Drafting while generating, user cancellation and live stream resumption remain
  intentionally deferred. Bootstrap reasoning remains hidden only in the UI.

Local regression checks (Node 22.6+ for the TypeScript client tests):

```bash
npm run agent:test
npm run gateway:test
npm run typecheck
npm run lint
npm run build
node scripts/agent-qa-server.mjs
```

The QA server binds localhost:3100 and serves the built export with a mocked
upstream, no credentials and no external API calls. Prompts `long`, `retry`,
`disconnect` and `seed history` exercise streaming, rejection, interrupted
transport and cursor pagination. It is not the production gateway.

## Project structure

```text
app/
  layout.tsx              metadata, fonts, document shell
  page.tsx                page composition
  globals.css             Tailwind entry + Creekstone visual system
components/experience/
  ExperienceChrome.tsx    loader, cursor, WebGL mount
  Hero.tsx
  Timeline.tsx
  Projects.tsx
  Ecosystem.tsx
  RuntimeLoader.tsx       npm dependency bridge and runtime bootstrap
components/agent/
  AgentChat.tsx           stateful streaming Yihao.AI founder channel
  AgentChat.module.css    responsive Creekstone dossier interface
gateway/
  core.mjs                validation, signed tickets, SSE and audio parsing
  server.mjs              private Boids + BytePlus HTTP gateway
  *.test.mjs              unit and integration security tests
lib/
  content.ts              all timeline, project, and ecosystem content
  types.ts                content contracts
public/
  portfolio-runtime.js    GSAP/Three/Lenis interaction engine
reference/
  original-site.html      frozen motion-study fixture, not served
```

## Editing

- Edit portfolio copy, dates, projects, stacks, accomplishments, and network
  nodes in `lib/content.ts`.
- Edit section markup in the matching file under `components/experience/`.
- Edit the Creekstone visual system in `app/globals.css`; Tailwind v4 is
  compiled locally through PostCSS.
- Edit shader, scroll, card-deployment, dossier, and ecosystem motion in
  `public/portfolio-runtime.js`.
- Replace `public/creekstone-mark.png` to change the 3D particle silhouette;
  the runtime samples the new mark automatically.
- `RuntimeLoader.tsx` exposes typed content to the interaction engine and loads
  the pinned npm packages only in the browser.

## Architecture boundaries

- This directory does not import from or write to `website-v2` or `demo`.
- There are no runtime CDN dependencies.
- GSAP `3.12.2`, Three.js `0.128.0`, and Studio Freight Lenis `1.0.19` are
  pinned to the versions used by the reference.
- `reference/original-site.html` remains a frozen, non-product source fixture
  for future motion research.
