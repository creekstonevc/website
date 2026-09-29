"use client";

import { memo, useEffect, useMemo, useRef } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { alignSpeechGroups, alignSpeechSegments, speechGroupAt, speechSegmentAt, speechHighlightPlugin } from "./speech-highlighting";
import type { SpeechPlaybackStore, SpeechSegment, SpeechWord } from "./live-voice-client";

export const SpeechMarkdown = memo(function SpeechMarkdown({ text, messageIndex, playback, onTarget }: {
  text: string; messageIndex: number; playback: SpeechPlaybackStore;
  onTarget: (elements: HTMLElement[]) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const markdown = useMemo(() => <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[speechHighlightPlugin]}>{text}</Markdown>, [text]);
  useEffect(() => {
    const elements = Array.from(root.current?.querySelectorAll<HTMLElement>("[data-speech-group]") ?? []);
    const byGroup = new Map<number, HTMLElement[]>();
    for (const element of elements) {
      const id = Number(element.dataset.speechGroup);
      byGroup.set(id, [...(byGroup.get(id) ?? []), element]);
    }
    const groups = Array.from(byGroup, ([id, spans]) => ({ id, text: spans.map(span => span.textContent ?? "").join("") }));
    let words: SpeechWord[] | null = null, cues: ReturnType<typeof alignSpeechGroups> = [];
    let segments: SpeechSegment[] | null = null, segmentCues: ReturnType<typeof alignSpeechSegments> = [];
    let highlighted: HTMLElement[] = [], current = "";
    const update = () => {
      const state = playback.getSnapshot();
      const active = state.active && state.messageIndex === messageIndex;
      if (active && words !== state.words) { words = state.words; cues = alignSpeechGroups(groups, words); }
      if (active && segments !== state.segments) { segments = state.segments; segmentCues = alignSpeechSegments(groups, segments); }
      const legacy = active && !state.segments.length ? speechGroupAt(cues, state.sample) : null;
      const next = !active ? [] : state.segments.length ? speechSegmentAt(segmentCues, state.sample) : legacy === null ? [] : [legacy];
      const key = next.join(",");
      if (key === current) return;
      highlighted.forEach(span => { delete span.dataset.speaking; });
      current = key; highlighted = next.flatMap(id => byGroup.get(id) ?? []);
      highlighted.forEach(span => { span.dataset.speaking = "true"; });
      if (active) onTarget(highlighted);
    };
    update();
    const unsubscribe = playback.subscribe(update);
    return () => { unsubscribe(); highlighted.forEach(span => { delete span.dataset.speaking; }); };
  }, [text, messageIndex, playback, onTarget]);
  return <div ref={root} data-speech-markdown>{markdown}</div>;
});
