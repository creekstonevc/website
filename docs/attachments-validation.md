# Attachment validation — 2026-09-17

Scope: local website and Gateway development. No commit/push, deployment,
production service restart, live Agent turn, Agent configuration change or
production Workspace file write was performed during this implementation.

## Automated checks

| Check | Result |
| --- | --- |
| `npm run gateway:test` | 43 passing tests, including 24 attachment cases |
| `npm run agent:test` | 18 passing tests, including 9 attachment cases |
| `npm run lint` | Pass, zero warnings |
| `npm run typecheck` | Pass |
| `npm run build` | Pass, static Next.js export including `/agent/` |
| `bash -n deploy.sh` | Pass; script was not executed |
| `git diff --check` | Pass |
| Frontend output scan for the provided website key | Not present in `out/` |
| Private local environment file | Git-ignored, mode `600` |

The Node client-test runner retains an existing informational
`MODULE_TYPELESS_PACKAGE_JSON` warning. This is not an ESLint warning or test
failure; package module semantics were not changed for this feature.

The mocked integration covers upload, verified Responses metadata, simulated
external CLI writeback, reply parsing, authorized binary download and history
restoration. Negative tests include missing configuration, malformed bodies,
Unicode/spaces, same-name uploads, file/count/aggregate limits, empty files,
noncanonical Base64, invalid filenames, credential expiry/tampering,
cross-session paths, traversal and encoded traversal, raw path injection,
concurrency/rate budgets, Workspace permission failures, timeout/network errors,
missing/oversized downloads, incomplete streams and unfinished history items.
The inline-reference update also tests every split inside `{{attachment://…}}`,
prose before/after references, duplicate references, mount-alias normalization,
malformed markers, legacy fences, and unchanged session ownership enforcement.

## Browser checks (local mock only)

Tested with the in-app browser at desktop 1280×720 and mobile 390×844:

- Chinese/space filename selected through the actual file picker.
- Upload status transitions from pending to **Uploaded · ready to send**.
- Uploading and failed drafts prevent silently sending without those files.
- Removing a failed file restores ordinary text sending.
- Ready attachment drafts survive refresh without uploading again.
- Attachment-only message produces a mock downloadable artifact.
- Clicking Download saves the expected mock file; its bytes were compared to the
  fixture. The browser automation download-event listener did not notify, but
  the downloaded file itself was confirmed in Downloads.
- Refresh restores both input and output attachment rows without exposing the
  internal input manifest in message text.
- Switching sessions during a slow upload does not attach the file to the new
  session. Returning shows the old unconfirmed upload with recovery guidance.
- An interrupted artifact reply creates no download button and offers the
  existing history-sync recovery instead of auto-resending.
- No horizontal viewport overflow at either tested size.

These checks do not emulate every mobile OS/native keyboard or verify every
browser download implementation. The binary download route is independently
covered by HTTP tests (body, ownership, Content-Disposition, MIME, nosniff, CSP).

### Inline reference / file-card follow-up

Verified the updated interface at 1280×800 and 390×844, using the same local
mock only. An actual Chinese/space-named file upload produced both the input
card and an Agent output card from the new inline reference format. Cards use
the existing gold/black palette, document glyph, extension, readable filename,
status, and a 44px download target (icon-only on phones with an accessible name).
Refresh restored both cards without raw `attachment://` or mount paths. No
horizontal overflow or browser console errors were observed. A download click
showed **Download requested**, and the downloaded 96-byte mock file matched the
fixture. An incomplete inline-reference reply displayed no download card and
retained the existing **Sync history** recovery. No production calls occurred.

## Visual review

Impeccable was used to preserve the existing black/gold chat while extending it
with inline file rows, bounded draft lists and explicit status/error controls.
An independent finish reviewer examined desktop, mobile and mobile-error
captures plus the changed UI sources.

| Review | Disposition | Open material fixes |
| --- | --- | --- |
| Initial attachment UI, existing-world extension (prior independent review) | **ship** | None |

The later inline-reference card refinement was checked by the implementing
agent at both viewport sizes; the prior independent review is not represented
as a new independent review of that follow-up.

The design detector reported design-system color/type-size advisory findings,
including incumbent values. Its output was truncated; this is not a claim that
the entire site's design detector is clean. No unrelated style-system rewrite
was made.

## Real service check and remaining integration

A **read-only** Workspace `command: status` using the provided website key
returned HTTP 200, `ok:true`, `reachable:true`, with read on the attachment root
and create/overwrite on `attachments/inputs/**`. No actual file was read or
written during that check. The Agent key was not placed in the website.

Still required before announcing the feature live:

1. Add the protocol section from `agent-attachments.md` to the external Agent's
   existing Skill and provision/confirm its separate key in its existing CLI.
2. Merge the website Workspace configuration into the production environment
   alongside the existing Boids, BytePlus and signing-secret settings.
3. Obtain release authorization, then deploy and perform an explicitly approved
   end-to-end live small-file test. No production publish occurred here.
4. Decide attachment retention/storage quotas and whether Agent-side cross-user
   isolation must be strengthened. The current broad Agent key and no-cleanup
   policy remain documented limitations, not resolved security guarantees.
