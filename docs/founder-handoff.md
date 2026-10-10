# Founder handoff confirmation card

The manual **我想约真人李一豪聊聊** entry opens one inline review card in
the existing transcript. Opening it, editing fields or saving a draft is not
consent. Only the browser's **确认转交** action confirms a specific saved
revision; it does not book a meeting or mean a human has accepted the request.

## Release boundary

This website release ships with all three flags below false. It does not
deploy an Agent prompt, Skill or sandbox image. A disabled card explains that
the service is not open, and neither saves nor sends its contents. Chat remains
available. Do not enable production writes until the prerequisites below are
verified; a successful local fixture test is not proof of production isolation.

```dotenv
HANDOFF_ENABLED=false
HANDOFF_SUBMIT_ENABLED=false
HANDOFF_WRITE_ISOLATION_VERIFIED=false
HANDOFF_HOST_COMMAND=/opt/creekstone-handoff/bin/creekstone-handoff-host
HANDOFF_HOST_ENV_FILE=/etc/creekstone-handoff.env
```

The Agent tool route remains unconditionally unavailable (503), including when
the three browser-service flags are enabled. Boids must first supply a trusted,
short-lived conversation-bound capability. A global bearer token plus a
model-provided conversation ID is not an acceptable replacement. No proactive
invitations or automatic extraction of a card from assistant prose are included.

## Consent and recovery

1. The founder supplies a summary and, when ready, contact details. Optional
   name and project fields are also visible. The Agent cannot confirm for them.
2. Saving creates a draft or updates its expected revision. An edit invalidates
   previous consent; changed fields must be saved and checked again.
3. **确认转交** posts only the draft ID, revision, action and one-card nonce.
   The gateway records the decision, then asks the host to submit its stored
   snapshot. Caller-supplied content, consent flags and submission keys are
   forbidden on this route.
4. **暂不转交** records a deferral, never a submission. In-flight and uncertain
   submissions cannot be edited or described as cancelled.
5. A lost response shows an uncertain state, not a fabricated success or
   failure. **同步转交状态**, reload and focus restoration query the durable
   host ledger. No automatic submit retry or new submission key is created.
6. A successful card displays only a validated `ext_<64 lowercase hex>` or
   legacy `rec...` receipt, plus the honest `notified:false` state. Submitted
   means queued for review, not an accepted invitation or arranged meeting.

Each conversation has one handoff. The disclosed payload is the card's summary,
contact and optional names, plus system conversation/submission identifiers,
source and submission time. Full chat and attachments are not copied. Contact
details are never guessed. The fixed purpose must match the reviewed host v1
contract; the card renders the validated host purpose.

## Browser/gateway contract

All operations use same-origin POST, JSON and the existing signed HttpOnly
conversation cookie. Origin and the opaque `sessionKey` must match the active
cookie. Raw conversation IDs and identities are never taken from the body.
The server derives a stable conversation principal with
`HMAC-SHA256(signingSecret, "handoff-principal" + NUL + conversationId)`; this is
session ownership, not proof of a verified person.

| Route | Body in addition to sessionKey | Effect |
| --- | --- | --- |
| `/api/agent/handoff/prepare` | `content`; optionally `draft_id`, `revision` | Create/update a draft, no Workspace access |
| `/api/agent/handoff/decision` | `draft_id`, `revision`, `action`, `confirmation_nonce` | Confirm then submit exact snapshot, or defer |
| `/api/agent/handoff/status` | Optional `draft_id` | Restore owned state; uncertain writes reconcile read-only |
| `/api/agent/handoff/tool` | Not provisioned | Always 503; no client/model identity accepted |

Unknown/duplicate keys, oversized JSON (16 KiB), excessive nesting, stale
versions, forged cookies and cross-session drafts fail closed. Gateway request
budgets, an in-process mutation lock and four-child concurrency cap complement
the host's persistent cross-process SQLite lock. Provider errors/stdout/stderr,
keys and form content are not written to request logs.

## Private host bridge

The separately released Python package `creekstone-founder-handoff-runtime`
version **0.3.0** provides `creekstone-handoff-host` and protocol v1. Its
`HOST-CONTRACT.md` is authoritative for the host's state machine. This website
invokes an absolute executable with `shell:false`, no arguments, one JSON stdin
request and a bounded JSON stdout response. It never shells/sources an envfile.
Only allowlisted private child variables are passed, not gateway/Boids keys.
The 180-second child deadline yields an unknown outcome that requires status.

Install the reviewed wheel in a host-only Python environment at
`/opt/creekstone-handoff`, owned by root and not writable or reachable from the
Agent sandbox. Installing an unconfigured executable does not enable submission.
Provision a separate root-owned envfile, group-readable only by
`creekstone-gateway` (0640):

```dotenv
CREEKSTONE_HANDOFF_WORKSPACE_URL=<authorized Workspace endpoint>
CREEKSTONE_HANDOFF_WORKSPACE_API_KEY=<host-only least-privilege key>
CREEKSTONE_HANDOFF_LEDGER_PATH=/var/lib/creekstone-handoff/ledger.sqlite
CREEKSTONE_HANDOFF_CONFIRMATION_TTL_SECONDS=86400
```

Do not store these values in Git, a `NEXT_PUBLIC_` variable, website `.env.local`,
an Agent Skill, a command argument or browser code. The deployment's systemd
`StateDirectory=creekstone-handoff` gives the service a private 0700 persistent
directory while preserving `ProtectSystem=strict`. Its SQLite ledger contains
plaintext summary/contact, so provision restricted backups and retention before
activation. TTL expires consent; it is not automatic data deletion. Do not use
NFS or multiple independent host replicas. Symlinked ledger parents are rejected.

Before enabling any real submission:

- Revoke/rotate the old Agent sandbox Writer keys, and remove all alternative
  external-Agent Intake writes and direct CLI fallbacks; obtain evidence.
- Coordinate deployment of the matching runtime, Prompt and Skill; handle old
  in-flight submissions separately, without automatically migrating/replaying
  them into new cards.
- Provision the private host credential/ledger and establish retention/backups.
- Pass negative consent, foreign-session, stale-revision, concurrency and
  interrupted-result tests. Check disabled behavior independently.
- A browser-only manual flow can be enabled independently of Agent tools after
  those requirements. Keep `/tool` disabled until trusted session injection is
  implemented and tested. Never use real founder leads as production smoke tests.

## Local checks

```bash
npm run gateway:test
npm run agent:test
npm run lint
npm run typecheck
npm run build
QA_PORT=3101 QA_HANDOFF=1 node scripts/agent-qa-server.mjs
```

This QA flag uses only in-memory synthetic drafts and a fake host, never a real
Workspace or provider. Omitting it tests the production-default disabled card.
For the real Python subprocess/SQLite path with a loopback fake Workspace:

```bash
node scripts/handoff-host-smoke.mjs /absolute/qa-venv/bin/creekstone-handoff-host
```

The smoke script supplies a synthetic key, does not load project credentials,
and verifies zero unconfirmed Workspace access, stale/foreign rejection,
concurrent idempotency, committed writes with `view_error`, and recovery after
losing the submit reply. Its private temporary ledger contains synthetic data
only; canonical paths avoid macOS `/var` and `/tmp` symlinks.

Production verification for this disabled release is health/config/static
asset inspection only. No conversation or lead is created to test it.
