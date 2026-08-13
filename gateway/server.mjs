import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import {
  GatewayError,
  buildBoidsResponsePayload,
  createConversationCredential,
  createTtsTicket,
  decodeBytePlusAudio,
  extractCompletedText,
  isReasoningSseEvent,
  normalizeConversationHistory,
  parseSseFrame,
  readJsonBody,
  verifyConversationCredential,
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
    conversationCookieName:
      env.GATEWAY_CONVERSATION_COOKIE_NAME?.trim() || "creekstone_conversation",
    conversationTtlMs: Number(
      env.GATEWAY_CONVERSATION_TTL_MS || 30 * 24 * 60 * 60_000,
    ),
    conversationHistoryLimit: Number(
      env.GATEWAY_CONVERSATION_HISTORY_LIMIT || 100,
    ),
    bootstrapPrompt: env.GATEWAY_BOOTSTRAP_PROMPT || "Hi",
    boidsApiKey: required("BOIDS_API_KEY", env),
    boidsBaseUrl: (env.BOIDS_BASE_URL || "https://api.boids.so/v1").replace(
      /\/$/,
      "",
    ),
    boidsModel:
      env.BOIDS_AGENT_MODEL || "agent:@qq1006775897-1-org/qq1006775897",
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
    throw new GatewayError(
      403,
      "origin_not_allowed",
      "Request origin is not allowed",
    );
  }
}

function readCookie(request, name) {
  const raw = request.headers.cookie;
  if (!raw) return "";
  for (const pair of raw.split(";")) {
    const separator = pair.indexOf("=");
    if (separator < 0 || pair.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(pair.slice(separator + 1).trim());
    } catch {
      return "";
    }
  }
  return "";
}

function readConversationSession(request, config) {
  return verifyConversationCredential(
    readCookie(request, config.conversationCookieName),
    config.signingSecret,
  );
}

function conversationCookie(request, conversationId, config) {
  const credential = createConversationCredential(
    conversationId,
    config.signingSecret,
    {
      ttlMs: config.conversationTtlMs,
    },
  );
  const origin = request.headers.origin || "";
  const secure = !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return [
    `${config.conversationCookieName}=${encodeURIComponent(credential)}`,
    `Max-Age=${Math.floor(config.conversationTtlMs / 1_000)}`,
    "Path=/api/agent",
    "HttpOnly",
    secure ? "Secure" : "",
    "SameSite=Lax",
  ]
    .filter(Boolean)
    .join("; ");
}

function boidsHeaders(config, extra = {}) {
  return {
    Authorization: `Bearer ${config.boidsApiKey}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

function throwBoidsError(status) {
  throw new GatewayError(
    status === 429 ? 429 : 502,
    status === 429 ? "rate_limited" : "agent_upstream_error",
    status === 429
      ? "The founder channel is busy"
      : "Agent service is unavailable",
  );
}

async function createBoidsConversation(config, fetchImpl) {
  const upstream = await fetchImpl(`${config.boidsBaseUrl}/conversations`, {
    method: "POST",
    headers: boidsHeaders(config),
    body: JSON.stringify({
      metadata: { source: "creekstone-web", bootstrap_prompt: "hi_v1" },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!upstream.ok) throwBoidsError(upstream.status);
  const payload = await upstream.json();
  if (typeof payload?.id !== "string") {
    throw new GatewayError(
      502,
      "agent_upstream_error",
      "Agent service is unavailable",
    );
  }
  return payload.id;
}

async function deleteBoidsConversation(conversationId, config, fetchImpl) {
  await fetchImpl(
    `${config.boidsBaseUrl}/conversations/${encodeURIComponent(conversationId)}`,
    {
      method: "DELETE",
      headers: boidsHeaders(config),
      signal: AbortSignal.timeout(30_000),
    },
  ).catch(() => undefined);
}

async function fetchBoidsHistory(conversationId, config, fetchImpl, limit) {
  const url = new URL(
    `${config.boidsBaseUrl}/conversations/${encodeURIComponent(conversationId)}/items`,
  );
  url.searchParams.set("order", "desc");
  url.searchParams.set("limit", String(limit));
  const upstream = await fetchImpl(url, {
    headers: boidsHeaders(config),
    signal: AbortSignal.timeout(30_000),
  });
  if (upstream.status === 404) return null;
  if (!upstream.ok) throwBoidsError(upstream.status);
  const payload = await upstream.json();
  const newestFirst = Array.isArray(payload?.data) ? payload.data : [];
  const oldestFirst = newestFirst.slice().reverse();
  const messages = normalizeConversationHistory(oldestFirst, {
    bootstrapPrompt: config.bootstrapPrompt,
    oldestItemIncluded: payload?.has_more !== true,
  }).map((message) => ({
    ...message,
    ...(message.role === "assistant"
      ? {
          ttsTicket:
            createTtsTicket(message.content, config.signingSecret, {
              ttlMs: config.ticketTtlMs,
              maxCharacters: config.maxTtsCharacters,
            }) || undefined,
        }
      : {}),
  }));
  const rawMessageCount = oldestFirst.filter(
    (item) => item?.type === "message",
  ).length;
  return {
    messages,
    needsBootstrap: rawMessageCount === 0,
    truncated: payload?.has_more === true,
  };
}

async function proxyConversation(request, response, config, fetchImpl) {
  const body = await readJsonBody(request, config.requestMaxBytes);
  if (body.reset !== undefined && typeof body.reset !== "boolean") {
    throw new GatewayError(400, "invalid_request", "Reset must be a boolean");
  }

  const existing = readConversationSession(request, config);
  if (existing && !body.reset) {
    const history = await fetchBoidsHistory(
      existing.conversationId,
      config,
      fetchImpl,
      config.conversationHistoryLimit,
    );
    if (history) {
      sendJson(
        response,
        200,
        {
          created: false,
          needsBootstrap: history.needsBootstrap,
          truncated: history.truncated,
          messages: history.messages,
        },
        {
          "Set-Cookie": conversationCookie(
            request,
            existing.conversationId,
            config,
          ),
        },
      );
      return;
    }
  }

  if (existing && body.reset) {
    await deleteBoidsConversation(existing.conversationId, config, fetchImpl);
  }
  const conversationId = await createBoidsConversation(config, fetchImpl);
  sendJson(
    response,
    200,
    { created: true, needsBootstrap: true, truncated: false, messages: [] },
    { "Set-Cookie": conversationCookie(request, conversationId, config) },
  );
}

async function proxyResponseStream(
  request,
  response,
  config,
  fetchImpl,
  bootstrapLocks,
) {
  const body = await readJsonBody(request, config.requestMaxBytes);
  if (body.bootstrap !== undefined && typeof body.bootstrap !== "boolean") {
    throw new GatewayError(
      400,
      "invalid_request",
      "Bootstrap must be a boolean",
    );
  }
  const session = readConversationSession(request, config);
  if (!session) {
    throw new GatewayError(
      409,
      "conversation_required",
      "Conversation session is required",
    );
  }

  let releaseBootstrap;
  if (body.bootstrap) {
    const activeBootstrap = bootstrapLocks.get(session.conversationId);
    if (activeBootstrap) {
      await activeBootstrap;
      throw new GatewayError(
        409,
        "bootstrap_completed",
        "Opening signal is ready",
      );
    }
    let resolveBootstrap;
    const completion = new Promise((resolve) => {
      resolveBootstrap = resolve;
    });
    bootstrapLocks.set(session.conversationId, completion);
    releaseBootstrap = () => {
      bootstrapLocks.delete(session.conversationId);
      resolveBootstrap();
    };
  }

  try {
    if (body.bootstrap) {
      const history = await fetchBoidsHistory(
        session.conversationId,
        config,
        fetchImpl,
        1,
      );
      if (!history) {
        throw new GatewayError(
          409,
          "conversation_required",
          "Conversation session is required",
        );
      }
      if (!history.needsBootstrap) {
        throw new GatewayError(
          409,
          "conversation_not_empty",
          "Conversation already has history",
        );
      }
    }
    const payload = buildBoidsResponsePayload(
      { ...body, input: body.bootstrap ? config.bootstrapPrompt : body.input },
      config.boidsModel,
      session.conversationId,
      config.maxInputCharacters,
    );
    const controller = new AbortController();
    response.on("close", () => {
      if (!response.writableEnded) controller.abort();
    });

    const upstream = await fetchImpl(`${config.boidsBaseUrl}/responses`, {
      method: "POST",
      headers: boidsHeaders(config, { Accept: "text/event-stream" }),
      body: JSON.stringify(payload),
      signal: upstreamSignal(controller, 310_000),
    });

    if (!upstream.ok || !upstream.body) {
      await upstream.body?.cancel().catch(() => undefined);
      throwBoidsError(upstream.status);
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
      if (body.bootstrap && isReasoningSseEvent(parsed)) return;
      if (
        parsed.type === "response.output_text.delta" &&
        typeof parsed.payload?.delta === "string"
      ) {
        streamedText += parsed.payload.delta;
      }
      if (parsed.type === "response.completed") {
        const completedText = extractCompletedText(parsed.payload, streamedText);
        emitTicket(completedText);
        if (body.bootstrap) {
          response.write(
            `event: response.completed\ndata: ${JSON.stringify({
              type: "response.completed",
              response: {
                output: [
                  {
                    type: "message",
                    role: "assistant",
                    content: [{ type: "output_text", text: completedText }],
                  },
                ],
              },
            })}\n\n`,
          );
          return;
        }
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
  } finally {
    releaseBootstrap?.();
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
    throw new GatewayError(
      502,
      "tts_upstream_error",
      "Voice rendering is unavailable",
    );
  }
  return decodeBytePlusAudio(raw);
}

async function renderTicketedTts(
  request,
  response,
  config,
  fetchImpl,
  cache,
  inFlight,
) {
  const body = await readJsonBody(request, config.requestMaxBytes);
  const { text } = verifyTtsTicket(body.ticket, config.signingSecret);
  const key = ttsCacheKey(text, config);

  let audio = cache.get(key);
  if (!audio) {
    let activeRender = inFlight.get(key);
    if (!activeRender) {
      activeRender = renderTts(text, config, fetchImpl).finally(() =>
        inFlight.delete(key),
      );
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

export function createGateway({
  config = loadConfig(),
  fetchImpl = fetch,
} = {}) {
  const cache = new Map();
  const inFlight = new Map();
  const bootstrapLocks = new Map();

  return createServer(async (request, response) => {
    const requestId = randomUUID();
    response.setHeader("X-Request-Id", requestId);

    try {
      const url = new URL(
        request.url || "/",
        `http://${request.headers.host || "localhost"}`,
      );
      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, {
          ok: true,
          service: "creekstone-agent-gateway",
        });
        return;
      }

      if (request.method !== "POST") {
        throw new GatewayError(
          405,
          "method_not_allowed",
          "Method is not allowed",
        );
      }
      assertOrigin(request, config);

      if (url.pathname === "/conversations") {
        await proxyConversation(request, response, config, fetchImpl);
        return;
      }
      if (url.pathname === "/responses") {
        await proxyResponseStream(
          request,
          response,
          config,
          fetchImpl,
          bootstrapLocks,
        );
        return;
      }
      if (url.pathname === "/tts") {
        await renderTicketedTts(
          request,
          response,
          config,
          fetchImpl,
          cache,
          inFlight,
        );
        return;
      }
      throw new GatewayError(404, "not_found", "Route was not found");
    } catch (error) {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      const known = error instanceof GatewayError;
      const status = known
        ? error.status
        : error?.name === "TimeoutError"
          ? 504
          : 500;
      const code = known
        ? error.code
        : status === 504
          ? "upstream_timeout"
          : "gateway_error";
      const message = known ? error.message : "Gateway request failed";
      sendJson(response, status, {
        ok: false,
        error: { code, message, requestId },
      });
      if (!known) {
        process.stderr.write(
          `${JSON.stringify({ event: "gateway.error", requestId, message: String(error) })}\n`,
        );
      }
    }
  });
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const config = loadConfig();
  const server = createGateway({ config });
  server.listen(config.port, config.host, () => {
    process.stdout.write(
      `${JSON.stringify({ event: "gateway.started", host: config.host, port: config.port })}\n`,
    );
  });
}
