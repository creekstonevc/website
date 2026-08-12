import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import {
  GatewayError,
  buildBoidsResponsePayload,
  createTtsTicket,
  decodeBytePlusAudio,
  extractCompletedText,
  parseSseFrame,
  readJsonBody,
  verifyTtsTicket,
} from "./core.mjs";

const DEFAULT_ALLOWED_ORIGINS = [
  "https://creekstonevc.com",
  "https://www.creekstonevc.com",
  "http://localhost:3100",
  "http://127.0.0.1:3100",
];

function required(name, env) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function loadConfig(env = process.env) {
  return {
    host: env.GATEWAY_HOST?.trim() || "127.0.0.1",
    port: Number(env.GATEWAY_PORT || 8790),
    allowedOrigins: new Set(
      (env.GATEWAY_ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS.join(","))
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
    signingSecret: required("GATEWAY_SIGNING_SECRET", env),
    ticketTtlMs: Number(env.GATEWAY_TTS_TICKET_TTL_MS || 30 * 60_000),
    requestMaxBytes: Number(env.GATEWAY_REQUEST_MAX_BYTES || 64 * 1024),
    maxInputCharacters: Number(env.GATEWAY_MAX_INPUT_CHARACTERS || 4_000),
    maxTtsCharacters: Number(env.GATEWAY_MAX_TTS_CHARACTERS || 8_000),
    boidsApiKey: required("BOIDS_API_KEY", env),
    boidsBaseUrl: (env.BOIDS_BASE_URL || "https://staging-api.boids.so/v1").replace(/\/$/, ""),
    boidsModel: env.BOIDS_AGENT_MODEL || "agent:@1633756673-org/liyihao",
    bytePlusApiKey: required("BYTEPLUS_TTS_API_KEY", env),
    bytePlusUrl:
      env.BYTEPLUS_TTS_URL ||
      "https://voice.ap-southeast-1.bytepluses.com/api/v3/tts/unidirectional",
    bytePlusSpeakerId: required("BYTEPLUS_TTS_SPEAKER_ID", env),
    bytePlusResourceId: env.BYTEPLUS_TTS_RESOURCE_ID || "seed-icl-2.0",
  };
}

function sendJson(response, status, payload, extraHeaders = {}) {
  const body = Buffer.from(JSON.stringify(payload));
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders,
  });
  response.end(body);
}

function upstreamSignal(controller, timeoutMs) {
  return AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)]);
}

function assertOrigin(request, config) {
  const origin = request.headers.origin;
  if (!origin || !config.allowedOrigins.has(origin)) {
    throw new GatewayError(403, "origin_not_allowed", "Request origin is not allowed");
  }
}

async function proxyConversation(request, response, config, fetchImpl) {
  await readJsonBody(request, config.requestMaxBytes);
  const controller = new AbortController();
  const upstream = await fetchImpl(`${config.boidsBaseUrl}/conversations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.boidsApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ metadata: { source: "creekstone-web" } }),
    signal: upstreamSignal(controller, 30_000),
  });

  const body = Buffer.from(await upstream.arrayBuffer());
  if (!upstream.ok) {
    throw new GatewayError(
      upstream.status === 429 ? 429 : 502,
      upstream.status === 429 ? "rate_limited" : "agent_upstream_error",
      upstream.status === 429 ? "The founder channel is busy" : "Agent service is unavailable",
    );
  }

  response.writeHead(upstream.status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

async function proxyResponseStream(request, response, config, fetchImpl) {
  const body = await readJsonBody(request, config.requestMaxBytes);
  const payload = buildBoidsResponsePayload(
    body,
    config.boidsModel,
    config.maxInputCharacters,
  );
  const controller = new AbortController();
  response.on("close", () => {
    if (!response.writableEnded) controller.abort();
  });

  const upstream = await fetchImpl(`${config.boidsBaseUrl}/responses`, {
    method: "POST",
    headers: {
      Accept: "text/event-stream",
      Authorization: `Bearer ${config.boidsApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: upstreamSignal(controller, 310_000),
  });

  if (!upstream.ok || !upstream.body) {
    await upstream.body?.cancel().catch(() => undefined);
    throw new GatewayError(
      upstream.status === 429 ? 429 : 502,
      upstream.status === 429 ? "rate_limited" : "agent_upstream_error",
      upstream.status === 429 ? "The founder channel is busy" : "Agent service is unavailable",
    );
  }

  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-store",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "X-Content-Type-Options": "nosniff",
  });
  response.flushHeaders();

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let streamedText = "";
  let ticketSent = false;

  const emitTicket = (text) => {
    if (ticketSent) return;
    const ticket = createTtsTicket(text, config.signingSecret, {
      ttlMs: config.ticketTtlMs,
      maxCharacters: config.maxTtsCharacters,
    });
    if (!ticket) return;
    response.write(
      `event: creekstone.tts.ready\ndata: ${JSON.stringify({ ticket })}\n\n`,
    );
    ticketSent = true;
  };

  const relayFrame = (frame) => {
    const parsed = parseSseFrame(frame);
    if (parsed.type === "response.output_text.delta" && typeof parsed.payload?.delta === "string") {
      streamedText += parsed.payload.delta;
    }
    if (parsed.type === "response.completed") {
      emitTicket(extractCompletedText(parsed.payload, streamedText));
    } else if (parsed.done) {
      emitTicket(streamedText);
    }
    response.write(`${frame}\n\n`);
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      const frames = pending.split(/\r?\n\r?\n/);
      pending = frames.pop() ?? "";
      for (const frame of frames) relayFrame(frame);
    }
    pending += decoder.decode();
    if (pending.trim()) relayFrame(pending);
    emitTicket(streamedText);
    response.end();
  } finally {
    reader.releaseLock();
  }
}

function ttsCacheKey(text, config) {
  return createHash("sha256")
    .update(config.bytePlusResourceId)
    .update("\0")
    .update(config.bytePlusSpeakerId)
    .update("\0")
    .update(text)
    .digest("hex");
}

async function renderTts(text, config, fetchImpl) {
  const additions = JSON.stringify({
    disable_markdown_filter: true,
    enable_language_detector: true,
    enable_latex_tn: true,
    disable_default_bit_rate: true,
    max_length_to_filter_parenthesis: 0,
    cache_config: { text_type: 1, use_cache: true },
  });
  const upstream = await fetchImpl(config.bytePlusUrl, {
    method: "POST",
    headers: {
      "x-api-key": config.bytePlusApiKey,
      "X-Api-Resource-Id": config.bytePlusResourceId,
      "Content-Type": "application/json",
      Connection: "keep-alive",
    },
    body: JSON.stringify({
      req_params: {
        text,
        speaker: config.bytePlusSpeakerId,
        additions,
        audio_params: { format: "mp3", sample_rate: 24_000 },
      },
    }),
    signal: AbortSignal.timeout(120_000),
  });

  const raw = await upstream.text();
  if (!upstream.ok) {
    throw new GatewayError(502, "tts_upstream_error", "Voice rendering is unavailable");
  }
  return decodeBytePlusAudio(raw);
}

async function renderTicketedTts(request, response, config, fetchImpl, cache, inFlight) {
  const body = await readJsonBody(request, config.requestMaxBytes);
  const { text } = verifyTtsTicket(body.ticket, config.signingSecret);
  const key = ttsCacheKey(text, config);

  let audio = cache.get(key);
  if (!audio) {
    let activeRender = inFlight.get(key);
    if (!activeRender) {
      activeRender = renderTts(text, config, fetchImpl).finally(() => inFlight.delete(key));
      inFlight.set(key, activeRender);
    }
    audio = await activeRender;
    cache.set(key, audio);
    if (cache.size > 24) cache.delete(cache.keys().next().value);
  } else {
    cache.delete(key);
    cache.set(key, audio);
  }

  response.writeHead(200, {
    "Content-Type": "audio/mpeg",
    "Content-Length": audio.length,
    "Cache-Control": "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(audio);
}

export function createGateway({ config = loadConfig(), fetchImpl = fetch } = {}) {
  const cache = new Map();
  const inFlight = new Map();

  return createServer(async (request, response) => {
    const requestId = randomUUID();
    response.setHeader("X-Request-Id", requestId);

    try {
      const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, { ok: true, service: "creekstone-agent-gateway" });
        return;
      }

      if (request.method !== "POST") {
        throw new GatewayError(405, "method_not_allowed", "Method is not allowed");
      }
      assertOrigin(request, config);

      if (url.pathname === "/conversations") {
        await proxyConversation(request, response, config, fetchImpl);
        return;
      }
      if (url.pathname === "/responses") {
        await proxyResponseStream(request, response, config, fetchImpl);
        return;
      }
      if (url.pathname === "/tts") {
        await renderTicketedTts(request, response, config, fetchImpl, cache, inFlight);
        return;
      }
      throw new GatewayError(404, "not_found", "Route was not found");
    } catch (error) {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      const known = error instanceof GatewayError;
      const status = known ? error.status : error?.name === "TimeoutError" ? 504 : 500;
      const code = known ? error.code : status === 504 ? "upstream_timeout" : "gateway_error";
      const message = known ? error.message : "Gateway request failed";
      sendJson(response, status, { ok: false, error: { code, message, requestId } });
      if (!known) {
        process.stderr.write(
          `${JSON.stringify({ event: "gateway.error", requestId, message: String(error) })}\n`,
        );
      }
    }
  });
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const config = loadConfig();
  const server = createGateway({ config });
  server.listen(config.port, config.host, () => {
    process.stdout.write(
      `${JSON.stringify({ event: "gateway.started", host: config.host, port: config.port })}\n`,
    );
  });
}
