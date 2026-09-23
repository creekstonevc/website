import { useCallback, useEffect, useRef, type RefObject } from "react";
import { flushSync } from "react-dom";

// Snapshot the layout once, then move composited surfaces instead of reflowing
// the transcript on every frame. The underlying conversation never remounts.
export function usePresenceTransition(root: RefObject<HTMLElement | null>, change: (video: boolean) => void) {
  const active = useRef<ViewTransition | null>(null);
  const generation = useRef(0);
  const fallback = useRef<Animation[]>([]);
  useEffect(() => () => {
    generation.current++; active.current?.skipTransition();
    fallback.current.forEach(animation => animation.cancel());
  }, []);
  return useCallback((video: boolean) => {
    const current = ++generation.current;
    active.current?.skipTransition();
    fallback.current.forEach(animation => animation.cancel());
    fallback.current = [];
    const update = () => { if (current === generation.current) flushSync(() => change(video)); };
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { update(); return; }
    if (document.startViewTransition) {
      const transition = document.startViewTransition(update);
      active.current = transition;
      void transition.finished.catch(() => {}).finally(() => { if (active.current === transition) active.current = null; });
      return;
    }
    const console = root.current?.querySelector<HTMLElement>("[data-conversation-surface]");
    const before = console?.getBoundingClientRect();
    update();
    if (console && before) {
      const after = console.getBoundingClientRect();
      fallback.current.push(console.animate([
        { transform: `translate(${before.left - after.left}px, ${before.top - after.top}px)`, opacity: .35 },
        { transform: "translate(0,0)", opacity: 1 },
      ], { duration: video ? 720 : 480, easing: "cubic-bezier(.16,1,.3,1)" }));
    }
  }, [root, change]);
}
