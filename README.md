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
bodies, forces the published Yihao Agent model, streams Boids responses, signs
short-lived voice tickets, and renders ticketed replies through BytePlus Voice
Replication. Neither provider key reaches Nginx or the browser.

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
