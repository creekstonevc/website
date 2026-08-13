---
name: Creekstone Ventures Founder Signal Field
description: A warm-ivory and dark-gold venture platform led by Creekstone's living particle mark, verified founder language, and signal-driven interaction.
colors:
  ink-black: "#000000"
  process-black: "#030303"
  timeline-black: "#050505"
  stripe-black: "#111111"
  dot-black: "#222222"
  paper-white: "#ffffff"
  muted-gray: "#6b7280"
  soft-gray: "#d1d5db"
  signal-yellow: "#ffcc00"
  alert-red: "#ff3333"
  verification-green: "#4ade80"
  creekstone-gold: "#e5bd52"
  creekstone-brand-gold: "#c9a84c"
  creekstone-brand-gold-light: "#e8c97a"
  creekstone-brand-gold-deep: "#5a4009"
  creekstone-brand-black: "#060606"
  detail-ice: "#ebebff"
typography:
  display:
    fontFamily: "Space Grotesk, sans-serif"
    fontSize: "12vw"
    fontWeight: 900
    lineHeight: 1
    letterSpacing: "-0.05em"
  headline:
    fontFamily: "Space Grotesk, sans-serif"
    fontSize: "3rem"
    fontWeight: 900
    lineHeight: 1
    letterSpacing: "-0.05em"
  body:
    fontFamily: "Space Grotesk, sans-serif"
    fontSize: "1rem"
    fontWeight: 300
    lineHeight: 1.625
    letterSpacing: "normal"
  label:
    fontFamily: "Space Grotesk, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "0.1em"
rounded:
  none: "0"
  micro: "2px"
  full: "999px"
  circle: "50%"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  2xl: "48px"
components:
  creekstone-loader:
    backgroundColor: "{colors.creekstone-brand-black}"
    textColor: "{colors.creekstone-brand-gold-light}"
    mark: "Creekstone three-ring logo"
    motion: "first-paint hidden state, three-speed gold particle flow, assemble, brand reveal, upward aperture exit"
    duration: "2.44s"
  button-command:
    backgroundColor: "{colors.ink-black}"
    textColor: "{colors.paper-white}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "10px 14px"
  button-command-hover:
    backgroundColor: "{colors.paper-white}"
    textColor: "{colors.ink-black}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "10px 14px"
  chip-skill:
    backgroundColor: "transparent"
    textColor: "{colors.ink-black}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "4px 12px"
  project-card:
    backgroundColor: "{colors.ink-black}"
    textColor: "{colors.paper-white}"
    rounded: "{rounded.none}"
    padding: "20px"
    width: "220px"
    height: "300px"
  project-card-mobile:
    backgroundColor: "{colors.ink-black}"
    textColor: "{colors.paper-white}"
    rounded: "{rounded.none}"
    padding: "16px"
    width: "180px"
    height: "260px"
  perspective-node:
    backgroundColor: "rgba(243,239,229,0.84)"
    textColor: "#17140d"
    rounded: "{rounded.none}"
    size: "50px–188px by depth"
---

# Design System: Creekstone Ventures Founder Signal Field

## Creekstone Homepage Direction

The first viewport now belongs fully to Creekstone Ventures. Its creative
north star is **“The Founder Signal Field”**: Creekstone is presented as the
system that detects native variables before the market sees them. A warm ivory
field replaces pure white, the original gold mark remains in motion as a
particle structure, and fine signal axes, moving location points, precise
corner marks, and editorial edge copy give the page the feeling of active
discovery rather than a conventional fund homepage.

The homepage remains transparent above the fixed WebGL field. On scroll, the
ground plane cuts to black and the second full-screen chapter becomes a dark
**Agent Runtime Chamber** that bridges the warm-ivory hero to the black
computational-dossier world. The gold Creekstone WebGL particle mark remains
central inside a calibrated targeting field; Yihao’s identity dossier stays in
color, while a hard-edge live console establishes the AI VC Agent as an active
product rather than a marketing card.

All homepage language is sourced from the Creekstone website: “WE CREATE · WE
SPARK,” “Building China’s Founders Fund,” “Agent Native · Founder Friendly,”
“China → Global,” “We don’t bet on experience. We bet on native variables,”
and “World’s First AI VC Agent.” The agent description and live prompt are
also carried over from Creekstone’s existing site. No performance figures or
investment claims are added at this stage.

The homepage uses Space Grotesk throughout, with weight, tracking, and line-height
separating display commands from narrative copy. `#f3efe5` forms the warm field, `#17140d` the primary ink, and the
official dark-gold family for signal elements. Motion is concentrated in the
particle mark, three quiet signal pulses, the thesis navigation trace, and the
Agent Runtime Chamber’s shutter, scan, and dossier cut-in before the console
reveal. Touch layouts remove the custom cursor, keep the portrait at 36vw,
shift the console start to 64% for a clean dossier-console separation, and
never apply grayscale to the portrait.

## Yihao.AI Founder Channel

The `/agent/` route extends the Agent Runtime Chamber into an Operate-mode
founder channel. It keeps the same black instrument field, Creekstone gold
signal geometry, full-color Yihao dossier, sharp registration marks, and
single-family Space Grotesk hierarchy. The page does not repeat the homepage
loader or chapter controls: identity stays fixed at left while the live
conversation owns the larger right-hand console.

Assistant output is treated as an evolving signal record. Streaming reasoning
appears in a collapsible trace, final output supports Markdown and GFM, and
each turn receives a terse origin label and functional sequence number.
The silent first-turn bootstrap never exposes its internal reasoning trace;
reasoning remains available only for replies to visible founder messages.
Founder messages are offset but never converted into generic chat bubbles.
Suggested prompts remain secondary pills; the square gold transmit control is
the only primary action. Error states resolve inside the transcript and point
to the verified Creekstone email rather than opening a detached alert.

On mobile, the identity dossier compresses into a horizontal color portrait
and summary above a full-width conversation console. The composer remains at
the end of the console, prompt suggestions scroll horizontally, and all
custom-pointer behavior is disabled by the route shell. Motion honors
`prefers-reduced-motion`; no portrait is desaturated or converted to grayscale.

The route is statically exported at `/agent/`. All live requests remain
same-origin under `/api/agent/*`, with conversation creation and streamed
responses handled by Nginx so the API key never enters the browser bundle.

## Overview

**Creative North Star: "The Computational Dossier"**

This is an Experience-mode venture platform rendered as a live technical field rather than a conventional fund website. Creekstone's three-ring gold mark is reconstructed as a volumetric point cloud across the identity chamber, a pinned portfolio reel translates vertical scroll into ten investment dossiers, a black credential table introduces the three-person investment team, and a reactive source field closes on Creekstone perspectives and founder contact. The design is deliberately computational, editorial, monochrome, and physical.

Creekstone's supplied content is the factual authority while the Thomas Deng reference remains a motion and interaction reference. Black and white establish the world; gold identifies Creekstone; original portfolio-company colors remain intact inside controlled light or dark logo trays; yellow and green appear only as terse machine-state signals.

### Implementation Map

The visual system is implemented as a local Next.js App Router application.
`app/page.tsx` composes five focused experience components. All portfolio,
team, and perspective content is typed and centralized in
`lib/content.ts`; visual rules live in `app/globals.css`; the original
GSAP/ScrollTrigger, Three.js, and Lenis behavior lives in the isolated
`public/portfolio-runtime.js` engine and is bootstrapped by
`RuntimeLoader.tsx`. The frozen captured source lives under `reference/` and is
not part of the runtime. The former project and accomplishment content remains
available as dormant backup code.

**Key Characteristics:**

- A binary white/black field that changes state during the scroll narrative
- A Space Grotesk-only typography system: dense display commands and light, measured narrative text
- Creekstone gold particle mark, telemetry labels, grid traces, scanlines, and low-opacity noise
- A dark Agent Runtime Chamber bridging the warm-ivory hero to the black computational dossier world
- Yihao’s full-color identity dossier separated from a hard-edge live console by precise responsive geometry
- Full-screen chapter holds resolved by a single 3px bottom charge line
- Ten investments expressed as a pinned horizontal deal-room reel with an integer clock counter
- Three investors expressed as full-color physical credentials that deploy into a biography view
- Eleven real Creekstone perspectives expressed as a pointer-reactive source field beside a functional founder contact panel and integrated footer

## Colors

The palette is a hard black-and-white instrument panel with a small set of status colors.

### Primary

- **Instrument Ink:** The dominant text, outline, card, command-control, and core-node color.
- **Paper Field:** The hero, final perspective/contact field, and inverse text color.

### Secondary

- **Signal Yellow:** Marks active project status, portfolio sequence metadata, and dossier emphasis.
- **Portfolio Brand Color:** Company logos retain the original colors and contrast treatment published by each company.

### Tertiary

- **Verification Green:** Reserved for the live CHECK indicator.
- **Creekstone Gold:** The source color of the three-ring particle mark; its darker and lighter tonal variants preserve contrast across white and black chapters.
- **Detail Ice:** Briefly cools the forensic overlay while the gold mark emits a sharper pulse.

### Neutral

- **Process Black:** The projects chapter background.
- **Portfolio Black:** The portfolio reel’s background from its first frame through its release.
- **Stripe Black:** The pixel-card diagonal hatch.
- **Dot Black:** The projects chapter’s dotted field.
- **Muted Gray:** Secondary telemetry, stages, and footer metadata.
- **Soft Gray:** Empty-node borders and quiet structural strokes.

### Named Rules

**The Binary Field Rule.** Major chapters resolve to white-on-black or black-on-white; gray supports hierarchy but never becomes a competing theme.

**The Signal Rarity Rule.** Yellow and green communicate state or milestone only. They do not become decorative gradients or broad surface fills.

## Typography

**Display Font:** Space Grotesk (with sans-serif fallback)  
**Body Font:** Space Grotesk (with sans-serif fallback)  
**Label Font:** Space Grotesk (with sans-serif fallback)

**Character:** Space Grotesk supplies the heavy, compressed feeling of a technical title card, the tracked precision of telemetry, and—at 300 weight with restrained negative tracking—a quieter human voice for longer project and portfolio narratives.

### Hierarchy

- **Display** (900, 12vw mobile / 8vw at 768px and above, 1 line-height): The centered name and the largest identity statements.
- **Section Display** (900, 1.875rem–4.5rem, approximately 1 line-height): PORTFOLIO, TEAM, ECOSYSTEM, VC names, and dormant forensic dossier titles.
- **Headline** (700–900, 1rem–3rem, tight line-height): Portfolio companies, card names, and accomplishment titles.
- **Body** (300–400, 0.875rem–1rem, relaxed line-height): Manifesto, chronology descriptions, project summaries, narrative logs, and milestone copy.
- **Label** (700, 0.5rem–0.75rem, 0.1em–0.3em tracking, uppercase): Corner telemetry, statuses, controls, card tags, dates, stack tokens, and node metadata.

### Named Rules

**The Single-Family Contrast Rule.** Space Grotesk owns the entire interface. Weight, scale, tracking, case, and line-height—not a neutral secondary face—separate identity commands from explanatory prose.

**The Telemetry Case Rule.** Interface metadata and actions are uppercase and tracked. Human narrative copy stays in normal case.

**The Functional Number Rule.** Do not prefix section headings with source-document ordinals. Numbers appear only when they communicate live progress, an investment position, or a verified quantity.

## Layout

The page is a sequence of full-viewport chapters backed by one fixed global field and one fixed WebGL Creekstone mark. The hero uses 32px corner insets on both axes: identity is centered, telemetry occupies the upper corners, and manifesto/stack chips oppose the scroll cue along the bottom edge. Mobile retains that four-corner composition and compresses the center title to the viewport instead of reorganizing it into a conventional header.

Hero, Agent, Team, and the terminal Perspectives / Contact chapter each use a 0.72-viewport pin/hold runway; Timeline preserves its existing horizontal pin. During each full-screen hold, scroll charges one 3px line across the entire bottom edge from 0% to 100%. The chapter releases toward the next screen only after the line reaches 100%; the line stays full during that transition and resets only when the next full screen takes over. Downstream hold controllers are registered only after Timeline has measured and inserted its horizontal pin space, and the charge line reads directly from those controller ranges rather than from transient element positions.

The Agent Runtime Chamber is the dark hinge between the warm-ivory hero and the black computational dossier chapters. It keeps the gold Creekstone WebGL particle mark centered, deploys Yihao’s identity dossier in full color, and resolves the hard-edge live console through a shutter/scan/dossier cut-in. On mobile, the portrait is 36vw and the console begins at 64%, preserving clean dossier-console separation without grayscale.

The portfolio chapter is a pinned horizontal Creekstone deal-room review and is black with warm-white typography from its first frame. Its content is `width: max-content`, begins with a conviction statement, then alternates ten investment dossiers above and below the gold center rail. Vertical scroll drives the strip across its full measured width. Each company receives one structured record: original-color official logo, category, stage, founder, verified description, and direct public link when available. Pale logo trays use translucent warm ivory instead of pure white; dark trays preserve official white marks without recoloring them.

Where the source material supplies a quote whose author exactly matches a portfolio founder, the company dossier carries a warm-ivory founder voice slip pinned to the edge facing the center rail. Its compact gold pin sits close to the right edge with a deliberately short needle. The full-color portrait, verbatim quote, and supplied role remain a secondary annotation to the investment record. Quotes are never inferred or attached to unmatched companies.

Portfolio and Team section headings are intentionally unnumbered. Numeric
language is reserved for functional state only: the 1–10 investment clock,
individual dossier indices, and the five-chapter progress instrument.

A background integer counter advances from 1 through 10 with one vertically rolling clock transition whenever the viewport focus crosses from one company dossier to the next. The active dossier gains contrast, completes a single archival scan, and extends its rail to the chapter axis; an attached founder voice cuts in through a short clip-and-blur reveal before its pin drops into place. Passed records recede. The Creekstone particle mark follows the same deterministic progress-derived orbit with eased position targets. Time-based jitter, continuously interpolated decimal counting, and competing downstream scene writes are excluded.

The Team chapter is one viewport high. Three full-color investor credentials fan from the lower center at 172×246px on mobile and 210×292px at 768px and above. Clicking preserves the launch, impact particles, chapter shake, and precise slot alignment: the selected credential lands at left while the investor biography cuts in at right. Mobile restacks the credential above the full-width biography and keeps the return action visible. The former project forensic overlay, stacked folders, data, and runtime functions remain in the codebase as a dormant backup with deep-detail activation disabled.

The three credentials carry no member numbers or visible ordering. Initials, name, role, and Creekstone affiliation are the only identity metadata so every investor is presented on equal footing.

Team deployment freezes Lenis at the current physical scroll position before launch. Impact shake is isolated to the transform-free deployment slot and never mutates the ScrollTrigger-pinned section or centered board. Each card lands directly on a neutral-geometry slot coordinate without a second-frame correction.

The closing chapter is one warm-ivory viewport. On desktop, the left side is a
reactive perspective field and the right side is a hard-edged founder contact
panel. Eleven real Creekstone links orbit one inverse core as six inner nodes
and five approximately equidistant outer nodes. Seven dashed open-seat nodes
complete the 12-position outer lattice; only source and category remain inside
the hard-edged squares while a
masked preview dock carries the active full title. On fine pointers, the field
fully preserves the reference interaction: the lattice travels at 1.5×
inverse pointer displacement while a 580px cosine lens scales, fades, and
pulls nodes toward its focus. A smoothstep alpha falloff begins at 56% of the
lens radius, so peripheral nodes dissolve progressively instead of
disappearing at one threshold.
The core uses a 188px desktop tile, the six inner sources average 160px, and
the outer lattice averages 132px before lens scaling; mobile resolves to
72px, 60px, and 50px. Deterministic size variance, small coordinate offsets,
sub-degree rotation, and independent 1.2–4.1px float amplitudes prevent
mechanical symmetry without turning the field restless.
The chapter veil is held to 42% warm ivory while the underlying Creekstone
mark shifts to saturated golden yellow `#e8b82f`, a 1.05× silhouette, and a broader soft aura.
The Hero uses the same bright-gold particle state at slightly reduced core
opacity, allowing the mark to read as atmospheric rather than brown or heavy.
Agent, Portfolio, and Team retain the original high-contrast dark-background
particle tone, opacity, and tighter aura without inheriting this light-field treatment.
Contact opens a prefilled email inquiry and exposes the source podcast,
Xiaohongshu, and WeChat channels. A 66px footer is integrated into the chapter
rather than appended as a generic site strip. Mobile becomes a strict
perspective field, preview, contact, and 58px footer sequence, with a maximum
72px core, the complete source set visible, and content-height contact
geometry. At standard phone heights the perspective stage receives 42svh and
the contact panel begins at 56%, giving the two source rings room to separate;
screens below 761px tall retain the earlier compact geometry.

**The Reference Geometry Rule.** Preserve horizontal viewport clipping during portfolio progression, the physical credential fan, and the dark-to-ivory overlap between the Team and Perspectives / Contact transition. These are accepted traits of the binding reference, not generic responsive defects to normalize.

**The Charged Release Rule.** A held full-screen chapter cannot release before its single bottom charge line reaches 100%. Keep the 3px line full through the transition, then reset it only when the next full screen owns the viewport. Chapter state comes from the ordered ScrollTrigger ranges; viewport geometry is not a progress authority.

**The Verified Voice Rule.** Pin a voice slip only when its named author exactly matches the dossier founder. Preserve the source quote and full-color portrait, keep it visually subordinate to the company record, and do not manufacture coverage for companies without a verified voice.

## Elevation & Depth

The system is flat at the chapter level and sharply layered at interaction points. It uses borders, fixed-position particle fields, tonal inversion, blur glass, hard offset shadows, and small glow emissions rather than soft card elevation. Team credentials read as printed identity artifacts; the preserved forensic panels remain dormant glass dossiers.

### Shadow Vocabulary

- **Hero Halo** (`filter: drop-shadow(0 0 20px rgba(255,255,255,1))`): Keeps the central identity legible through the particle mark.
- **Credential Lift** (`7px 9px 30px rgba(0,0,0,0.44)`): Default team-card elevation.
- **Credential Hover** (`0 24px 48px rgba(0,0,0,0.56)`): Active hover lift with a thin Creekstone-gold edge.
- **Glass Panel Offset** (`6px 6px 0 rgba(255,255,255,0.28)`): Forensic panels; reduced to 4px on mobile.
- **Dossier Ghost Offset** (`10px 10px 0 rgba(255,255,255,0.85)`): The project card carried into forensic mode.
- **Signal Glow** (`0 0 10px #4ade80` or `0 0 10px rgba(255,204,0,0.4)`): Verification and milestone state.

### Named Rules

**The Hard Evidence Rule.** Resting artifacts use crisp borders and hard offset shadows; diffuse glow appears only during hover, verification, scanning, or active machine state.

## Shapes

The form language is square: team credentials, perspective sources, command buttons, deployment slots, contact controls, forensic panels, and dossier frames use zero-radius geometry. Small hero skills use pill capsules, while only the cursor retains a true circle. Dormant accomplishment folders retain a clipped trapezoidal tab and only a 2px micro-radius inside their scrollable narrative well.

Borders are structural and visible: 1–4px strokes, dashed rails and slots, thin grid lines, and sharp separators. Cropping is active composition—especially on the horizontal timeline and mobile project deployment—not accidental overflow to be “cleaned up.”

**The Shape Semantics Rule.** Squares hold evidence, sources, and controls; the cursor circle represents live attention; pills are reserved for compact skills.

## Components

### Creekstone Particle Mark

- **Source:** `public/creekstone-mark.png` is sampled as a live pixel mask, so replacing the asset updates the particle silhouette without changing shader code.
- **Volume:** Gold pixels become three shallow radial depth layers with restrained pointer-responsive X/Y rotation.
- **Flow:** Energy travels around the three rings through moving brightness and particle-size waves. Positional drift stays below a pixel, so the supplied logo silhouette remains intact.
- **Contrast:** White chapters use deep Creekstone gold (`#9a690e`); black chapters transition to the source gold (`#e5bd52`) and brighter traveling highlights.
- **Entrance:** The mark assembles from an outward particle field with an exponential settle, followed by one short radial pulse.
- **Feedback:** Timeline milestones, project deployment, and forensic detail activation trigger bounded depth pulses rather than the former blink gesture.
- **Performance:** 14,000 particles render on desktop and 10,000 below 768px; drawing is skipped while the document is hidden.

### Agent Runtime Chamber

- **Role:** The dark second screen bridges the warm-ivory hero to the black computational dossier world.
- **Composition:** The gold Creekstone WebGL particle mark stays central while Yihao’s color identity dossier and the hard-edge live console remain cleanly separated.
- **Cut-in:** A shutter, scan, and dossier sequence introduces the chamber before the live console resolves.
- **Mobile:** Keep the portrait at 36vw, begin the console at 64%, and preserve the portrait’s full color; do not apply grayscale.

### Command Buttons

- **Shape:** Square with a 2px white stroke.
- **Primary:** Black field, white tracked uppercase label, 10px × 14px or 12px × 24px internal padding.
- **Hover / Focus:** Invert to white field and black label, with a compact white glow; keep the state change at 0.25–0.3s.
- **Disabled:** The CHECK control drops to 35% opacity and becomes non-interactive.

### Chips

- **Hero skills:** Transparent pill with a thin 20%-black border and 4px × 12px padding.
- **Forensic stack:** Square black token with a thin 40%-white border, 8px × 4px padding, uppercase 10px label, and 0.14em tracking.
- **State:** Yellow dossier labels and green verification lights are the only colored chip states.

### Team Credentials

- **Corner Style:** Square.
- **Background:** Full-color portrait over a black identity strip with Creekstone-gold metadata and a 1px gold edge.
- **Shadow Strategy:** Low black print lift at rest; deeper black elevation plus a gold edge on hover.
- **Size:** 172×246px mobile / 210×292px at 768px and above.
- **Behavior:** Three credentials fan along a shallow parabolic arc, lift on hover, launch in a two-stage perspective motion, strike the deployment slot, and reveal the selected VC biography.

### Forensic Panels (Dormant Backup)

- **Corner Style:** Square with 2px translucent white outlines.
- **Background:** 56%-opaque black over a blurred, noisy glass backdrop.
- **Internal Padding:** 20px desktop / 14px mobile.
- **Behavior:** A scan beam traverses the overlay, pulse nodes breathe behind it, panels deblur into place, and the selected card persists as a tilted ghost artifact.

### Accomplishment Folders (Dormant Backup)

- **Style:** Frosted black dossier with a yellow clipped file tab, yellow left rule, and three status squares.
- **Stack:** Successive folders offset by 12px × 16px and scale to 95%, then 90%; deeper entries disappear.
- **Behavior:** The top folder follows pointer drag, rotates by horizontal displacement, flips after an 80px threshold, and snaps back with elastic easing otherwise.

### Navigation

- **Style:** Navigation is environmental rather than menu-based: the hero scroll cue, section-to-section scrolling, and the integrated closing footer are the route through the single long-form experience.
- **Pointer treatment:** Desktop hides the native cursor and uses a 6px difference-blend dot plus a 40px ring that expands to 50px over interactive targets.

### Perspective Nodes

- **Shape:** Hard-edged squares step from a 188px core to approximately 160px inner sources and 132px outer sources on desktop, then 72px / 60px / 50px on mobile. Each ring carries restrained deterministic size variance; the center core is a black-and-gold leadership tile with an inset gold frame.
- **Color:** Portfolio updates use muted ochre, intelligence uses slate blue, essays and letters use distinct clay tones, and podcasts use olive. Surfaces remain translucent and desaturated at rest; hover resolves to black while the category color becomes the border, glow, and eight-square particle burst.
- **Content:** Source and category only. The complete article or podcast title belongs in the adjacent preview dock.
- **Action:** Every non-core node is a real source link. Hover and keyboard focus update the preview, invert the node to black, emit one bounded square-particle burst, and preserve a visible focus ring.
- **Behavior:** Six inner sources and a complete 12-position outer lattice preserve the original 1.5× inverse pointer travel, 580px cosine scale lens, nonlinear center pull, and 0.08 frame interpolation. Each tile has a different deterministic phase, 1.2–4.1px amplitude, and subtle rotation so the composition breathes asymmetrically. A smoothstep alpha gradient begins at 56% of the lens radius and continues to transparency at its edge. Five real outer sources use 2–3–2–3–2 spacing; seven dashed open seats carry “Next Collaborator,” “Awaiting a New Voice,” and “Room to Build” language in warm neutral ink at 68% of the surrounding node opacity. Real nodes retain the original 110% category-color hover response; placeholders never compete for hover. Touch keeps the whole lattice visible with reduced float amplitude and a gentler distance-based alpha gradient; reduced-motion mode removes float and keeps the field static.

### Founder Contact and Footer

- **Contact:** A hard-edged dark panel carries the exact Creekstone founder invitation, a short inquiry field, and a mailto handoff to `claw@creekstonevc.com`.
- **Channels:** Podcast, Xiaohongshu, and WeChat remain factual source channels, not decorative social badges.
- **Footer:** Creekstone identity, Origin / Portfolio / Team / Contact navigation, “Back to origin,” and the Agent Native / Founder Friendly / China to Global line share one structural closing band.

## Do's and Don'ts

### Do:

- **Do** preserve the public reference as the binding visual and behavioral authority.
- **Do** keep the black/white chapter inversions, Creekstone particle mark, pinned portfolio reel, team credential ritual, and reactive perspective field together as one continuous experience.
- **Do** preserve horizontal viewport clipping during portfolio progression, the three-card credential fan, and the dark-to-ivory overlap between Team and Perspectives / Contact.
- **Do** give Hero, Agent, Team, and terminal Perspectives / Contact a 0.72-viewport hold runway while retaining Timeline’s horizontal pin.
- **Do** keep all perspective titles and links sourced from the Creekstone site and keep the founder contact action functional.
- **Do** keep all investor portraits in full color and present the selected biography beside or below its deployed credential.
- **Do** retain the former forensic overlay and folder interaction as disabled backup code rather than deleting it.
- **Do** hold each chapter until the single 3px full-width bottom charge line reaches 100%, keep it full through transition, and reset only when the next full screen takes over.
- **Do** keep Yihao’s mobile portrait in color at 36vw and begin the console at 64%.
- **Do** use yellow, red, and green only for their observed state and milestone roles.
- **Do** keep sharp borders, hard pixel offsets, scanlines, grids, and noise at their restrained observed opacity.

### Don't:

- **Don't** reinterpret the portfolio into a conventional résumé grid, marketing landing page, or dashboard.
- **Don't** round team credentials, command buttons, deployment slots, forensic panels, or dossier frames.
- **Don't** reintroduce Inter or another neutral UI face; preserve the Space Grotesk weight/scale hierarchy, uppercase telemetry voice, and tracked labels.
- **Don't** “fix” accepted clipping, cropping, or transition overlap when matching this reference.
- **Don't** release a held full-screen chapter before its bottom charge line is complete, reset the line during the inter-chapter transition, or grayscale Yihao’s dossier portrait.
- **Don't** turn Perspectives into a generic article-card grid or Contact into a non-functional terminal simulation.
- **Don't** add decorative color, gradients, soft ambient card shadows, or unrelated illustration.

**Reviewer verdict: SHIP.**
