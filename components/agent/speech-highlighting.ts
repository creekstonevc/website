import type { Element, Root, Text } from "hast";
import type { SpeechSegment, SpeechWord } from "./live-voice-client";

export const MIN_SPEECH_GROUP_CHARACTERS = 24;
export type SpeechGroup = { start: number; end: number };
export const normalizeSpeechText = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

// A short final tail is allowed. Completed groups never move as the LLM appends
// more text, so an in-progress answer cannot reshuffle its spoken highlight.
export function splitSpeechGroups(text: string, minimum = MIN_SPEECH_GROUP_CHARACTERS): SpeechGroup[] {
  const groups: SpeechGroup[] = [];
  let start = 0, count = 0;
  for (let offset = 0; offset < text.length;) {
    const char = String.fromCodePoint(text.codePointAt(offset)!);
    count += normalizeSpeechText(char).length;
    offset += char.length;
    const boundary = /[。！？!?；;\n]/u.test(char) || char === "." && (offset === text.length || /\s/.test(text[offset]));
    if (boundary && count >= minimum) { groups.push({ start, end: offset }); start = offset; count = 0; }
  }
  if (start < text.length) groups.push({ start, end: text.length });
  return groups;
}

// Wrap only spoken text leaves, preserving GFM lists, emphasis and block layout.
// The gateway does not speak links or code, so those remain completely untouched.
export function speechHighlightPlugin() {
  return (tree: Root) => {
    let text = "";
    const leaves: { node: Text; parent: Root | Element; start: number }[] = [];
    const walk = (parent: Root | Element) => {
      for (const node of parent.children) {
        if (node.type === "text") { leaves.push({ node, parent, start: text.length }); text += node.value; }
        else if (node.type === "element" && !["a", "code", "pre", "script", "style"].includes(node.tagName)) {
          walk(node);
          if (["p", "li", "blockquote", "h1", "h2", "h3", "h4", "br", "tr"].includes(node.tagName)) text += "\n";
        }
      }
    };
    walk(tree);
    const groups = splitSpeechGroups(text);
    for (const leaf of leaves) {
      const replacements: Element[] = [];
      for (let id = 0; id < groups.length; id++) {
        const start = Math.max(leaf.start, groups[id].start), end = Math.min(leaf.start + leaf.node.value.length, groups[id].end);
        if (end <= start) continue;
        replacements.push({ type: "element", tagName: "span", properties: { "data-speech-group": id },
          children: [{ type: "text", value: text.slice(start, end) }] });
      }
      const index = leaf.parent.children.indexOf(leaf.node);
      if (index >= 0) leaf.parent.children.splice(index, 1, ...replacements);
    }
  };
}

export type SpeechCue = { group: number; startSample: number; endSample: number };
export type SpeechSegmentCue = { groups: number[]; startSample: number; endSample: number | null };
export function alignSpeechSegments(groups: { id: number; text: string }[], segments: SpeechSegment[]): SpeechSegmentCue[] {
  let rendered = "";
  const renderedOwners: number[] = [];
  for (const group of groups) {
    const text = group.text.normalize("NFKC").toLowerCase();
    rendered += text; renderedOwners.push(...Array<number>(text.length).fill(group.id));
  }
  // Markdown can render "**3. Heading**" as literal text, while TTS removes
  // that line-start enumeration. Keep BOTH indexes: live/replayed speech may
  // include or omit it. Strip only structural markers, never ordinary numbers,
  // and map the alternate index back to the same original cursor/group IDs.
  const markers = new Set<number>();
  for (const match of rendered.matchAll(/(?:^|\n)[ \t]*\d+[.)](?=[ \t\n]|$)/g)) {
    for (let i = match.index; i < match.index + match[0].length; i++) markers.add(i);
  }
  let plain = "", unnumbered = "";
  const owners: number[] = [], originalPositions: number[] = [];
  for (let offset = 0; offset < rendered.length;) {
    const char = String.fromCodePoint(rendered.codePointAt(offset)!);
    if (/[\p{L}\p{N}]/u.test(char)) {
      if (!markers.has(offset)) {
        unnumbered += char;
        for (let i = 0; i < char.length; i++) originalPositions.push(plain.length + i);
      }
      plain += char; owners.push(...Array<number>(char.length).fill(renderedOwners[offset]));
    }
    offset += char.length;
  }
  const cues: SpeechSegmentCue[] = [];
  let cursor = 0;
  for (const segment of segments) {
    const normalized = normalizeSpeechText(segment.text);
    if (!normalized) continue;
    // Match the complete submitted sentence group, not isolated common words
    // from late ASR-like subtitles. A missing/changed token cannot jump us to
    // an unrelated final sentence. Markdown gaps may be skipped as a whole.
    let index = plain.indexOf(normalized, cursor), end = index + normalized.length;
    const unnumberedCursor = originalPositions.findIndex(position => position >= cursor);
    const alternate = unnumberedCursor < 0 ? -1 : unnumbered.indexOf(normalized, unnumberedCursor);
    if (alternate >= 0 && (index < 0 || originalPositions[alternate] < index)) {
      index = originalPositions[alternate];
      end = originalPositions[alternate + normalized.length - 1] + 1;
    }
    if (index < 0) continue;
    cursor = end;
    cues.push({ groups: [...new Set(owners.slice(index, cursor))], startSample: segment.startSample, endSample: segment.endSample });
  }
  return cues;
}

export function speechSegmentAt(cues: SpeechSegmentCue[], sample: number): number[] {
  for (let i = cues.length - 1; i >= 0; i--) {
    const cue = cues[i];
    if (sample >= cue.startSample) return cue.endSample === null || sample < cue.endSample ? cue.groups : [];
  }
  return [];
}

export function alignSpeechGroups(groups: { id: number; text: string }[], words: SpeechWord[]): SpeechCue[] {
  let plain = "";
  const owners: number[] = [];
  for (const group of groups) {
    const normalized = normalizeSpeechText(group.text);
    plain += normalized; owners.push(...Array<number>(normalized.length).fill(group.id));
  }
  const cues: SpeechCue[] = [];
  let cursor = 0;
  for (const word of words) {
    const normalized = normalizeSpeechText(word.text);
    if (!normalized) continue;
    const index = plain.indexOf(normalized, cursor);
    // Missing/unmatched words are not assigned guessed timings. Search forward
    // only, to distinguish repeated sentences and ignore Markdown stripped by TTS.
    if (index < 0) continue;
    const group = owners[index];
    cursor = index + normalized.length;
    const last = cues.at(-1);
    if (last?.group === group) last.endSample = Math.max(last.endSample, word.endSample);
    else cues.push({ group, startSample: word.startSample, endSample: word.endSample });
  }
  return cues;
}

export function speechGroupAt(cues: SpeechCue[], sample: number): number | null {
  for (let i = cues.length - 1; i >= 0; i--) {
    if (sample >= cues[i].startSample) {
      // Keep natural inter-sentence pauses highlighted, but never replay old
      // cues when subtitle metadata arrives after its audio has already played.
      const end = cues[i + 1]?.startSample ?? cues[i].endSample + 2400;
      return sample < end ? cues[i].group : null;
    }
  }
  return null;
}
