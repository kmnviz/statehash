# statehash.io

> Anchor any JSON on Base. Get a verifiable link back.

Generic commitment-anchoring service. You POST a JSON payload, statehash.io:

1. Canonicalizes it (sorted keys at every object level, no extra whitespace).
2. Hashes the UTF-8 bytes with **keccak256**.
3. Submits a self-transaction on Base where `tx.data == commitment_hash`.
4. Returns the anchor record (id, commitment hash, tx hash, explorer URL).

Anyone holding the original JSON can later reproduce the hash and verify it
against what was written on-chain.

The service is schema-agnostic — any JSON value works as a `payload`. Smartbettors
is the first customer; the API is intentionally general so unrelated third parties
can use the same endpoints.

## Architecture

Same module layout as the other services under `smartbettors/` (closest cousin:
`sb-api`). The directory tree, winston logger, mongoose models, and zod env
schema all follow that pattern on purpose — switching repos should feel like
switching folders.

```
src/
├── app.ts                 # Express app assembly
├── index.ts               # process entrypoint
├── config/
│   ├── env.ts             # zod env schema
│   ├── database.ts        # mongoose connection lifecycle
│   └── chains.ts          # Base chain ids + explorer URLs
├── middleware/
│   ├── api-key-auth.ts
│   ├── error-handler.ts
│   ├── not-found.ts
│   └── request-logger.ts
├── models/
│   ├── anchor.model.ts        # mongoose schema for `anchors`
│   ├── agent.model.ts         # mongoose schema for `agents`
│   └── signing-key.model.ts   # encrypted keys for agent wallets
├── repositories/
│   ├── anchor.repository.ts
│   ├── agent.repository.ts
│   └── signing-key.repository.ts
├── routes/
│   ├── health.ts
│   └── v1/
│       ├── index.ts
│       ├── anchors.ts
│       └── agents.ts
├── services/
│   ├── logger.ts          # winston (Cloud Run severity mapping)
│   ├── canonical.ts       # canonicalJson + commitmentHash
│   ├── key-crypto.ts      # AES-256-GCM envelope for agent keys
│   ├── signer.ts          # back-compat shim (re-exports systemSigner)
│   ├── signer-pool.ts     # system + per-agent signer resolution
│   ├── chain-tx.ts        # self-tx submission, per-wallet nonce mutex
│   ├── anchor.service.ts  # create/read anchors
│   ├── agent.service.ts   # create/read agents + public view
│   └── api-key.ts         # STATEHASH_API_KEYS parser + lookup
└── types/
    ├── anchor.ts
    ├── agent.ts
    └── express.d.ts
public/
├── index.html             # marketing site (served at /)
├── docs.html              # API documentation (served at /docs)
├── css/site.css
└── assets/favicon.svg
scripts/
└── serve-site.js          # zero-dep static server for public/
```

## Local development

```bash
cp .env.example .env
# fill in STATEHASH_SIGNER_PRIVATE_KEY, STATEHASH_BASE_RPC_URL, MONGODB_URI, STATEHASH_API_KEYS
npm install
npm run build && npm start
# or:
npm run dev
```

Open `http://localhost:8080/` to see the landing page, or `/health` for status.

## Environment variables

| Name | Required | Notes |
|---|---|---|
| `PORT` | no | Defaults to `8080`. |
| `NODE_ENV` | no | `development` \| `production` \| `test`. |
| `LOG_LEVEL` | no | winston npm levels. Defaults to `info`. |
| `MONGODB_URI` | yes | Mongo connection URL. |
| `MONGODB_DB_NAME` | no | Defaults to `statehash`. |
| `STATEHASH_CHAIN_ID` | no | `8453` (Base mainnet, default) or `84532` (Base Sepolia). |
| `STATEHASH_BASE_RPC_URL` | yes | Base RPC endpoint. |
| `STATEHASH_SIGNER_PRIVATE_KEY` | yes | System wallet used when no `agent_id` is supplied. Keep in Secret Manager in prod. |
| `STATEHASH_MASTER_KEY` | yes | 32-byte AES-256-GCM key, base64. Envelope-encrypts per-agent signing keys at rest. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. |
| `STATEHASH_API_KEYS` | yes | Comma-separated `name:key:namespace` triples. |

## API (v1, sync mode)

All `/v1/*` endpoints require `X-Api-Key` (or `Authorization: Bearer <key>`).

### Anchor a JSON payload

```bash
curl -sS -X POST http://localhost:8080/v1/anchors \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: shk_dev_change_me" \
  -d '{
    "schema_version": 1,
    "payload": { "hello": "world", "nested": {"a": 1} },
    "external_ref": "doc:42"
  }'
```

Response (201):

```json
{
  "id": "anc_01HW...",
  "status": "confirmed",
  "namespace": "smartbettors",
  "external_ref": "doc:42",
  "schema_version": 1,
  "commitment_hash": "0x...",
  "chain_id": 8453,
  "tx_hash": "0x...",
  "block_number": 123456,
  "block_time": 1713260000,
  "explorer_url": "https://basescan.org/tx/0x...",
  "created_at": "2026-04-16T...",
  "confirmed_at": "2026-04-16T..."
}
```

Passing the same `external_ref` again returns the existing record (idempotent).

### Read by id

```bash
curl -sS http://localhost:8080/v1/anchors/anc_01HW... \
  -H "X-Api-Key: shk_dev_change_me"
```

### Read by caller's external ref

```bash
curl -sS "http://localhost:8080/v1/anchors/by-ref/doc:42" \
  -H "X-Api-Key: shk_dev_change_me"
```

### Agents (wallet-per-actor)

An agent is a named actor under your namespace with its own on-chain wallet.
Anchors signed from an agent's wallet are enumerable directly off-chain —
third parties can audit an agent's track record without hitting our API.

Provision an agent (auth):

```bash
curl -sS -X POST http://localhost:8080/v1/agents \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: shk_dev_change_me" \
  -d '{"display_name": "sniper-v7"}'
```

Anchor as an agent (auth):

```bash
curl -sS -X POST http://localhost:8080/v1/anchors \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: shk_dev_change_me" \
  -d '{
    "schema_version": 1,
    "agent_id": "agt_01KPD5CTRE7HR9W5PXN6MPWJ2R",
    "external_ref": "game-42",
    "payload": { "pick": "home" }
  }'
```

Public lookup — no API key required. This is the URL you give out so anyone
can verify an agent's history on-chain:

```bash
curl -sS http://localhost:8080/v1/agents/agt_01KPD5CTRE7HR9W5PXN6MPWJ2R
curl -sS http://localhost:8080/v1/agents/by-address/0xfe322ed9…b348cd
```

Response includes `address`, live `anchor_count`, `first_anchor_at`,
`last_anchor_at`, and `explorer_url` pointing at the agent's basescan page.

### Not yet implemented (Phase 3+)

- `POST /v1/verify` — recomputes the canonical hash of a payload and compares
  it to a stored anchor. Coming in Phase 3.
- `callback_url` / `callback_secret` on `POST /v1/anchors` — async mode with
  signed webhook. Coming in Phase 4. Sending these today returns `501`.

## Deployment

`deployment/deploy.sh` builds the amd64 image, pushes to Artifact Registry,
and deploys to Cloud Run with secrets bound from Secret Manager. Mirrors the
deployment pattern used by `sb-api` / `sb-anchor`.

## Tests

Intentionally none for now. We're proving the product first; tests come when
there is something worth protecting. The one guardrail that matters — that
`canonicalJson` + `commitmentHash` never drift from the pre-extraction
sb-anchor output — will be covered by a snapshot test the day we first see
a hash-drift bug, not before.
