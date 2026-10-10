import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const deploy = readFileSync(new URL("../deploy.sh", import.meta.url), "utf8");

test("root lock retains cross-platform optional native-build dependencies", () => {
  const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
  for (const name of ["@emnapi/core", "@emnapi/runtime"]) {
    assert.ok(lock.packages[`node_modules/${name}`], `${name} must remain available to Linux npm ci`);
  }
});

test("deployment installs the isolated, pinned live-voice runtime before service activation", () => {
  const manifest = JSON.parse(readFileSync(new URL("package.json", import.meta.url), "utf8"));
  const lock = JSON.parse(readFileSync(new URL("package-lock.json", import.meta.url), "utf8"));
  assert.equal(manifest.dependencies.ws, lock.packages["node_modules/ws"].version);
  assert.match(deploy, /for module in core server attachments live-voice/);
  assert.match(deploy, /npm ci --prefix "\$GATEWAY_ROOT" --omit=dev --ignore-scripts/);
  assert.ok(deploy.indexOf("runuser -u") < deploy.indexOf("systemctl restart"));
});

test("deployment keeps text and audio streams independently admitted and unbuffered", () => {
  const stream = deploy.match(/location = \/api\/agent\/voice\/stream \{([\s\S]*?)\n\}/)?.[1];
  const cancel = deploy.match(/location ~ \^\/api\/agent\/voice\/\(cancel\|interrupt\)\$ \{([\s\S]*?)\n\}/)?.[1];
  assert.ok(stream && cancel);
  assert.match(stream, /limit_conn creekstone_voice_connections 2/);
  assert.match(stream, /proxy_buffering off/);
  assert.match(stream, /gzip off/);
  assert.match(stream, /proxy_read_timeout 345s/);
  for (const block of [stream, cancel]) {
    assert.match(block, /limit_except POST/);
    assert.match(block, /proxy_set_header Origin \$http_origin/);
    assert.match(block, /limit_req_status 429/);
  }
  assert.doesNotMatch(cancel, /limit_conn /);
  assert.match(cancel, /proxy_read_timeout 50s/);
  assert.match(cancel, /rewrite \^\/api\/agent/);
});

test("handoff deploy installs private adapter and defaults to closed writes/tools", () => {
  assert.match(deploy, /for module in .* handoff handoff-host;/);
  assert.match(deploy, /lib\/handoff\.mjs/);
  assert.match(deploy, /HANDOFF_WRITE_ISOLATION_VERIFIED/);
  assert.match(deploy, /HANDOFF_LEGACY_WRITER_RISK_ACCEPTED="\$\{HANDOFF_LEGACY_WRITER_RISK_ACCEPTED:-false\}"/);
  const handoffEnvLoops = deploy.match(/for name in [^\n]*HANDOFF_LEGACY_WRITER_RISK_ACCEPTED[^\n]*; do/g);
  assert.equal(handoffEnvLoops?.length, 2, "Risk acceptance must survive the read and write deployment steps");
  assert.match(deploy, /StateDirectory=creekstone-handoff/);
  const tool = deploy.match(/location = \/api\/agent\/handoff\/tool \{([\s\S]*?)\n\}/)?.[1];
  assert.match(tool, /return 503/); assert.doesNotMatch(tool, /proxy_pass/);
  const env = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
  for (const key of ["HANDOFF_ENABLED", "HANDOFF_SUBMIT_ENABLED", "HANDOFF_WRITE_ISOLATION_VERIFIED", "HANDOFF_LEGACY_WRITER_RISK_ACCEPTED"]) assert.match(env, new RegExp(`${key}=false`));
  assert.doesNotMatch(deploy, /CREEKSTONE_HANDOFF_WORKSPACE_API_KEY/);
});
