import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createGateway } from "./server.mjs";

const origin = "https://creekstonevc.com";

function testConfig() {
  return {
    host: "127.0.0.1",
    port: 0,
    allowedOrigins: new Set([origin]),
    signingSecret: "integration-secret-that-is-long-enough-for-hmac",
    ticketTtlMs: 60_000,
    requestMaxBytes: 64 * 1024,
    maxInputCharacters: 4_000,
    maxTtsCharacters: 8_000,
    conversationCookieName: "creekstone_conversation",
    conversationTtlMs: 30 * 24 * 60 * 60_000,
    conversationHistoryLimit: 100,
    bootstrapPrompt: "Hi",
    boidsApiKey: "boids-test-key",
    boidsBaseUrl: "https://boids.example/v1",
    boidsModel: "agent:creekstone",
    bytePlusApiKey: "byteplus-test-key",
    bytePlusUrl: "https://voice.example/tts",
    bytePlusSpeakerId: "speaker-test",
    bytePlusResourceId: "seed-icl-2.0",
  };
}

async function withGateway(fakeFetch, run) {
  const server = createGateway({ config: testConfig(), fetchImpl: fakeFetch });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

function cookieFrom(response) {
  const setCookie = response.headers.get("set-cookie");
  assert.ok(setCookie);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /SameSite=Lax/);
  return setCookie.split(";", 1)[0];
}

test("gateway binds responses to its signed conversation cookie and renders ticketed audio", async () => {
  let boidsPayload;
  const fakeFetch = async (rawUrl, options = {}) => {
    const url = String(rawUrl);
    const method = options.method || "GET";
    if (url.endsWith("/conversations") && method === "POST") {
      return Response.json({ id: "conv_server_bound", object: "conversation" });
    }
    if (url.includes("/conversations/conv_server_bound/items")) {
      return Response.json({ object: "list", data: [], has_more: false });
    }
    if (url.endsWith("/responses")) {
      boidsPayload = JSON.parse(options.body);
      const sse = [
        'event: response.output_text.delta\ndata: {"delta":"Hello founder"}',
        'event: response.completed\ndata: {"type":"response.completed"}',
        "data: [DONE]",
      ].join("\n\n");
      return new Response(sse, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }
    if (url === "https://voice.example/tts") {
      const audio = Buffer.from("fake-mp3-audio").toString("base64");
      return new Response(`${JSON.stringify({ data: audio })}\n`, {
        status: 200,
      });
    }
    throw new Error(`Unexpected upstream request: ${method} ${url}`);
  };

  await withGateway(fakeFetch, async (baseUrl) => {
    const session = await fetch(`${baseUrl}/conversations`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(session.status, 200);
    const sessionBody = await session.json();
    assert.deepEqual(sessionBody, {
      created: true,
      needsBootstrap: true,
      truncated: false,
      messages: [],
    });
    const cookie = cookieFrom(session);

    const response = await fetch(`${baseUrl}/responses`, {
      method: "POST",
      headers: {
        Origin: origin,
        Cookie: cookie,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: "Hello",
        model: "attacker-model",
        conversation: "conv_attacker_supplied",
      }),
    });
    assert.equal(response.status, 200);
    const stream = await response.text();
    assert.match(stream, /event: creekstone\.tts\.ready/);
    assert.deepEqual(boidsPayload, {
      model: "agent:creekstone",
      input: "Hello",
      conversation: "conv_server_bound",
      stream: true,
    });

    const ticketMatch = stream.match(
      /event: creekstone\.tts\.ready\ndata: ({[^\n]+})/,
    );
    assert.ok(ticketMatch);
    const { ticket } = JSON.parse(ticketMatch[1]);

    const voice = await fetch(`${baseUrl}/tts`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ ticket }),
    });
    assert.equal(voice.status, 200);
    assert.equal(voice.headers.get("content-type"), "audio/mpeg");
    assert.equal(
      Buffer.from(await voice.arrayBuffer()).toString(),
      "fake-mp3-audio",
    );
  });
});

test("gateway restores history, hides only the internal Hi, and rotates New signal", async () => {
  let conversationNumber = 0;
  const deleted = [];
  const fakeFetch = async (rawUrl, options = {}) => {
    const url = String(rawUrl);
    const method = options.method || "GET";
    if (url.endsWith("/conversations") && method === "POST") {
      conversationNumber += 1;
      return Response.json({
        id: `conv_${conversationNumber}`,
        object: "conversation",
      });
    }
    if (url.includes("/conversations/conv_1/items")) {
      return Response.json({
        object: "list",
        has_more: false,
        data: [
          {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "A real later Hi" }],
          },
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "Welcome founder" }],
          },
          {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Hi" }],
          },
        ],
      });
    }
    if (url.endsWith("/conversations/conv_1") && method === "DELETE") {
      deleted.push("conv_1");
      return Response.json({ id: "conv_1", deleted: true });
    }
    throw new Error(`Unexpected upstream request: ${method} ${url}`);
  };

  await withGateway(fakeFetch, async (baseUrl) => {
    const created = await fetch(`${baseUrl}/conversations`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: "{}",
    });
    const cookie = cookieFrom(created);

    const restored = await fetch(`${baseUrl}/conversations`, {
      method: "POST",
      headers: {
        Origin: origin,
        Cookie: cookie,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    assert.equal(restored.status, 200);
    const restoredBody = await restored.json();
    assert.equal(restoredBody.created, false);
    assert.equal(restoredBody.needsBootstrap, false);
    assert.deepEqual(
      restoredBody.messages.map(({ role, content }) => ({ role, content })),
      [
        { role: "assistant", content: "Welcome founder" },
        { role: "user", content: "A real later Hi" },
      ],
    );
    assert.equal(typeof restoredBody.messages[0].ttsTicket, "string");

    const reset = await fetch(`${baseUrl}/conversations`, {
      method: "POST",
      headers: {
        Origin: origin,
        Cookie: cookie,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ reset: true }),
    });
    assert.equal(reset.status, 200);
    assert.deepEqual(deleted, ["conv_1"]);
    assert.equal((await reset.json()).created, true);
    assert.notEqual(cookieFrom(reset), cookie);
  });
});

test("gateway forces the hidden bootstrap prompt and refuses unsigned conversations", async () => {
  let boidsPayload;
  const fakeFetch = async (rawUrl, options = {}) => {
    const url = String(rawUrl);
    const method = options.method || "GET";
    if (url.endsWith("/conversations") && method === "POST") {
      return Response.json({ id: "conv_bootstrap", object: "conversation" });
    }
    if (url.includes("/conversations/conv_bootstrap/items")) {
      return Response.json({ object: "list", data: [], has_more: false });
    }
    if (url.endsWith("/responses")) {
      boidsPayload = JSON.parse(options.body);
      return new Response(
        'event: response.output_text.delta\ndata: {"delta":"Welcome"}\n\n' +
          'event: response.completed\ndata: {"type":"response.completed"}\n\n',
        { status: 200 },
      );
    }
    throw new Error(`Unexpected upstream request: ${method} ${url}`);
  };

  await withGateway(fakeFetch, async (baseUrl) => {
    const unsigned = await fetch(`${baseUrl}/responses`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ input: "Hello", conversation: "conv_stolen" }),
    });
    assert.equal(unsigned.status, 409);

    const created = await fetch(`${baseUrl}/conversations`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: "{}",
    });
    const cookie = cookieFrom(created);
    const bootstrap = await fetch(`${baseUrl}/responses`, {
      method: "POST",
      headers: {
        Origin: origin,
        Cookie: cookie,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ bootstrap: true, input: "attacker override" }),
    });
    assert.equal(bootstrap.status, 200);
    await bootstrap.text();
    assert.deepEqual(boidsPayload, {
      model: "agent:creekstone",
      input: "Hi",
      conversation: "conv_bootstrap",
      stream: true,
    });
  });
});

test("gateway rejects missing origins, unsupported methods, and unknown routes", async () => {
  await withGateway(
    async () => {
      throw new Error("Upstream must not be called");
    },
    async (baseUrl) => {
      const missingOrigin = await fetch(`${baseUrl}/responses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: "Hello" }),
      });
      assert.equal(missingOrigin.status, 403);

      const wrongMethod = await fetch(`${baseUrl}/responses`, {
        method: "GET",
      });
      assert.equal(wrongMethod.status, 405);

      const unknown = await fetch(`${baseUrl}/anything`, {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: "{}",
      });
      assert.equal(unknown.status, 404);
    },
  );
});
