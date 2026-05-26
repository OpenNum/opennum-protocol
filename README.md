# OpenNum Protocol

[![License: MIT](https://img.shields.io/badge/License-MIT-orange.svg)](LICENSE)
[![Website](https://img.shields.io/badge/website-opennum.org-orange)](https://opennum.org)
[![Twitter Follow](https://img.shields.io/twitter/follow/OpenNumBTC?style=social)](https://twitter.com/OpenNumBTC)

OpenNum is an application-layer identity protocol for Bitcoin Ordinals. It maps an inscription number to a wallet address with an off-chain signature, so wallets and apps can resolve a human-readable number before sending BTC or inscriptions.

```
Before OpenNum:
Send to: bc1p8dqa4wjvnt890qmfws83te2v3rxd7zr5uu6vsrk8kqnf3cgwwuqszc3qa5

With OpenNum:
Send to: #2311
```

No smart contracts. No sidechain. No on-chain registration transaction. Just Bitcoin ownership, a signed message, and an open resolver.

## Current Status

OpenNum is in Phase 2 alpha.

| Surface | Status |
|---------|--------|
| Website | Live at [opennum.org](https://opennum.org) |
| Register | Live alpha, Unisat Wallet only |
| Resolver API | Live |
| Explorer | Live, backed by `/api/list` |
| Market | Live discovery page, external marketplace links only |
| Guestbook | Public wallet-signed messages |
| SDK | Planned |
| AI agent extension | Spec direction, not the default live registration flow yet |

## API Quickstart

Full API reference: [docs/api.md](docs/api.md)

### Resolve a number

```bash
curl "https://opennum.org/api/resolve?num=2311"
```

Compatibility alias:

```bash
curl "https://opennum.org/api/v1/resolve/2311"
```

Example response:

```json
{
  "inscription_num": 2311,
  "wallet": "bc1p...",
  "status": "active",
  "display_name": null,
  "registered_at": "2026-05-24T05:27:11.426215+00:00"
}
```

### List active registrations

```bash
curl "https://opennum.org/api/list?sort=number&order=asc&limit=50"
```

Example response:

```json
{
  "total": 2,
  "offset": 0,
  "limit": 50,
  "registrations": [
    {
      "inscription_num": 2311,
      "inscription_id": "64-character-hex-txidi0",
      "inscription_txid": "64-character-hex-txid",
      "wallet": "bc1p...",
      "status": "active",
      "display_name": null,
      "registered_at": "2026-05-24T05:27:11.426215+00:00"
    }
  ]
}
```

### Fetch profile metadata

```bash
curl "https://opennum.org/api/profile?num=2311"
```

Compatibility alias:

```bash
curl "https://opennum.org/api/v1/profile/2311"
```

### Register a number

```http
POST /api/register
Content-Type: application/json
```

```json
{
  "inscription_num": 2311,
  "inscription_txid": "64-character-hex-txid",
  "inscription_id": "64-character-hex-txidi0",
  "wallet": "bc1p...",
  "signature": "BIP322 signature",
  "timestamp": 1779744378,
  "display_name": "optional display name"
}
```

The signed message is:

```text
opennum:register:<inscription_num>:<wallet>:<timestamp>
```

The hosted registration page currently uses Unisat Wallet to list inscriptions, sign the message, and submit the API request.

### Guestbook messages

```bash
curl "https://opennum.org/api/guestbook?num=2311"
```

Public messages are signed by the author's wallet with:

```text
opennum:guestbook:<inscription_num>:<author_wallet>:<message>:<timestamp>
```

## Protocol Model

OpenNum uses two anchors:

| Anchor | Purpose |
|--------|---------|
| `inscription_num` | Human-readable identity number, such as `#2311` |
| `inscription_txid` | Bitcoin consensus coordinate for the inscription |

The resolver verifies that the registering wallet controls the inscription, validates the signed message, then stores a public mapping from inscription number to wallet address.

## Identity States

| State | Meaning |
|-------|---------|
| Active | Valid registration; wallet currently controls the inscription |
| Dormant | Inscription moved; new holder has not re-registered |
| Cooling | Recent transfer window, reserved for transfer-handling policy |
| Flagged | Dispute or special review state, indexer-specific |

## Repository Structure

```
opennum-protocol/
├── api/                    # Vercel serverless resolver/register endpoints
├── public/                 # Static website, Explorer, Register, profile UI
├── protocol-spec/          # Protocol specification
├── docs/                   # Roadmap and FAQ
├── whitepaper/             # Whitepaper source/export files
├── README.md
├── LICENSE
└── vercel.json
```

## Local Development

```bash
npm install
npx vercel dev
```

Required environment variables:

```bash
SUPABASE_URL=
SUPABASE_ANON_KEY=
```

## Roadmap

1. Stabilize the hosted resolver and registration flow.
2. Publish a minimal integration guide for wallets and Ordinals apps.
3. Stabilize profile social surfaces: inscription avatar, guestbook, and external marketplace discovery.
4. Ship a small JS/TS resolver SDK.
5. Extend the protocol for AI agent delegation after the base resolver is reliable.

## Links

- Website: [opennum.org](https://opennum.org)
- Explorer: [opennum.org/explore](https://opennum.org/explore)
- Market: [opennum.org/market](https://opennum.org/market)
- Register: [opennum.org/register](https://opennum.org/register)
- Whitepaper EN: [opennum.org/whitepaper-en](https://opennum.org/whitepaper-en)
- Whitepaper CN: [opennum.org/whitepaper-cn](https://opennum.org/whitepaper-cn)
- X/Twitter: [@OpenNumBTC](https://twitter.com/OpenNumBTC)

## License

MIT. OpenNum is intended as public infrastructure for Bitcoin wallets, Ordinals apps, creators, communities, and future autonomous agents.
