"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export function useTranscriptScroll() {
  const transcriptRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const frame = useRef<number | null>(null);
  const previousTop = useRef(0);
  const [detached, setDetached] = useState(false);

  const pause = useCallback(() => {
    following.current = false;
    setDetached(true);
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  }, []);

  const animate = useCallback(() => {
    if (!following.current || frame.current !== null) return;
    let lastTime = performance.now();
    const tick = (time: number) => {
      frame.current = null;
      const node = transcriptRef.current;
      if (!node || !following.current) return;
      const target = Math.max(0, node.scrollHeight - node.clientHeight);
      const distance = target - node.scrollTop;
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const step = 1 - Math.exp(-Math.min(time - lastTime, 64) / 70);
      // Snap the final sub-pixel distance so browser rounding cannot keep the
      // animation frame alive forever on fractional device-pixel ratios.
      node.scrollTop = reduced || Math.abs(distance) <= 2 ? target : node.scrollTop + distance * step;
      previousTop.current = node.scrollTop;
      lastTime = time;
      if (!reduced && Math.abs(target - node.scrollTop) > 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }, []);

  const follow = useCallback(() => {
    following.current = true;
    setDetached(false);
    animate();
  }, [animate]);

  useEffect(() => {
    const node = transcriptRef.current;
    const content = contentRef.current;
    if (!node || !content) return;
    const onScroll = () => {
      const down = node.scrollTop > previousTop.current;
      if (frame.current === null && node.scrollTop < previousTop.current - 1) pause();
      previousTop.current = node.scrollTop;
      if (!following.current && down && node.scrollHeight - node.clientHeight - node.scrollTop < 12) follow();
    };
    const onWheel = (event: WheelEvent) => { if (event.deltaY) pause(); };
    const onKey = (event: KeyboardEvent) => {
      if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) pause();
    };
    const observer = new ResizeObserver(animate);
    observer.observe(node);
    observer.observe(content);
    node.addEventListener("scroll", onScroll, { passive: true });
    node.addEventListener("wheel", onWheel, { passive: true });
    node.addEventListener("pointerdown", pause, { passive: true });
    node.addEventListener("touchstart", pause, { passive: true });
    node.addEventListener("keydown", onKey);
    return () => {
      observer.disconnect();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
      node.removeEventListener("scroll", onScroll);
      node.removeEventListener("wheel", onWheel);
      node.removeEventListener("pointerdown", pause);
      node.removeEventListener("touchstart", pause);
      node.removeEventListener("keydown", onKey);
    };
  }, [animate, follow, pause]);

  return { transcriptRef, contentRef, detached, follow, pause };
}
