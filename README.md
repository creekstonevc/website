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
Creekstone deployment model. The `/api/agent/*` path remains a same-origin
Nginx proxy so the Boids API key never reaches the browser and SSE responses
remain unbuffered.

On the configured server, the project lives at `/root/creekstone-website`.
Keep `BOIDS_API_KEY` in `/root/creekstone-website/.env.local`, then run:

```bash
npm run deploy
```

The deployment script builds both `/` and `/agent/`, snapshots the current web
root and Nginx configuration under `/root/creekstone-deploy-backups`, stages
the new export, validates Nginx, and reloads it.

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
