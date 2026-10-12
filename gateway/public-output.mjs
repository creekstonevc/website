import { isInternalOutputFile } from "./attachments.mjs";
import { createHandoffTextFilter } from "./handoff-proposal.mjs";
import { attachmentDisplayText } from "../lib/agent-attachments.mjs";

const NAMES = ["attachments", "file", "think", "thinking", "reasoning", "analysis"];
const OPENERS = ["<", "&lt;"];
const PREFIXES = OPENERS.flatMap(open => NAMES.flatMap(name => [open + name, open + "/" + name]));

// Delay possible protocol prefixes across arbitrary SSE chunk boundaries. The
// body of a reserved block never leaves the gateway, even when left unclosed.
function createProtocolFilter() {
  let pending = "", stack = [], sealed = false;
  return {
    push(text) {
      if (sealed) return "";
      pending += text;
      let result = "";
      while (pending) {
        const lower = pending.toLowerCase();
        const prefix = PREFIXES.find(value => lower.startsWith(value) && /^[\s/>]|^&gt;/.test(lower.slice(value.length)));
        if (prefix) {
          const encoded = prefix.startsWith("&lt;");
          const end = pending.indexOf(encoded ? "&gt;" : ">", prefix.length);
          if (end < 0) {
            if (pending.length > 8192) { pending = ""; sealed = true; }
            break;
          }
          const token = lower.slice(0, end);
          const name = prefix.replace(/^(?:<|&lt;)\/?/, "");
          const closing = /^(?:<|&lt;)\//.test(prefix);
          if (closing) {
            if (stack.at(-1) === name) stack.pop();
          } else if (!/\/\s*$/.test(token)) {
            stack.push(name);
            if (stack.length > 32) { pending = ""; sealed = true; break; }
          }
          pending = pending.slice(end + (encoded ? 4 : 1));
          continue;
        }
        if (PREFIXES.some(value => value.startsWith(lower) ||
          value.startsWith("&lt;") && lower.startsWith(value) && "&gt;".startsWith(lower.slice(value.length)))) break;
        const next = pending.slice(1).search(/[<&]/);
        const length = next < 0 ? pending.length : next + 1;
        if (!stack.length) result += pending.slice(0, length);
        pending = pending.slice(length);
      }
      return result;
    },
    finish() { pending = ""; return ""; },
  };
}

const PATH_PREFIXES = ["/workspace/", "/mnt/data/", "/opt/creekstone-handoff/"].flatMap(path => [path, "sandbox:" + path]);
const PATH_END = /[\s`"'<>()\[\]{}，。；！？、]/;
function createPathFilter() {
  let pending = "", dropping = false;
  const display = path => isInternalOutputFile(path) ? "" : /^((sandbox:)?\/workspace\/session\/|(sandbox:)?\/mnt\/data\/)/i.test(path) ? "附件" : path;
  const drain = (final = false) => {
    let result = "";
    while (pending) {
      if (dropping) {
        const end = pending.search(PATH_END);
        if (end < 0) { pending = ""; break; }
        pending = pending.slice(end); dropping = false;
      }
      const lower = pending.toLowerCase();
      const prefix = PATH_PREFIXES.find(value => lower.startsWith(value));
      if (prefix) {
        const offset = pending.slice(prefix.length).search(PATH_END);
        if (offset < 0 && !final) {
          if (pending.length > 8192) { pending = ""; dropping = true; }
          break;
        }
        const end = offset < 0 ? pending.length : prefix.length + offset;
        result += display(pending.slice(0, end));
        pending = pending.slice(end);
      } else if (PATH_PREFIXES.some(value => value.startsWith(lower))) {
        // Do not disclose a truncated private path prefix at end-of-stream.
        if (final) pending = "";
        break;
      } else {
        const next = pending.slice(1).search(/[sS/]/);
        const length = next < 0 ? pending.length : next + 1;
        result += pending.slice(0, length); pending = pending.slice(length);
      }
    }
    return result;
  };
  return { push(text) { pending += text; return drain(); }, finish() { return drain(true); } };
}

export function createPublicTextFilter() {
  const handoff = createHandoffTextFilter();
  const protocol = createProtocolFilter();
  const paths = createPathFilter();
  return {
    push(text) { return paths.push(protocol.push(handoff.push(text))); },
    finish() { return paths.push(protocol.push(handoff.finish()) + protocol.finish()) + paths.finish(); },
  };
}

export function publicAssistantText(text) {
  const filter = createPublicTextFilter();
  return attachmentDisplayText(filter.push(text || "") + filter.finish(), true)
    .replace(/```(?:xml|html)?\s*```/gi, "")
    .replace(/`附件`/g, "附件");
}
