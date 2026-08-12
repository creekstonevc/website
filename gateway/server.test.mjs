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

test("gateway forces the model, emits a signed TTS ticket, and renders ticketed audio", async () => {
  let boidsPayload;
  const fakeFetch = async (url, options) => {
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
      return new Response(`${JSON.stringify({ data: audio })}\n`, { status: 200 });
    }
    throw new Error(`Unexpected upstream URL: ${url}`);
  };

  await withGateway(fakeFetch, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/responses`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ input: "Hello", model: "attacker-model" }),
    });
    assert.equal(response.status, 200);
    const stream = await response.text();
    assert.match(stream, /event: creekstone\.tts\.ready/);
    assert.deepEqual(boidsPayload, {
      model: "agent:creekstone",
      input: "Hello",
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
    assert.equal(Buffer.from(await voice.arrayBuffer()).toString(), "fake-mp3-audio");

    const tampered = await fetch(`${baseUrl}/tts`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ ticket: `${ticket}x` }),
    });
    assert.equal(tampered.status, 403);
  });
});

test("gateway rejects missing origins, unsupported methods, and unknown routes", async () => {
  await withGateway(async () => {
    throw new Error("Upstream must not be called");
  }, async (baseUrl) => {
    const missingOrigin = await fetch(`${baseUrl}/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "Hello" }),
    });
    assert.equal(missingOrigin.status, 403);

    const wrongMethod = await fetch(`${baseUrl}/responses`, { method: "GET" });
    assert.equal(wrongMethod.status, 405);

    const unknown = await fetch(`${baseUrl}/anything`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(unknown.status, 404);
  });
});
