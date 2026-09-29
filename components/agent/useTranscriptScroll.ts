"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createTranscriptScroller } from "./transcript-scroll";

export function useTranscriptScroll() {
  const transcriptRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const controller = useRef<ReturnType<typeof createTranscriptScroller> | null>(null);
  const [showReturnControl, setShowReturnControl] = useState(false);

  const follow = useCallback(() => controller.current?.follow(), []);
  const pause = useCallback(() => controller.current?.pause(), []);
  const setSpeech = useCallback((active: boolean) => controller.current?.setSpeech(active), []);
  const setSpeechTarget = useCallback((elements: HTMLElement[]) => controller.current?.setSpeechTarget(elements), []);

  useEffect(() => {
    const node = transcriptRef.current;
    const content = contentRef.current;
    if (!node || !content) return;
    const scroll = createTranscriptScroller(node, setShowReturnControl);
    controller.current = scroll;
    const observer = new ResizeObserver(scroll.resize);
    observer.observe(node);
    observer.observe(content);
    return () => {
      observer.disconnect();
      scroll.destroy(); controller.current = null;
    };
  }, []);

  return { transcriptRef, contentRef, showReturnControl, follow, pause, setSpeech, setSpeechTarget };
}
