import { useEffect, useRef, type RefObject } from "react";
import { flushSync } from "react-dom";

// Snapshot the layout once, then move composited surfaces instead of reflowing
// the transcript on every frame. The underlying conversation never remounts.
export function usePresenceTransition(root: RefObject<HTMLElement | null>, change: (enabled: boolean, kind: "video" | "input") => void) {
  const active = useRef<ViewTransition | null>(null);
  const generation = useRef(0);
  const fallback = useRef<Animation[]>([]);
  useEffect(() => () => {
    generation.current++; active.current?.skipTransition();
    fallback.current.forEach(animation => animation.cancel());
  }, []);
  return (video: boolean, kind: "video" | "input" = "video") => {
    const current = ++generation.current;
    active.current?.skipTransition();
    fallback.current.forEach(animation => animation.cancel());
    fallback.current = [];
    root.current?.setAttribute("data-transition-kind", kind);
    const update = () => { if (current === generation.current) flushSync(() => change(video, kind)); };
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { update(); return; }
    if (document.startViewTransition) {
      const transition = document.startViewTransition(update);
      active.current = transition;
      void transition.finished.catch(() => {}).finally(() => { if (active.current === transition) active.current = null; });
      return;
    }
    const console = root.current?.querySelector<HTMLElement>("[data-conversation-surface]");
    const before = console?.getBoundingClientRect();
    const source = root.current?.querySelector<HTMLElement>(kind === "input" ? "[data-input-surface]" : video ? "[data-presence-portrait]" : "[data-presence-video]");
    const sourceBounds = source?.getBoundingClientRect();
    update();
    const destination = root.current?.querySelector<HTMLElement>(kind === "input" ? "[data-input-surface]" : video ? "[data-presence-video]" : "[data-presence-portrait]");
    if (destination && sourceBounds?.width && sourceBounds.height) {
      const end = destination.getBoundingClientRect();
      if (end.width && end.height) fallback.current.push(destination.animate([
        { transformOrigin: "0 0", transform: `translate(${sourceBounds.left - end.left}px, ${sourceBounds.top - end.top}px) scale(${sourceBounds.width / end.width}, ${sourceBounds.height / end.height})` },
        { transformOrigin: "0 0", transform: "translate(0,0) scale(1,1)" },
      ], { duration: kind === "input" ? 320 : video ? 780 : 480, easing: "cubic-bezier(.16,1,.3,1)" }));
    }
    if (console && before) {
      const after = console.getBoundingClientRect();
      fallback.current.push(console.animate([
        { transform: `translate(${before.left - after.left}px, ${before.top - after.top}px)`, opacity: .35 },
        { transform: "translate(0,0)", opacity: 1 },
      ], { duration: kind === "input" ? 320 : video ? 720 : 480, easing: "cubic-bezier(.16,1,.3,1)" }));
    }
  };
}
