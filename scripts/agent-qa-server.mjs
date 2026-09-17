// Local-only, deterministic UI fixture. No credentials and no upstream traffic.
// npm run build && node scripts/agent-qa-server.mjs
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { createGateway } from "../gateway/server.mjs";
import { attachmentConfig } from "../gateway/attachments.mjs";
import { INPUT_FENCE, formatAttachmentReference, parseAttachmentReply } from "../lib/agent-attachments.mjs";

let serial = 0;
const conversations = new Map();
const rejected = new Set();
const workspace = new Map();
const msg = (role, text) => ({ id: `msg_${++serial}`, type: "message", role, content: [{ type: role === "user" ? "input_text" : "output_text", text }] });
const config = {
  allowedOrigins: new Set(["http://localhost:3100"]), signingSecret: "qa-only-not-a-production-secret-1234567890",
  conversationCookieName: "creekstone_qa_conversation", conversationTtlMs: 2592000000,
  conversationHistoryLimit: 20, bootstrapPrompt: "Hi", requestMaxBytes: 65536,
  boidsBaseUrl: "https://qa.invalid/v1", boidsApiKey: "qa-only", boidsModel: "agent:qa",
  ticketTtlMs: 60000, maxTtsCharacters: 8000, maxInputCharacters: 4000,
  attachments: attachmentConfig({ WORKSPACE_API_URL: "https://qa.invalid/workspace", WORKSPACE_API_KEY: `wsk_${"q".repeat(43)}` }),
};
if (process.env.QA_ATTACHMENTS_DISABLED === "1") config.attachments.enabled = false;
const fakeFetch = async (url, options = {}) => {
  const path = new URL(url).pathname;
  if (path === "/workspace") {
    const operation = JSON.parse(options.body);
    if (operation.path.includes("fail-upload")) return Response.json({ ok: false }, { status: 403 });
    if (operation.command === "write") {
      if (operation.path.includes("slow-upload")) await new Promise((resolve) => setTimeout(resolve, 3000));
      const bytes = Buffer.from(operation.dataBase64, "base64");
      workspace.set(operation.path, bytes);
      return Response.json({ ok: true, path: operation.path, size: bytes.length, action: "created" });
    }
    const bytes = workspace.get(operation.path);
    if (!bytes) return Response.json({ ok: false }, { status: 400 });
    return Response.json({ ok: true, path: operation.path, size: bytes.length, dataBase64: bytes.toString("base64") });
  }
  if (path === "/v1/conversations" && options.method === "POST") {
    const id = `conv_${++serial}`;
    conversations.set(id, []);
    return Response.json({ id });
  }
  if (path.endsWith("/items")) {
    const items = conversations.get(path.split("/")[3]);
    if (!items) return new Response(null, { status: 404 });
    const params = new URL(url).searchParams;
    const after = params.get("after");
    const reversed = items.slice().reverse();
    const start = after ? reversed.findIndex((item) => item.id === after) + 1 : 0;
    const limit = Number(params.get("limit"));
    return Response.json({ data: reversed.slice(start, start + limit), has_more: reversed.length > start + limit });
  }
  if (path === "/v1/responses") {
    const { input: rawInput, conversation } = JSON.parse(options.body);
    const input = parseAttachmentReply(rawInput.split(`\n\n${INPUT_FENCE}\n`)[0], true).text;
    const encodedManifest = rawInput.split(`${INPUT_FENCE}\n`)[1];
    const manifest = encodedManifest ? JSON.parse(encodedManifest.slice(0, -4)) : null;
    const items = conversations.get(conversation);
    if (input === "retry" && !rejected.has(conversation)) {
      rejected.add(conversation);
      return new Response(null, { status: 429 });
    }
    if (input === "seed history") {
      for (let i = 1; i <= 35; i++) items.push(msg("user", `Earlier question ${i}`), msg("assistant", `Earlier answer ${i}. This is a preserved conversation record.`));
    }
    let answer = input === "Hi" ? "你好，我是一豪的 AI 分身。你正在做什么？" :
      Array.from({ length: input === "long" ? 50 : 6 }, (_, i) => `\n\n**Signal ${i + 1}** — 先把问题讲清楚，再一起讨论。Build from a real founder problem and test your assumptions with the people who need it.`).join("");
    if (manifest && (manifest.files.length || input === "artifact" || input === "incomplete file")) {
      const outputPath = `${manifest.outputDirectory}/Founder memo 创业分析.md`;
      workspace.set(outputPath, Buffer.from("# Mock founder memo\n\nThis is a local QA artifact, not investment advice or a real Agent output.\n"));
      answer = `${formatAttachmentReference(outputPath)} 已收到材料。这是本地测试生成的分析文件，可下载后查看。`;
      if (input === "incomplete file") answer = formatAttachmentReference(outputPath).slice(0, -1);
    }
    const chunks = answer.match(/.{1,70}|\n/gs) || [];
    const encoder = new TextEncoder();
    let timer;
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('event: response.reasoning.delta\ndata: {"delta":"QA reasoning: visible only for real user turns."}\n\n'));
        let i = 0;
        timer = setInterval(() => {
          if (i < chunks.length) {
            controller.enqueue(encoder.encode(`event: response.output_text.delta\ndata: ${JSON.stringify({ delta: chunks[i++] })}\n\n`));
            if (input === "disconnect" && i === 3) {
              items.push(msg("user", rawInput), msg("assistant", answer));
              clearInterval(timer); controller.close();
            }
          } else {
            items.push(msg("user", rawInput), { ...msg("assistant", answer), ...(input === "incomplete file" ? { status: "in_progress" } : {}) });
            if (input !== "incomplete file") controller.enqueue(encoder.encode('event: response.completed\ndata: {"type":"response.completed"}\n\n'));
            clearInterval(timer); controller.close();
          }
        }, input === "long" ? 90 : 20);
      }, cancel() { clearInterval(timer); },
    }), { headers: { "Content-Type": "text/event-stream" } });
  }
  throw new Error(`Unexpected QA upstream ${path}`);
};
const gateway = createGateway({ config, fetchImpl: fakeFetch });
const root = resolve("out");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml" };
createServer(async (request, response) => {
  if (request.url.startsWith("/api/agent/")) {
    request.url = request.url.replace("/api/agent", "");
    gateway.emit("request", request, response);
    return;
  }
  const pathname = new URL(request.url, "http://localhost:3100").pathname;
  const path = resolve(root, `.${pathname.endsWith("/") ? `${pathname}index.html` : pathname}`);
  if (!path.startsWith(`${root}/`)) { response.writeHead(403).end(); return; }
  try {
    const body = await readFile(path);
    response.writeHead(200, { "Content-Type": types[extname(path)] || "application/octet-stream" }).end(body);
  } catch { response.writeHead(404).end(); }
}).listen(3100, "127.0.0.1", () => console.log("Local QA: http://localhost:3100/agent/ · prompts: long / retry / disconnect / seed history / artifact / incomplete file · files: slow-upload / fail-upload"));
