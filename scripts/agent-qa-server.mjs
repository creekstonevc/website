// Local-only, deterministic UI fixture. No credentials and no upstream traffic.
// npm run build && node scripts/agent-qa-server.mjs
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { createGateway } from "../gateway/server.mjs";
import { attachmentConfig } from "../gateway/attachments.mjs";

let serial = 0;
const conversations = new Map();
const rejected = new Set();
const files = new Map();
const msg = (role, text) => ({ id: `msg_${++serial}`, type: "message", role, content: [{ type: role === "user" ? "input_text" : "output_text", text }] });
const config = {
  allowedOrigins: new Set(["http://localhost:3100"]), signingSecret: "qa-only-not-a-production-secret-1234567890",
  conversationCookieName: "creekstone_qa_conversation", conversationTtlMs: 2592000000,
  conversationHistoryLimit: 20, bootstrapPrompt: "Hi", requestMaxBytes: 65536,
  boidsBaseUrl: "https://qa.invalid/v1", boidsApiKey: "qa-only", boidsModel: "agent:qa",
  ticketTtlMs: 60000, maxTtsCharacters: 8000, maxInputCharacters: 4000,
  attachments: attachmentConfig(),
};
if (process.env.QA_ATTACHMENTS_DISABLED === "1") config.attachments.enabled = false;
const fakeFetch = async (url, options = {}) => {
  const path = new URL(url).pathname;
  if (path === "/v1/files" && options.method === "POST") {
    const file = options.body.get("file");
    if (file.name.includes("fail-upload")) return new Response(null, { status: 403 });
    if (file.name.includes("slow-upload")) await new Promise((resolve) => setTimeout(resolve, 3000));
    const id = `file-qa-${++serial}`;
    const bytes = Buffer.from(await file.arrayBuffer());
    files.set(id, { filename: file.name, bytes });
    return Response.json({ id, object: "file", filename: file.name, bytes: bytes.length, purpose: "user_data", status: "processed" });
  }
  if (path.startsWith("/v1/files/")) {
    const id = path.split("/")[3];
    const file = files.get(id);
    if (!file) return new Response(null, { status: 404 });
    if (path.endsWith("/content")) return new Response(file.bytes);
    return Response.json({ id, object: "file", filename: file.filename, bytes: file.bytes.length });
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
    const content = Array.isArray(rawInput) ? rawInput[0].content : [{ type: "input_text", text: rawInput }];
    const input = content.find((part) => part.type === "input_text")?.text || "";
    const uploaded = content.filter((part) => part.type === "input_file");
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
    const annotations = [];
    if (uploaded.length || ["artifact", "incomplete file", "file only"].includes(input)) {
      const id = `file-out-qa-${++serial}`;
      const filename = "Founder memo 创业分析.md";
      files.set(id, { filename, bytes: Buffer.from("# Mock founder memo\n\nThis is a local QA artifact, not investment advice or a real Agent output.\n") });
      annotations.push({ type: "file_path", file_id: id, index: 0 });
      answer = input === "file only" ? "" : `文件已生成：\`/workspace/session/${filename}\`。这是本地测试文件，可下载后查看。`;
    }
    const userMessage = { ...msg("user", input), content };
    const assistantMessage = { ...msg("assistant", answer), status: input === "incomplete file" ? "in_progress" : "completed",
      content: [{ type: "output_text", text: answer, annotations }] };
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
              items.push(userMessage, assistantMessage);
              clearInterval(timer); controller.close();
            }
          } else {
            items.push(userMessage, assistantMessage);
            if (input !== "incomplete file") controller.enqueue(encoder.encode(`event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: { output: [assistantMessage] } })}\n\n`));
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
}).listen(3100, "127.0.0.1", () => console.log("Local QA: http://localhost:3100/agent/ · prompts: long / retry / disconnect / seed history / artifact / incomplete file / file only · files: slow-upload / fail-upload"));
