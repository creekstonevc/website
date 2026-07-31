# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Next.js with Tailwind CSS, Three.js, GSAP/ScrollTrigger, and Lenis.

## Users

Founders, co-investors, and operators evaluating Creekstone Ventures, its investment approach, portfolio, team, perspectives, and founder network.

## Product Purpose

An independently runnable, agent-native Creekstone Ventures website grounded in the firm’s supplied factual content.

## Positioning

The page presents Creekstone through a live computational environment: its particle mark, AI VC Agent, portfolio evidence, investor profiles, perspectives, contact pathways, and an interactive ecosystem graph.

## Operating Context

The experience is consumed as a single long-form portfolio on desktop and mobile. Scrolling, pointer movement, project-card selection, dossier expansion, and return-to-top behavior are core to the experience.

## Capabilities and Constraints

- The implementation must live outside `website-v2` and `demo`.
- Public copy must remain grounded in Creekstone’s supplied source material.
- Visual hierarchy, motion, and interactions must express Creekstone’s own black-and-gold identity.
- The project must run locally as its own Next.js application.
- No private APIs or unpublished source material are assumed.

## Brand Commitments

- Brand: Creekstone Ventures.
- Positioning: Agent Native · Founder Friendly.
- Content authority: Creekstone’s supplied website project.
- External references may inform motion mechanics, but must not leak their section labels, numbering, names, or product copy into the Creekstone experience.

## Evidence on Hand

- Creekstone’s supplied website content and brand assets.
- A frozen public motion-study fixture retained outside the served application.
- Runtime dependencies for Tailwind CSS, GSAP, Three.js, Lenis, and the self-hosted Space Grotesk family.

## Product Principles

- Creekstone content and brand are the source of truth.
- Preserve the complete scroll narrative, not only the first viewport.
- Treat motion and interaction as required content.
- Keep the clone self-contained from the repository’s other website implementations.
