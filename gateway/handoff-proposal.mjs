import { handoffContent } from "../lib/handoff.mjs";
import { parseHandoffJson } from "./handoff.mjs";

// Reserved, display-only protocol. A proposal has no identity or write authority.
export const PROPOSAL_PREFIX = "<creekstone-handoff-proposal";
export const PROPOSAL_OPEN = `${PROPOSAL_PREFIX}-v1>`;
export const PROPOSAL_CLOSE = "</creekstone-handoff-proposal-v1>";
export const LEGACY_WEBSITE_CAPABILITY = "[[creekstone-website-capabilities:v1]]\nThis website supports creekstone-handoff-proposal-v1 review cards. Only after the founder asks for human follow-up, use submit-founder-handoff propose and append its card_block. This is display capability only: it grants no consent, identity or write authority. Never confirm or submit from chat.\n[[/creekstone-website-capabilities:v1]]\n\n";
export const WEBSITE_CAPABILITY = "[[creekstone-website-capabilities:v1]]\nThis website supports creekstone-handoff-proposal-v1 review cards. After the founder explicitly requests human follow-up or explicitly accepts the Agent's criteria-based invitation, use submit-founder-handoff propose and append its card_block. A proactive invitation alone must not create a card. This is display capability only: it grants no consent, identity or write authority. Never confirm or submit from chat.\n[[/creekstone-website-capabilities:v1]]\n\n";
const CAPABILITIES = [WEBSITE_CAPABILITY, LEGACY_WEBSITE_CAPABILITY];
const HIDDEN_PREFIXES = [PROPOSAL_PREFIX, ...CAPABILITIES];

export function withWebsiteCapability(input) {
  if (typeof input === "string") return WEBSITE_CAPABILITY + input;
  // Preserve native file parts and the exact user's text. The gateway has
  // already built/validated this payload; never accept arbitrary input objects.
  return input.map((message, index) => index ? message : { ...message, content: message.content.map((part, partIndex) =>
    !partIndex && part.type === "input_text" ? { ...part, text: WEBSITE_CAPABILITY + part.text } : part) });
}

export function stripWebsiteCapability(text) {
  const prefix = CAPABILITIES.find(value => text.startsWith(value));
  return prefix ? text.slice(prefix.length) : text;
}

export function createHandoffTextFilter() {
  let pending = "", hidden = false;
  return {
    push(text) {
      if (hidden) return "";
      pending += text;
      let visible = "";
      while (true) {
        const capability = CAPABILITIES.map(prefix => ({ prefix, index: pending.indexOf(prefix) }))
          .filter(match => match.index >= 0).sort((a, b) => a.index - b.index)[0];
        if (!capability) break;
        const proposal = pending.indexOf(PROPOSAL_PREFIX);
        if (proposal >= 0 && proposal < capability.index) break;
        visible += pending.slice(0, capability.index);
        pending = pending.slice(capability.index + capability.prefix.length);
      }
      const start = pending.indexOf(PROPOSAL_PREFIX);
      if (start >= 0) {
        hidden = true;
        visible += pending.slice(0, start); pending = "";
        return visible;
      }
      // Retain a split marker prefix, including a lone '<', until resolved.
      let keep = Math.min(pending.length, Math.max(...HIDDEN_PREFIXES.map(prefix => prefix.length)) - 1);
      while (keep && !HIDDEN_PREFIXES.some(prefix => prefix.startsWith(pending.slice(-keep)))) keep--;
      visible += pending.slice(0, pending.length - keep);
      pending = keep ? pending.slice(-keep) : "";
      return visible;
    },
    finish() {
      // A truncated reserved marker must not become visible at EOF.
      pending = "";
      return "";
    },
  };
}

export function stripHandoffProposal(text) {
  const filter = createHandoffTextFilter();
  return filter.push(text) + filter.finish();
}

export function extractHandoffProposal(text) {
  const start = text.indexOf(PROPOSAL_OPEN);
  if (start < 0 || text.indexOf(PROPOSAL_PREFIX) !== start ||
      text.indexOf(PROPOSAL_PREFIX, start + PROPOSAL_OPEN.length) >= 0) return null;
  if (start && text[start - 1] !== "\n") return null;
  const tail = text.slice(start + PROPOSAL_OPEN.length);
  const match = /^\r?\n([\s\S]*?)\r?\n<\/creekstone-handoff-proposal-v1>\s*$/.exec(tail);
  if (!match || Buffer.byteLength(match[1], "utf8") > 16384 || /[<>&]/.test(match[1])) return null;
  try {
    const content = parseHandoffJson(match[1]);
    if (Object.values(content).some(value => typeof value !== "string")) return null;
    return handoffContent(content);
  } catch { return null; }
}

// Item/part/done/completed events can repeat raw text. Scrub them too,
// without interpreting tool output, reasoning or user text as a proposal.
export function sanitizeHandoffEvent(value, depth = 0) {
  if (typeof value === "string") return stripHandoffProposal(value);
  if (!value || typeof value !== "object") return value;
  if (depth > 64) return null;
  if (Array.isArray(value)) return value.map(item => sanitizeHandoffEvent(item, depth + 1));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeHandoffEvent(item, depth + 1)]));
}
