# OpenNum Protocol Specification v1.0

**Status:** Draft
**Date:** March 2026
**License:** MIT

---

## 1. Overview

OpenNum is an application-layer identity protocol built on top of the Bitcoin Ordinals indexing system. It maps Ordinal Inscription numbers to Bitcoin wallet addresses using off-chain cryptographic signatures, with no on-chain writes required.

**Core principle:** An inscription number is a permanent, globally unique integer assigned by the Ordinals protocol at inscription time. OpenNum turns this number into a human-readable identity anchor.

---

## 2. Registration Message Format

### 2.1 v1.0 — Personal Identity

```json
{
  "protocol":           "opennum",
  "version":            "1.0",
  "inscription_number": 2025,
  "inscription_txid":   "<64-char hex txid of the inscription>",
  "indexer_ruleset":    "ord-v0.18-mainnet",
  "wallet":             "<Bitcoin Taproot address bc1p...>",
  "display_name":       "<optional, non-unique display label>",
  "timestamp":          1735689600,
  "signature":          "<secp256k1 signature over canonical message>"
}
```

### 2.2 v1.1 — AI Agent Identity

Extends v1.0 with agent-specific fields. The human operator holds the inscription and signs the message; the agent operates a separate wallet.

```json
{
  "protocol":           "opennum",
  "version":            "1.1",
  "inscription_number": 2025,
  "inscription_txid":   "<txid>",
  "indexer_ruleset":    "ord-v0.18-mainnet",
  "wallet":             "<operator wallet holding inscription>",
  "agent_wallet":       "<agent operational wallet>",
  "agent_role":         "openclaw",
  "agent_label":        "<human-readable agent label>",
  "timestamp":          1735689600,
  "signature":          "<signed by operator wallet>"
}
```

---

## 3. Signature Scheme

- Algorithm: **secp256k1** (Bitcoin message signing standard)
- Message to sign (canonical, UTF-8, sorted keys):

```
opennum:register:<inscription_number>:<wallet>:<timestamp>
```

- Verification: standard Bitcoin message signature verification, compatible with all major wallets.

---

## 4. Dual Anchor Design

Each registration message includes both:

| Field | Type | Purpose |
|-------|------|---------|
| `inscription_number` | integer | Human-readable identifier (indexer-computed) |
| `inscription_txid` | hex string | Bitcoin consensus primitive (immutable) |
| `indexer_ruleset` | string | Declares which numbering rules are canonical |

The `txid` is the GPS coordinate (Bitcoin consensus, unforgeable). The `number` is the street address (human-readable, indexer-computed). Together they make OpenNum **numbering-dispute-immune**: even if indexer versions produce different numbers, the txid always resolves to the correct inscription.

---

## 5. Validity Rules

A registration is valid if and only if ALL of the following hold:

1. The signing wallet **currently holds** the declared inscription (verifiable via any Ordinals indexer)
2. The cryptographic signature is valid for the declared wallet and canonical message
3. The timestamp is within the acceptable freshness window (recommended: 10 minutes for initial registration)
4. No other currently-valid registration exists for the same inscription number from a different wallet

---

## 6. Identity State Machine

Every OpenNum number is in exactly one of four states at any time:

| State | Trigger | API Response |
|-------|---------|--------------|
| **Active** 🟢 | Registration signed by current holder | Returns wallet address |
| **Dormant** ⚫ | Inscription transferred, new holder not yet registered | Returns `{state: "dormant"}` |
| **Cooling** 🟠 | Transfer occurred within last 72 hours | Returns `{state: "cooling", hours_remaining: N}` |
| **Flagged** 🔵 | Previous holder published a transfer declaration | Returns `{state: "flagged", declaration: "..."}` |

### State Transitions

```
Active ──[inscription transferred]──► Dormant
Dormant ──[transfer < 72h ago]──► Cooling
Cooling/Dormant ──[new holder registers]──► Active
Any state ──[previous holder publishes declaration]──► Flagged
```

---

## 7. Cursed Inscriptions

Inscriptions created before Bitcoin block **824,544** using non-standard methods were assigned negative numbers by the Ordinals protocol. These ~472,043 inscriptions are called **Cursed Inscriptions**.

OpenNum treats cursed inscriptions as **first-class citizens**:
- Displayed as `#c-1234` format (corresponding to Ordinals negative number `#-1234`)
- Full registration rights, identical to positive-numbered inscriptions
- Holders are among the earliest Ordinals participants; their numbers carry unique historical significance

---

## 8. Message Propagation

**v1.0:** Registration messages are submitted via HTTP REST API to the reference indexer.

```
POST /api/v1/register
Content-Type: application/json

{ ...registration message... }
```

**v2.0+ (planned):** P2P Gossip network enabling message propagation across independent indexer nodes without any centralized entry point.

---

## 9. Indexer Architecture

Any party may run an OpenNum indexer. An indexer performs three functions:

1. **Monitor** Bitcoin blocks for inscription ownership changes (via standard Ordinals indexing)
2. **Validate** incoming OpenNum registration messages per §5 validity rules
3. **Serve** a public REST API mapping inscription numbers to wallet addresses, profile metadata, and registration state

Since validation rules are deterministic, multiple independent indexers receiving the same Bitcoin chain data and registration messages will converge to identical state.

### REST API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/register` | POST | Submit a registration message |
| `/api/v1/resolve/:number` | GET | Resolve number → wallet address + state |
| `/api/v1/profile/:number` | GET | Full profile metadata |
| `/api/v1/agents/:number` | GET | List agent wallets registered under a number |

---

## 10. Anti-Spam

OpenNum's primary spam defense is structural, not procedural: **registration requires holding an inscription, and inscriptions have real on-chain cost**. Mass spam registration requires mass inscription minting, which is economically expensive. Indexer implementations may additionally apply rate limits at the application layer.

---

## 11. .btc Display Alias

If an inscription's content is a valid SNS (Satoshi Name Service) domain registration JSON:

```json
{"p": "sns", "op": "reg", "name": "satoshi.btc"}
```

The OpenNum indexer **automatically reads** this as a display alias for that inscription number. The alias is metadata only — the inscription number remains the canonical identifier. Other SNS-compatible domain systems (btcmap, unisat domains) are also supported.

---

## 12. Changelog

| Version | Date | Changes |
|---------|------|---------|
| v1.0 | 2026-03 | Initial specification |

---

*OpenNum Protocol Specification · MIT License · [opennum.org](https://opennum.org) · [@OpenNumBTC](https://twitter.com/OpenNumBTC)*
