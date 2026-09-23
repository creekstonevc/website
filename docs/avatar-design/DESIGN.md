---
name: Creekstone Agent Presence Extension
description: The existing founder conversation expands from an identity dossier into an honest video presence.
colors:
  agent-gold: "#e5bd52"
  agent-gold-light: "#f4d87d"
  agent-paper: "#f3efe5"
  agent-ink: "#050505"
typography:
  control:
    fontFamily: "Space Grotesk, sans-serif"
    fontSize: "12px"
rounded:
  square: "0"
spacing:
  compact: "12px"
  panel: "16px"
  inset: "24px"
components:
  view-button-selected:
    backgroundColor: "transparent"
    textColor: "{colors.agent-gold-light}"
    rounded: "{rounded.square}"
    width: "94px"
  recovery-button:
    backgroundColor: "#19160e"
    textColor: "{colors.agent-gold-light}"
    typography: "{typography.control}"
    rounded: "{rounded.square}"
    padding: "4px 10px"
---

# Design System: Creekstone Agent Presence Extension

## Overview

**Creative North Star: "The Continuous Presence"**

Creekstone’s black-and-gold identity dossier expands into a video stage without replacing the founder conversation. The full-color Yihao portrait, Space Grotesk typography, and precise rectangular controls extend the incumbent founder channel; they do not establish a replacement brand or a new global system.

This document is scoped to the Text/Video extension in `components/agent/AgentChat.tsx`, `components/agent/AgentChat.module.css`, and `components/agent/useAvatarVideo.ts`. The connection-state copy is corroborated by `components/agent/video-client.ts`. Root `DESIGN.md` and `PRODUCT.md` remain incumbent context, not write targets. This is a source-derived record, not a claim that credentialed live playback was visually verified.

**Key Characteristics:**

- One conversation and draft, expressed through two views.
- A real full-color portrait beneath a truthfully labeled video state.
- A dominant desktop stage beside the working transcript; a compact stage above it on phones.
- Bounded expansion, clip reveal, and one scan per entry, with reduced-motion alternatives.

## Colors

Creekstone gold articulates selection and identity against warm near-black surfaces, with warm paper for the main text.

### Primary

- **Agent Gold:** The `.AI` identity suffix, selected-view underline, and composer mode accent.
- **Agent Gold Light:** Selected view labels, recovery controls, focus feedback, and the transient scan.

### Neutral

- **Agent Ink:** The route’s instrument field and the basis of portrait scrims.
- **Agent Paper:** Inherited main text, including the stage identity.

The stage uses local, low-contrast brown-black fills and warm muted secondary text. These isolated surface values are component details, not an additional brand palette. The small green live indicator is reserved for the connected state.

**The Honest Signal Rule.** Only the connected state receives “Live avatar” and the green signal; an unavailable stream remains explicitly “Preview,” with “Static preview · waiting for video credentials” when capabilities are disabled.

## Typography

**Display Font:** Space Grotesk (with sans-serif fallback)  
**Body Font:** Space Grotesk (with sans-serif fallback)

One family carries the extension. The stage identity uses medium weight, a lighter gold `.AI` suffix, and tightly controlled negative tracking. Functional controls remain sentence-case Text, Video, Play video, and Reconnect, paired with inline SVG where an icon is needed.

The stage heading sits outside the media frame: `clamp(32px, 3.5vw, 56px)`, weight 500, line-height 1, tracking `-.04em`; the suffix uses weight 300. It becomes 24px on phones, and is hidden on short phone viewports. The supporting stage sentence is 12px. Recovery controls and desktop connection status use the control-size role; the desktop view switch is 13px and becomes 12px on phones.

**The One Family Rule.** Preserve the incumbent Space Grotesk family; distinguish identity from controls through scale and weight rather than introducing a second face.

## Layout

The viewport remains one grid and the conversation remains one mounted console. Text view keeps the incumbent left dossier and larger right transcript. Desktop Video view uses a `clamp(360px, 32vw, 510px)` chat track, leaving the rest for a centered landscape media frame. The frame is 16:9, changing to 4:3 at widths between 701px and 900px; its width is bounded by available height. Name and connection status sit outside the frame. Actual media and the color portrait use contain; never stretch or crop an incoming video.

At 700px and below, Video view stacks a 62px header, a stage sized to the 16:9 frame plus 72px of name/status spacing, a flexible transcript/composer, and footer. At heights of 600px or less, the header and stage reduce to 54px and 116px; a small 16:9 frame and status share a row. Footer and secondary metadata disappear to preserve the input area.

The extension reuses compact, panel, and inset spacing. On desktop the stage is inset by the panel step; the transcript gets its own internal scroll area rather than making the entire page scroll. Video-mode messages stack metadata above their content to suit the narrower column. Suggestions and secondary helper copy are removed from the phone video composition, not the working input.

## Elevation & Depth

The new surface is defined by clipping, a layered portrait/video pair, thin gold registration borders, and dark photographic scrims. Scrims protect identity and connection copy; they are not a new decorative gradient language. The selected view has an inset gold underline. A diffuse glow is limited to the transient scan and connected-state signal, not raised cards or hard offset shadows.

## Shapes

The mode selector, recovery buttons, state badge, and stage keep the incumbent square geometry. Icons in the new view controls are inline stroke SVG, not Unicode arrows. Thin borders, a square signal dot, and clipped registration corners maintain the dossier character without introducing a second container style.

## Components

### Conversation View Switch

Two persistent native buttons inside an accessible “Conversation view” group expose selection through `aria-pressed`. Each desktop button is 94px wide and at least 40px high; phone width is 66px. A dark-gold indicator travels beneath the selected control, with a gold inset underline. Native keyboard focus remains visible. Selection changes presentation only: the same message list, session, attachments, and draft remain in place.

### Video Stage

The stage overlays the existing identity panel. Its static fallback is `/yihao-agent.jpg`, retained in full color; connected media uses `object-fit: contain`. The inactive stage is both hidden from accessibility and inert. The portrait remains visible beneath non-connected media states, and status text is announced only while Video view is active.

The browser's View Transition API carries the portrait frame into the landscape frame and moves the same conversation surface: 780ms entry, 480ms return, `cubic-bezier(.16, 1, .3, 1)`. The DOM changes layout once, avoiding continuous transcript reflow. Two dark aperture halves reveal the video over 760ms with one central gold registration line. The view indicator travels over 500ms. Without View Transitions, a cancellable Web Animations translation provides continuity. Rapid toggles skip the previous transition; reduced motion performs the layout change immediately without shutters or animation. These document pseudo-element rules are route-scoped in `presence-transitions.css`.

### Connection Status and Recovery

The badge reads Preview until connected. Disabled capabilities explicitly display the static-preview message; connecting, blocked playback, and failures retain actionable connection copy. Blocked playback offers Play video and Reconnect; errors offer Reconnect. These buttons are thin-bordered, square, gold-on-dark controls, with keyboard focus feedback. No camera or microphone is requested by this receive-only experience.

### Composer Mode Note

The existing textarea and transcript remain the working interface. The compact two-part note says “Text in / preview mode” and “Chat remains fully available” until connected, then “Text in / video out” and “Sound comes from the video.” The text-mode live-voice toolbar is hidden in Video view. Entering Video stops existing audio; selecting message audio returns to Text view. Leaving Video or the page cleans up the video connection.

## Do's and Don'ts

### Do:

- **Do** preserve the same conversation, attachments, and draft when switching views.
- **Do** keep Yihao’s supplied portrait in full color and distinguish static preview from live media.
- **Do** keep text input usable when video is unavailable and expose recovery beside connection status.
- **Do** respect reduced motion without changing the final state or removing information.

### Don't:

- **Don't** claim live video until the connection is ready and a video frame has arrived.
- **Don't** duplicate the transcript or create a separate conversation for Video view.
- **Don't** turn entry scans into persistent decoration or require camera/microphone access.
- **Don't** propagate inherited decorative eyebrows, glyph icons, extreme tracking, or tiny metadata as new system rules.

Not canonized: inherited decorative eyebrows and Unicode control glyphs outside the new controls, root-document hard-offset-shadow doctrine, and unusually small mobile metadata are existing implementation concerns, not reusable rules of this extension.
