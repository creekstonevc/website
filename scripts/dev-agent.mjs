// Local-only full-stack preview. Remote credentials stay in process memory;
// the production signing secret/cookies and deployment are never reused.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import next from "next";
import { createGateway, loadConfig } from "../gateway/server.mjs";

export function localAgentEnvironment(remote = false) {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  let credentials;
  if (remote) {
    const script = `const fs=require('node:fs'); const raw=fs.readFileSync('/etc/creekstone-agent-gateway.env','utf8');
const allowed=['BOIDS_API_KEY','BOIDS_BASE_URL','BOIDS_AGENT_MODEL','BYTEPLUS_TTS_API_KEY','BYTEPLUS_TTS_SPEAKER_ID','BYTEPLUS_TTS_RESOURCE_ID','BYTEPLUS_TTS_URL','BYTEPLUS_TTS_LIVE_URL'];
const env={}; for(const line of raw.split('\\n')) { const i=line.indexOf('='); const key=line.slice(0,i); if(allowed.includes(key)) env[key]=line.slice(i+1).trim().replace(/^['"]|['"]$/g,''); } process.stdout.write(JSON.stringify(env));`;
    // SSH stdout is captured, never printed or written to the repository.
    try {
      credentials = JSON.parse(execFileSync("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "creekstone", "node"],
        { input: script, encoding: "utf8", stdio: ["pipe", "pipe", "ignore"], timeout: 20000 }));
    } catch { throw new Error("Could not read the permitted server credentials over SSH"); }
  } else {
    credentials = process.env;
  }
  return { ...credentials,
    MIZZEN_INPUT_KEY: process.env.MIZZEN_INPUT_KEY,
    MIZZEN_PLAYBACK_KEY: process.env.MIZZEN_PLAYBACK_KEY,
    MIZZEN_BASE_URL: process.env.MIZZEN_BASE_URL,
    GATEWAY_SIGNING_SECRET: randomBytes(32).toString("hex"),
    GATEWAY_CONVERSATION_COOKIE_NAME: "creekstone_local_conversation",
    GATEWAY_ALLOWED_ORIGINS: "http://localhost:3100,http://127.0.0.1:3100" };
}

if (process.argv[1]?.endsWith("/dev-agent.mjs")) {
  const config = loadConfig(localAgentEnvironment(process.argv.includes("--server-credentials")));
  const app = next({ dev: true, hostname: "127.0.0.1", port: 3100 });
  await app.prepare();
  const handler = app.getRequestHandler();
  const gateway = createGateway({ config });
  const server = createServer((request, response) => {
    if (request.url?.startsWith("/api/agent/")) {
      request.url = request.url.slice("/api/agent".length);
      gateway.emit("request", request, response);
    } else void handler(request, response);
  });
  server.listen(3100, "127.0.0.1", () => console.log("Local Agent + live voice: http://localhost:3100/agent/ (production is unchanged)"));
  const close = async () => { server.close(); await gateway.stopMedia(); await app.close(); process.exit(0); };
  process.once("SIGTERM", close); process.once("SIGINT", close);
}
