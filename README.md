# OpenNum Protocol

[![Twitter Follow](https://img.shields.io/twitter/follow/OpenNumBTC?style=social)](https://twitter.com/OpenNumBTC)
[![License: MIT](https://img.shields.io/badge/License-MIT-orange.svg)](LICENSE)
[![Website](https://img.shields.io/badge/website-opennum.org-orange)](https://opennum.org)

> **Bitcoin's phone book and wallet for the AI era — one number that takes you everywhere on-chain.**

---

## What is OpenNum?

OpenNum is an **application-layer identity protocol** built on the Bitcoin Ordinals indexing system. It maps Ordinal inscription numbers to wallet addresses using off-chain secp256k1 signatures — no smart contracts, no new chain, no permission required.

Think of it as **Bitcoin's phone number system**: your inscription number is your permanent on-chain identity.

```
// Before OpenNum:
Send to: bc1p8dqa4wjvnt890qmfws83te2v3rxd7zr5uu6vsrk8kqnf3cgwwuqszc3qa5

// With OpenNum:
Send to: #2025
```

---

## Key Features

| Feature | Description |
|---------|-------------|
| 🔢 **Sequential integer ID** | Inscription number = identity. Globally unique, never reused |
| 🔐 **Zero on-chain cost** | Registration via secp256k1 signature only — no gas, no transaction |
| 🖼️ **Built-in avatar** | Inscription image automatically becomes your on-chain profile picture |
| 🔄 **Identity State Machine** | Four states: Active / Dormant / Cooling / Flagged |
| 🤖 **AI Agent Ready** | v1.1 natively supports AI agent identity (Human-Agent Trust Bridge) |
| ⛓️ **Dual Anchor** | `inscription_number` + `inscription_txid` — immune to indexer numbering disputes |
| 😈 **Cursed Inscription Support** | `#c-1234` format — 472,043 early inscriptions treated as first-class citizens |
| 🌐 **.btc Display Alias** | Auto-reads SNS-format domain inscriptions as display names |

---

## Protocol Architecture

```
Bitcoin L1 (Consensus)
    └── Ordinals Indexer (ord)
            └── OpenNum Indexer (Application Layer)
                    ├── Registration API  (POST /api/v1/register)
                    ├── Resolution API    (GET  /api/v1/resolve/:number)
                    └── State Machine     (Active → Dormant → Cooling → Active)
```

OpenNum **does not modify Bitcoin consensus**. No smart contracts. No sidechains. The protocol runs entirely at the application layer — anyone can run an independent indexer.

---

## Registration Format

### v1.0 — Personal Identity
```json
{
  "protocol":           "opennum",
  "version":            "1.0",
  "inscription_number": 2025,
  "inscription_txid":   "abc123...def",
  "indexer_ruleset":    "ord-v0.18-mainnet",
  "wallet":             "bc1p...",
  "timestamp":          1735689600,
  "signature":          "H9k2mN...Xp4q"
}
```

### v1.1 — AI Agent Identity
```json
{
  "protocol":           "opennum",
  "version":            "1.1",
  "inscription_number": 2025,
  "inscription_txid":   "abc123...def",
  "wallet":             "bc1p...",
  "agent_wallet":       "bc1pagent...",
  "agent_role":         "openclaw",
  "agent_label":        "Trading Agent #1",
  "timestamp":          1735689600,
  "signature":          "H9k2mN...Xp4q"
}
```

---

## Identity State Machine

```
   [inscription transferred]     [new owner registers]
Active ──────────────► Dormant ◄──────────────────────┐
  ▲                       │                            │
  │      [within 72h]     ▼                            │
  └──────────────── Cooling ───────────────────────────┘

  Any state ──[prior owner disputes]──► Flagged
```

| State | Symbol | Meaning |
|-------|--------|---------|
| Active | 🟢 | Valid registration, wallet holds the inscription |
| Dormant | ⚫ | Inscription transferred, identity suspended |
| Cooling | 🟠 | 72-hour re-registration lockout after transfer |
| Flagged | 🔵 | Community-reported, under human review |

---

## Repository Structure

```
opennum/
├── README.md
├── whitepaper/
│   ├── opennum-whitepaper-en.pdf   # English whitepaper
│   ├── opennum-whitepaper-cn.pdf   # Chinese whitepaper
│   ├── opennum-whitepaper-kr.pdf   # Korean whitepaper
│   ├── whitepaper-en.html          # English whitepaper (web)
│   ├── whitepaper-cn.html          # Chinese whitepaper (web)
│   └── img/logo.svg
├── protocol-spec/
│   └── spec-v1.0.md                # Full protocol specification
├── docs/
│   └── faq.md                      # Frequently asked questions
└── research/
    └── README.md                   # Related projects & references
```

---

## Whitepaper

| Language | PDF | Web |
|----------|-----|-----|
| English | [opennum-whitepaper-en.pdf](./whitepaper/opennum-whitepaper-en.pdf) | [Read online](./whitepaper/whitepaper-en.html) |
| Chinese | [opennum-whitepaper-cn.pdf](./whitepaper/opennum-whitepaper-cn.pdf) | [Read online](./whitepaper/whitepaper-cn.html) |
| Korean | [opennum-whitepaper-kr.pdf](./whitepaper/opennum-whitepaper-kr.pdf) | — |

---

## Roadmap

| Phase | Timeline | Deliverables |
|-------|----------|--------------|
| **Phase 1: Foundation** | 2026 Q1 | Protocol spec · GitHub · Whitepaper (EN/CN/KR) |
| **Phase 2: Explorer** | 2026 Q2 | opennum.org · Number lookup · Profile pages |
| **Phase 3: Social** | 2026 Q3 | Messaging · Inscription gifting · Social account binding |
| **Phase 4: SDK** | 2026 Q4 | Open-source wallet SDK · Third-party integrations |
| **Phase 5: Scale** | 2027+ | Mobile · Multi-language · Global expansion |

---

## Open Protocol

- **License**: MIT — fully open-source, no permission required, no registration fee
- **Indexers**: Anyone can run an independent indexer; rules are fully deterministic
- **Zero protocol fee**: Spam resistance comes from the natural cost of minting an inscription

---

## Get Involved

- [GitHub Issues](../../issues) — protocol design discussion
- [opennum.org](https://opennum.org) — official website
- [𝕏 @OpenNumBTC](https://twitter.com/OpenNumBTC) — follow us on X / Twitter

---

*OpenNum Protocol · MIT License · 2026 · [opennum.org](https://opennum.org) · [@OpenNumBTC](https://twitter.com/OpenNumBTC)*
