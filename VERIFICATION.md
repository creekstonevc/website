# Verification

Reference: `https://jianyuanthomasdeng.com/`

## 2026-07-31 — Agent transcript containment

- Agent route shell is constrained to `100dvh` with `100svh` fallback
- Desktop and mobile grid content rows use `minmax(0, 1fr)`
- Identity and console panels use `min-height: 0` and clip external overflow
- Transcript owns vertical overflow with `overflow-y: auto` and contained
  overscroll; streamed replies no longer increase document height
- Desktop 1280 × 720: document `clientHeight` and `scrollHeight` both 720;
  transcript is independently scrollable at 379px
- Mobile 390 × 844: document `clientHeight` and `scrollHeight` both 844;
  transcript is independently scrollable at 339px

## 2026-07-31 — Agent migration and static deployment

- `npm run typecheck` — passed
- `npm run lint` — passed with zero warnings
- `npm run build` — passed; `/`, `/agent/`, `/icon.png`, and
  `/apple-icon.png` were statically generated
- Desktop visual review at 1280 × 720 — passed for hierarchy, contrast,
  full-color portrait, transcript containment, suggestions, and composer
- Founder input and submit state — passed
- Local API failure fallback — passed; the transcript displays the verified
  Creekstone contact instead of breaking the page
- Legacy section anchors — `#manifesto`, `#thesis`, `#portfolio`, `#quotes`,
  `#team`, `#perspectives`, and `#contact` are present in the static homepage
- Legacy `/agent/`, favicon, Apple Touch Icon, and Nginx `index-b.html`
  fallback migration are covered by the static export and deploy script
- Production static routes — `/`, `/agent/`, `/index-b.html`, `/icon.png`,
  and `/apple-icon.png` return HTTP 200
- Production streaming transport — passed against the existing Nginx
  `/api/agent/*` proxy; conversation creation returned 200 and the response
  stream emitted both `response.output_text.delta` and `response.completed`

## Source parity

The frozen fixture in `reference/original-site.html` is byte-equivalent to the
captured public reference after removing the invisible Impeccable
direction-contract comment and normalizing the final newline.

- SHA-256: `9122ac0411cf54cd81e66374748202a6cc6bce8f02099e1b27d275cf87b7a7ee`
- Result: `equal: true`

The live root route has since been migrated from that fixture to typed React
components, locally compiled Tailwind CSS, local fonts, and pinned npm motion
dependencies. The fixture remains available solely as parity evidence.

## Runtime coverage

- Desktop first viewport and Creekstone particle mark
- Scroll-driven horizontal chronology at start and mid-track
- Process-card fan
- Card deployment into the play slot
- Forensic detail overlay, narrative, stack, and milestones
- Ecosystem node field
- Mobile first viewport at 390 × 844
- Mobile process-card deployment
- Horizontal overflow check
- Browser console error check

## Automated checks

- `npm run lint`
- `npm run typecheck`
- `npm run build`
- Impeccable detector: no findings
- Browser console: no errors

## Component migration

- App Router page and layout: complete
- Hero / transition: React component
- Timeline: React component backed by typed content
- Projects / forensic shell: React component backed by typed project data
- Ecosystem shell: React component backed by typed network data
- Three.js, GSAP/ScrollTrigger, and Lenis: npm dependencies loaded by a
  client-only runtime bridge
- Tailwind CSS: local PostCSS build; CDN removed
- Desktop: 1280 × 720, no horizontal overflow
- Mobile: 390 × 844, no horizontal overflow

## Independent review

Disposition: **ship**

No material fixes were requested. Timeline edge clipping, tight mobile deployed
card framing, and the dark process/ecosystem transition were explicitly
classified as reference-matched behavior that must remain unchanged.

## Visual evidence

- `qa-desktop-top.png`
- `qa-desktop-timeline-start.png`
- `qa-desktop-timeline-mid.png`
- `qa-desktop-processes-cards.png`
- `qa-desktop-card-deployed.png`
- `qa-desktop-forensic-detail.png`
- `qa-desktop-ecosystem.png`
- `qa-mobile-top.png`
- `qa-mobile-processes.png`
- `qa-mobile-card-deployed.png`
- `qa-final-default-viewport.png`
