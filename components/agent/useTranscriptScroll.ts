"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createTranscriptScroller } from "./transcript-scroll";

export function useTranscriptScroll() {
  const transcriptRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const controller = useRef<ReturnType<typeof createTranscriptScroller> | null>(null);
  const [detached, setDetached] = useState(false);

  const follow = useCallback(() => controller.current?.follow(), []);
  const pause = useCallback(() => controller.current?.pause(), []);

  useEffect(() => {
    const node = transcriptRef.current;
    const content = contentRef.current;
    if (!node || !content) return;
    const scroll = createTranscriptScroller(node, setDetached);
    controller.current = scroll;
    const observer = new ResizeObserver(scroll.resize);
    observer.observe(node);
    observer.observe(content);
    return () => {
      observer.disconnect();
      scroll.destroy(); controller.current = null;
    };
  }, []);

  return { transcriptRef, contentRef, detached, follow, pause };
}
