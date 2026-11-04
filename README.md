# midtrans-kit

**CLI + MCP server for seamless [Midtrans](https://midtrans.com) payment integrations** — built for beginners and non-backend developers.

Midtrans has no official CLI, and existing community MCP servers are unmaintained. midtrans-kit distills hardened patterns from production Midtrans integrations into one toolkit you can run straight from GitHub with `npx`: create payments, check whether an order is safe to fulfill, test your webhook **locally without tunnels**, and scaffold a working integration in seconds.

> Note on "OAuth login": Midtrans does **not** offer OAuth — it only has per-environment API keys (server key + client key). `midtrans login` is the closest safe equivalent: it validates your keys live against Midtrans, then stores them locally in `~/.midtrans/config.toml` (chmod 600) with multi-merchant profile support.

## Install / run without installing

```bash
npx github:will702/midtrans-kit --help
```

Pin a specific release (recommended for CI and shared setups):

```bash
npx github:will702/midtrans-kit#v0.1.0 --help
```

Global install (provides both `midtrans` and `midtrans-kit` commands):

```bash
npm i -g github:will702/midtrans-kit
midtrans --version
```

## Quickstart (sandbox)

```bash
# 1. Save your sandbox keys (Midtrans Dashboard → Settings → Access Keys)
midtrans login
#    server key: SB-Mid-server-…

# 2. Create a payment and open it
midtrans snap:create --amount 10000 --item-name "Test" --open
#    → pay with card 4811 1111 1111 1114, CVV 123, OTP 112233

# 3. Check it
midtrans status KIT-MZABC123-ABCDEF1234
#    Fulfillment: PAID — safe to fulfill ✅

# 4. Diagnose your setup
midtrans doctor
```

## Commands

| Command | What it does |
|---|---|
| `midtrans login` | Validate keys live, store them in `~/.midtrans/config.toml` (multi-profile, 0600) |
| `midtrans whoami` / `profiles` / `use <name>` / `logout` | Manage profiles & see which credentials are active |
| `midtrans snap:create --amount 100000` | Create a Snap payment → token + payment link (`--open` opens it) |
| `midtrans status <order_id>` | Raw status **+ a safe-to-fulfill verdict** (paid/pending/failed/expired) |
| `midtrans approve / deny / cancel / expire <order_id>` | Transaction actions — production requires `--production` |
| `midtrans refund <order_id> [--amount] [--reason]` | Full/partial refund |
| `midtrans webhook:test` | Fire a **correctly-signed** fake notification at your local handler — no tunnels |
| `midtrans webhook:verify --file payload.json` | Verify a payload's signature locally (with gotcha explanations) |
| `midtrans init nextjs` / `midtrans init express` | Scaffold a complete, hardened integration |
| `midtrans doctor` | Key validity, sandbox/production consistency, optional webhook probe |
| `midtrans docs [topic]` | Offline reference: test cards, statuses, signature, retries, simulators |

### Webhook testing — the killer feature

Midtrans can only POST notifications to one public HTTPS URL per merchant, which makes local development painful. midtrans-kit solves it:

```bash
# Your dev server is running on localhost:3000
midtrans webhook:test --status settlement --url http://localhost:3000/api/payment/webhook
midtrans webhook:test --status expire      --url http://localhost:3000/api/payment/webhook
midtrans webhook:test --tamper            --url http://localhost:3000/api/payment/webhook
#                                                            ^ must be rejected (403) — or your handler is unsafe!
```

### Environment variables (alternative to login)

Same names your app code likely uses — env vars override the saved profile:

```
MIDTRANS_SERVER_KEY=SB-Mid-server-…
MIDTRANS_CLIENT_KEY=SB-Mid-client-…        # optional
MIDTRANS_IS_PRODUCTION=false
```

`midtrans doctor` catches the classic bug — a sandbox key paired with `IS_PRODUCTION=true` or a mismatched client key.

### Safety model

- Sandbox/production is **detected from the key prefix** (`SB-Mid-…` = sandbox)
- Money-changing commands against production require an explicit `--production` flag
- Keys are masked in all output; config file is chmod 600; nothing is ever logged

## MCP server (for AI coding agents)

One login serves both the CLI and the MCP server.

```bash
# Claude Code
claude mcp add midtrans -- npx github:will702/midtrans-kit mcp

# Cursor / ZCode / anything MCP — stdio command:
npx github:will702/midtrans-kit mcp
```

Tools: `create_snap_payment`, `get_transaction_status` (with fulfillment verdict), `approve/deny/cancel/expire/refund_transaction` (production-gated by `confirm: true`), `verify_webhook_signature`, `send_test_webhook_notification`, `search_midtrans_docs`.

So you can tell your agent: *"create a 25000 IDR sandbox payment and give me the link"* or *"send a settlement webhook to my local server and make sure it's accepted"*.

## Scaffolding

```bash
midtrans init nextjs    # App Router routes + snap.js button + env example
midtrans init express   # single-file express server, zero extra deps
```

Both templates bake in the rules learned from production integrations:

1. **Amounts resolve server-side** — the client sends an item id, never a price
2. **Register the order before creating the token** — webhooks always find a row
3. **Signature verified first** — `sha512(order_id + status_code + gross_amount + server_key)`, gross_amount hashed as the exact received string
4. **Idempotent settling** — Midtrans retries; nothing fulfills twice
5. **Status API reconciliation** — the webhook lagging never loses an order

## FAQ

**Does Midtrans have OAuth?** No — only API keys (verified against the official docs). Any tool claiming Midtrans "OAuth login" would be storing keys anyway; midtrans-kit does that honestly, with live validation.

**Sandbox vs production keys?** `SB-Mid-server-…` / `SB-Mid-client-…` are sandbox; `Mid-server-…` / `Mid-client-…` are production. Each environment has its own pair, generated for you, visible in the dashboard.

**Test cards?** `midtrans docs test-cards` — e.g. `4811 1111 1111 1114` (approve), `4911 1111 1111 1113` (deny), OTP `112233`.

## Roadmap

- Iris payouts, subscriptions/recurring, BI-SNAP asymmetric signatures
- More scaffolds (Remix, Nuxt, Laravel, Rails…)
- `midtrans watch` — live tail of notifications against local handlers

## Development

```bash
npm install
npm run build     # tsc → dist/
npm test          # node:test via tsx
```

Structure: `src/core` (framework-free Midtrans logic — shared by CLI, MCP, and templates), `src/cli` (commander commands), `src/mcp` (MCP server), `templates/` (scaffolds).

## License

MIT

---

**Not affiliated with Midtrans.** This is an independent community toolkit; Midtrans is a product of PT Midtrans. Official documentation: [docs.midtrans.com](https://docs.midtrans.com).
