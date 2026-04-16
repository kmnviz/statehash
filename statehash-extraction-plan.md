# statehash.io — Extraction Plan

## Goal

Extract the current `sb-anchor` service into a standalone product hosted at `statehash.io`: a generic "anchor any JSON on Base, get a verifiable link back" API. `sb-api` becomes a regular external client of `statehash.io` instead of `sb-anchor` reaching into it.

Not a company. Not open-source (yet). One service, one domain, its own repo. Smartbettors is the first customer and must keep working end-to-end; anything we build should also be usable by unrelated third parties.

## Operating principles

- **Start simple, improve later.** Always pick the smallest working design. Optimize, batch, and harden only when real usage demands it.
- **No tests until the product is proven.** We're building a promotion-facing API, not a library. Shipping and iterating on the real thing comes first; a test suite comes when there's something worth protecting.
- **Architecture and file structure follow `smartbettors/` (especially `sb-api`).** Same module layout (`app.ts` / `index.ts` split, `config/`, `middleware/`, `routes/`, `services/`, `repositories/`, `models/`, `types/`), same winston logger, same mongoose + zod + dotenv stack, same single-quoted 2-space style. An engineer moving between repos should not have to re-learn anything.
- **Website ships with v1.** `statehash.io` must be promotable the day it goes live. A static landing page served from the same Cloud Run service is non-optional.

## Why

- `sb-anchor` is the only horizontal piece in the smartbettors stack. Every other `sb-*` service is domain-specific; `sb-anchor` only happens to do its work on prediction rows because of how it was wired, not because the primitive is prediction-specific.
- The current data flow (`sb-anchor` reaches into `sb-api`) is backwards — an infra service shouldn't know the business schema of its caller. Inverting it cleans up both sides.
- The smartbettors brand is easier to position once the anchoring piece is out of the picture.
- Name (`statehash.io`) is already decided. Nothing to deliberate.

## Non-goals (explicitly out of scope)

- Multi-tenant billing, quotas, Stripe.
- A logged-in dashboard UI.
- Multi-chain (Base only, same as today).
- Merkle batching / IPFS mirroring.
- SDK releases (curl + fetch examples are enough).
- Rewriting the core primitives. `canonicalJson`, `commitmentHash` and the viem tx submission stay byte-for-byte the same.

## Architecture change, in one picture

**Today:**

```
Pub/Sub -> sb-anchor -> (pull prediction from sb-api) -> hash -> tx on Base -> (POST anchor back to sb-api)
```

**After:**

```
sb-api -> POST /v1/anchors (statehash.io) -> canonicalize + hash -> tx on Base -> stored in statehash DB
                                                                                  |
                                                                (optional) ------> webhook to caller
                                                                                  |
sb-api (verify) -> GET /v1/anchors/by-ref/:ref --------------------------------> -+
```

`statehash.io` owns its own MongoDB. `sb-api` only stores a pointer (the statehash anchor id or external ref) on the prediction row, plus a denormalized `tx_hash` / `chain_id` for display. Pub/Sub fanout of "prediction created" stays inside smartbettors; `sb-api` calls `statehash.io` directly (or from its own Pub/Sub subscriber).

## How the "event when hash is stored" should work

This is the most important design decision. Options considered and the recommendation:

| Pattern | Pros | Cons |
|---|---|---|
| **Sync-only** (current behavior: wait for tx receipt, return the full record) | Simplest. No background infra. Works for smartbettors today. | Holds HTTP connection ~1–3 s. Doesn't scale to slow chains or batch submissions. Third parties expect async. |
| **Async + webhook callback** (caller passes `callback_url`, gets `{ id, status: "pending" }` back, gets signed HTTP POST on confirmation) | Standard SaaS pattern (Stripe, Clerk, etc.). Third-party friendly. Survives long confirmations. | Needs a background worker + retry policy + signature scheme. More moving parts. |
| **Internal event bus** (Pub/Sub topic consumers subscribe to) | GCP-native, already in the stack, easy for smartbettors-side. | Useless to an external customer. Couples consumers to GCP IAM. |
| **Polling** (caller hits `GET /v1/anchors/:id` until `status=confirmed`) | Trivial. Always available. | Wastes requests; bad DX at scale. |

**Recommendation: hybrid — sync by default, webhook opt-in, polling always available.**

- **Default sync** — `POST /v1/anchors` without `callback_url` behaves exactly like today: waits for the tx receipt, returns the full record. Smartbettors keeps working with zero client-side async logic.
- **Async opt-in** — `POST /v1/anchors` with `callback_url` (HTTPS required) + optional `callback_secret` returns `{ id, status: "pending" }` immediately and fires a signed webhook on terminal state (`confirmed` or `failed`).
  - Signature header: `X-Statehash-Signature: t=<unix_ts>,v1=<hex_hmac_sha256(secret, "<ts>.<raw_body>")>`, same scheme Stripe uses. Prevents replay; does not require TLS client auth.
  - Retry policy: exponential backoff on non-2xx (1, 5, 30, 300, 1800 seconds), cap at 5 attempts, mark `webhook_status=failed` after.
- **Polling always available** — `GET /v1/anchors/:id` and `GET /v1/anchors/by-ref/:external_ref` are part of the public contract regardless.
- **Internal Pub/Sub event** — NOT in v1. Only add later if a second internal consumer actually needs it.

Implementation: for v1 the background worker can just be an in-process `setImmediate`/promise chain started by the HTTP handler when `callback_url` is set. Persist the intent (`webhook_url`, `webhook_status`, `webhook_attempts`) in Mongo so a worker can resume after a restart. A Cloud Tasks queue is nicer but not required for v1.

## Public API surface (`statehash.io`)

### `POST /v1/anchors`

Auth: `X-Api-Key` (required).

Request body:

```json
{
  "schema_version": 1,
  "payload": { "...arbitrary JSON, determined by caller..." },
  "external_ref": "prediction:507f1f77bcf86cd799439011",
  "namespace": "smartbettors",
  "callback_url": "https://example.com/hooks/statehash",
  "callback_secret": "whsec_...",
  "store_payload": true
}
```

- `schema_version` (number, required): caller-owned monotonically increasing integer. statehash does not parse it, only includes it inside the canonical payload so the hash is schema-aware.
- `payload` (object, required): arbitrary JSON. statehash canonicalizes it (sorted keys at every level) and hashes it with keccak256.
- `external_ref` (string, optional): caller's own id. Unique per `namespace`. Enables `GET /v1/anchors/by-ref/:ref`.
- `namespace` (string, optional): defaults to the API key's project name. Used to partition `external_ref` lookups across unrelated callers.
- `callback_url` (string, optional): if set, switches to async mode.
- `callback_secret` (string, optional): used to HMAC the webhook body. If absent but `callback_url` is set, statehash generates one on first request and returns it in the response — the caller must store it.
- `store_payload` (boolean, optional, default `true`): if `false`, the canonical payload is hashed but not persisted. `POST /v1/verify` then requires the caller to resubmit the payload.

Sync response (no `callback_url`):

```json
{
  "id": "anc_01HW...",
  "status": "confirmed",
  "commitment_hash": "0x...",
  "external_ref": "prediction:507f...",
  "namespace": "smartbettors",
  "schema_version": 1,
  "chain_id": 8453,
  "tx_hash": "0x...",
  "block_number": 123456,
  "block_time": 1713260000,
  "explorer_url": "https://basescan.org/tx/0x...",
  "created_at": "2026-04-16T...",
  "confirmed_at": "2026-04-16T..."
}
```

Async response (with `callback_url`): HTTP 202 with `{ id, status: "pending", external_ref, namespace, schema_version, callback_secret? }`.

### `GET /v1/anchors/:id` and `GET /v1/anchors/by-ref/:external_ref`

Returns the same record shape. `by-ref` accepts an optional `?namespace=` query param.

### `POST /v1/verify`

Body: `{ schema_version, payload, external_ref?, namespace? }`. Recomputes the canonical hash and compares it against a stored anchor.

Response: `{ matches: true|false, anchor?: <record>, recomputed_hash }`. If `store_payload=false` was used, this is the only way to verify.

### `GET /health`

Unchanged.

### Webhook payload (when `callback_url` is set)

HTTP `POST` to caller's URL, headers:

- `Content-Type: application/json`
- `X-Statehash-Signature: t=<ts>,v1=<hex_hmac>`
- `X-Statehash-Event: anchor.confirmed` (or `anchor.failed`)
- `X-Statehash-Delivery: <delivery_id>` (unique per attempt, for idempotency on caller side)

Body: the same record shape returned by `GET /v1/anchors/:id`.

## Auth

- Single env-configurable API key list per environment (`STATEHASH_API_KEYS`: comma-separated `name:key:namespace` triples). Smartbettors gets one entry; any future user gets another. No self-serve signup yet.
- Each key has an implicit default `namespace` so callers don't have to send it.

## Storage

MongoDB collection `anchors`:

- `_id` (statehash anchor id, e.g. `anc_<ulid>`)
- `namespace`, `external_ref` (compound unique index)
- `schema_version`
- `commitment_hash` (hex)
- `canonical_payload` (string, nullable if `store_payload=false`)
- `chain_id`, `tx_hash`, `block_number`, `block_time`
- `status` (`pending` | `confirmed` | `failed`)
- `error` (string, nullable)
- `webhook_url`, `webhook_secret_hash`, `webhook_status`, `webhook_attempts`, `webhook_last_response`
- `created_at`, `updated_at`, `confirmed_at`

## Signer

One single system wallet per environment (`STATEHASH_SIGNER_PRIVATE_KEY`), self-tx pattern (`to: signer`, `data: hash`). Keep it simple; the hash is what verifies, not the signer.

## Phases

### Phase 0 — Preconditions

- Confirm, by inspection, that the `canonicalJson` + `commitmentHash` implementation we're carrying over is byte-identical to `sb-anchor`'s. No automated test for this yet (per the "no tests until proven" principle) — visually diff the function bodies, and if we ever find drift in production, that's when the snapshot test earns its place.
- Register `statehash.io`, point DNS to Cloud Run later.
- Create an empty `statehash-io` GitHub repo.

### Phase 1 — Bootstrap the repo in the sb-api shape

- Port `canonicalJson` + `commitmentHash` from `sb-anchor` into `src/services/canonical.ts` (byte-identical implementation — that's the one thing that must never drift).
- Rename env vars to `STATEHASH_*` (`STATEHASH_CHAIN_ID`, `STATEHASH_BASE_RPC_URL`, `STATEHASH_SIGNER_PRIVATE_KEY`, `STATEHASH_API_KEYS`) and reuse `MONGODB_URI` + `MONGODB_DB_NAME` names to match the rest of `smartbettors/`.
- Match `sb-api`'s module layout exactly:
  - `src/app.ts` — Express app assembly (cors, json, request logger, routes, error handler).
  - `src/index.ts` — process entrypoint (startServer, SIGTERM/SIGINT shutdown).
  - `src/config/{env,database,chains}.ts` — zod env, mongoose connect lifecycle, chain constants.
  - `src/services/logger.ts` — winston logger with Cloud Run `severity` mapping (shared with `sb-agent`).
  - `src/services/{canonical,signer}.ts` — commitment primitives and single system signer.
  - `src/middleware/{api-key-auth,error-handler,not-found,request-logger}.ts`.
  - `src/models/anchor.model.ts` — mongoose schema with `(namespace, externalRef)` partial-unique index.
  - `src/repositories/anchor.repository.ts`.
  - `src/types/{anchor,express.d.ts}`.
- Single signer (`STATEHASH_SIGNER_PRIVATE_KEY`) — no per-agent map. The hash is what verifies, not the signer.
- Drop all sb-api coupling (`sb-client.ts`, `/pubsub/predictions-created`, predictions-specific payload builders).

**Exit criteria:** repo builds, starts, answers `/health`, has no compile-time or runtime reference to `sb-api` or predictions, uses the same winston logger and file layout as the other `sb-*` services.

### Phase 2 — Generic payload pipeline (MVP) + public landing page

- mongoose-backed `anchors` collection with the indexes above (partial-unique on `(namespace, externalRef)`, secondary on `commitmentHash` / `txHash` / `status+updatedAt`).
- API-key middleware reading `STATEHASH_API_KEYS` (comma-separated `name:key:namespace` triples). Accepts `X-Api-Key` or `Authorization: Bearer`. Attaches `req.apiKey` for downstream handlers.
- `POST /v1/anchors` in **sync mode only**: validate auth, validate `schema_version` is a number, canonicalize + hash an **arbitrary JSON payload** (no schema baked into the service), submit the self-tx, persist, return the record. Idempotent on `(namespace, externalRef)`.
- `GET /v1/anchors/:id` and `GET /v1/anchors/by-ref/:externalRef` with namespace-ownership checks.
- **Public website** at `/`: single static HTML + CSS under `public/`, served by `express.static` from the same Cloud Run service. One-paragraph pitch, one curl example, contact link. Good enough to share on day one.
- Deploy to Cloud Run on Base Sepolia; smoke test with curl; deploy mainnet.

**Exit criteria:** a stranger landing on `statehash.io` sees what the product is and a working curl example. A developer holding an API key can `POST /v1/anchors` with any JSON payload and get back `{ id, commitment_hash, tx_hash, explorer_url }`. Smartbettors could already integrate against this in sync mode.

### Phase 3 — Verification endpoint

- Implement `POST /v1/verify`: recompute canonical hash, compare against stored record, return `{ matches, anchor? }`.
- Support both lookup modes (by `external_ref` and by recomputed `commitment_hash`).
- Tests: matching payload → `matches: true`; tampered payload → `matches: false`; unknown payload → `matches: false, anchor: null`.

**Exit criteria:** any third party can cryptographically verify that a payload they hold matches what was anchored on chain, using only statehash's public API.

### Phase 4 — Async + webhook notifications

- Extend `POST /v1/anchors` to accept `callback_url` and `callback_secret`.
- If set, return 202 immediately, submit tx in a background task, POST signed JSON to `callback_url` on terminal state.
- HMAC signing scheme as specified above.
- Retry policy: exponential backoff (1 s, 5 s, 30 s, 5 min, 30 min), max 5 attempts, persist `webhook_status`.
- Add `GET /v1/anchors/:id/deliveries` (list webhook attempts) — useful for debugging third-party integrations.

**Exit criteria:** an external caller can register a callback URL, get an immediate `pending` response, and receive a verified webhook on confirmation. Signature verification is documented with a copy-paste snippet.

### Phase 5 — Docs buildout

A stub landing page ships in Phase 2. This phase fleshes out the developer-facing docs:

- Expand the static site at `/` into a proper marketing page (diagram of the anchoring flow, link to a sample confirmed tx on Basescan, short FAQ on canonicalization / PII / cost).
- Docs page at `statehash.io/docs`: quickstart, full API reference (all endpoints from Phase 2–4), webhook signature verification snippet in Node.js and Python, canonicalization spec (sorted keys, no whitespace, keccak256 of UTF-8 bytes), example anchored payload with real on-chain tx link.
- Publish an OpenAPI 3.1 spec at `statehash.io/openapi.json` (auto-generate from zod schemas if convenient, or hand-write — it's ~4 endpoints).
- No logged-in pages. No signup form. "Contact us for an API key" for now.

**Exit criteria:** a developer who has never heard of statehash can land on the site, read the docs, and successfully anchor + verify a JSON payload in under 10 minutes using only the public API.

### Phase 6 — Smartbettors cut-over

- In `sb-api`, add a `StateHashClient` (thin fetch wrapper around the 4 public endpoints, env-configured with `STATEHASH_URL` + `STATEHASH_API_KEY`).
- Move `buildCommitmentPayloadV1` (schema v1 = prediction shape) into `sb-api` so sb-api builds its own canonical payload. Field names/types must be identical to today so historical hashes stay reproducible.
- Replace the old "publish to Pub/Sub topic consumed by sb-anchor" flow: sb-api calls `statehash.create(...)` directly, either synchronously in the request that creates the prediction, or from its own Pub/Sub subscriber.
- Update `GET /predictions/:id/anchor` in `sb-api` to read from the local denormalized fields (`tx_hash`, `chain_id`, `commitment_hash`, `statehash_anchor_id`) cached at write time.
- Backfill: one-off script that reads existing `prediction.anchor*` fields from sb-api and imports them into statehash's `anchors` collection as pre-confirmed records (no new tx submitted — seed the lookup only). Mark rows with `imported: true` so verify responses can surface that.
- Delete `sb-anchor` from deployment. Archive the repo.

**Exit criteria:** `sb-anchor` is gone. `sb-api` talks to `statehash.io` as an external service. Verifying any old or new smartbettors prediction goes through the public statehash API and returns a match.

### Phase 7 — Deferred hardening (not part of the extraction)

Revisit once there's a second real user or smartbettors has scale:

- Multi-tenant project model with self-serve key creation.
- Merkle batching to amortize gas per anchor.
- Trust badge (iframe / script tag) for embedding verification on third-party pages.
- Cloud Tasks or Pub/Sub-backed background worker (replace the in-process webhook dispatcher).
- SDKs (TypeScript first, then Python).
- Multi-chain (Optimism, Arbitrum).
- Per-wallet nonce queue + multi-signer rotation.
- Full `robustness-roadmap.md` checklist.

## Risks / things to watch

- **Canonical hash drift.** The product hinges on `canonicalJson` + `commitmentHash` being byte-identical to today. The Phase 0 snapshot test is the guardrail — do not change those files during Phase 1.
- **Signer address change.** New single signer has a different address than historical agent wallets. The hash still verifies; any UI that displays "signed by <agent>" needs to read that from the canonical payload, not from `tx.from`.
- **PII in payloads.** Anchoring is immutable. The docs must state: callers MUST NOT submit PII inside `payload`. `store_payload=false` is provided for cases where the hash is useful but the payload should not be retained.
- **Webhook DoS.** A misbehaving caller's `callback_url` (slow, 500, infinite redirect) must not stall the worker. 10 s timeout per attempt, hard cap on retries, circuit-break if a URL fails repeatedly.
- **Nonce serialization.** One signer wallet + Cloud Run's concurrency = nonce collisions under load. Either serialize tx submission with a mutex (simple) or add a per-signer queue (better). Either is fine for smartbettors volume; both are cheap to add.
- **Backfill correctness.** If the hash of an imported historical record doesn't match what's onchain, the verify endpoint will lie. Recompute from the stored prediction fields and assert equality during import; reject mismatches.

## Open questions (resolve before Phase 2)

- Which Mongo deployment? New DB in the existing cluster, or a separate cluster? Answer: new DB in existing cluster for v1.
- Does the landing page live on Cloud Run (same service, extra routes) or on GCS + Cloud CDN? Answer: same Cloud Run service, `/` serves a static HTML; keeps DNS trivial.
- Do we want rate limiting at the edge (Cloud Armor / Cloudflare) from day one? Answer: not for v1; rely on API keys. Add before any public signup.
