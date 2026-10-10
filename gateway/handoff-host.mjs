import { spawn } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { parseEnv } from "node:util";
import { GatewayError } from "./core.mjs";

export function loadHandoffHostEnvironment(filename) {
  if (typeof filename !== "string" || !filename.startsWith("/")) throw new Error("Invalid host environment path");
  const stat = statSync(filename);
  if (!stat.isFile() || stat.uid !== 0 || (stat.mode & 0o027) || stat.size > 16384) throw new Error("Unsafe handoff environment permissions");
  const values = parseEnv(readFileSync(filename, "utf8"));
  const names = ["CREEKSTONE_HANDOFF_WORKSPACE_URL", "CREEKSTONE_HANDOFF_WORKSPACE_API_KEY", "CREEKSTONE_HANDOFF_LEDGER_PATH", "CREEKSTONE_HANDOFF_CONFIRMATION_TTL_SECONDS"];
  for (const key of names.slice(0, 3)) if (!values[key]) throw new Error("Handoff host environment is incomplete");
  if (!values.CREEKSTONE_HANDOFF_LEDGER_PATH.startsWith("/var/lib/creekstone-handoff/")) throw new Error("Invalid handoff ledger location");
  return Object.fromEntries(names.filter(key => values[key]).map(key => [key, values[key]]));
}

// Host-only bridge. No shell, browser-supplied executable/arguments, provider
// credentials, model text interpreted as authority, or stdout/stderr logging.
export function createHandoffHost({ command, envFile, timeoutMs = 180000, spawnImpl = spawn, readEnvironment = loadHandoffHostEnvironment }) {
  if (typeof command !== "string" || !command.startsWith("/") || /[\0\r\n]/.test(command)) {
    throw new Error("Handoff host command must be an absolute path");
  }
  let active = 0;
  return async (request) => {
    if (active >= 4) throw new GatewayError(429, "handoff_busy", "Handoff service is busy");
    const input = JSON.stringify(request);
    if (Buffer.byteLength(input) > 24 * 1024) throw new GatewayError(400, "handoff_invalid", "Handoff request is too large");
    active++;
    try {
      let environment;
      try { environment = readEnvironment(envFile); }
      catch { throw new GatewayError(503, "handoff_unavailable", "Handoff host is unavailable"); }
      return await new Promise((resolve, reject) => {
        let settled = false, size = 0;
        const chunks = [];
        let child;
        const finish = (error, result) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (error) { child?.kill("SIGKILL"); reject(error); }
          else resolve(result);
        };
        const timer = setTimeout(() => finish(new GatewayError(504, "handoff_outcome_unknown", "Check status before trying again")), timeoutMs);
        try {
          child = spawnImpl(command, [], {
            shell: false, stdio: ["pipe", "pipe", "ignore"],
            env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8", ...environment },
          });
        } catch { finish(new GatewayError(503, "handoff_unavailable", "Handoff host is unavailable")); return; }
        child.on("error", () => finish(new GatewayError(503, "handoff_unavailable", "Handoff host is unavailable")));
        child.stdin.on("error", () => finish(new GatewayError(502, "handoff_outcome_unknown", "Check status before trying again")));
        child.stdout.on("data", chunk => {
          size += chunk.length;
          if (size > 128 * 1024) finish(new GatewayError(502, "handoff_outcome_unknown", "Invalid handoff host response"));
          else chunks.push(chunk);
        });
        child.on("close", (code) => {
          if (settled) return;
          try {
            const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            if (!result || typeof result !== "object" || Array.isArray(result) || (code !== 0 && result.ok !== false)) throw new Error();
            finish(null, result);
          } catch { finish(new GatewayError(502, "handoff_outcome_unknown", "Check status before trying again")); }
        });
        child.stdin.end(`${input}\n`);
      });
    } finally { active--; }
  };
}
