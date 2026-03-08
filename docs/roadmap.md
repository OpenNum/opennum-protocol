# OpenNum Protocol — Roadmap

> **Last updated:** March 2026
> This document outlines the development path of the OpenNum protocol from its current state toward a full identity ecosystem on Bitcoin.

---

## Vision

OpenNum's mission is to turn Bitcoin Ordinal inscription numbers into a universal identity layer — simple, verifiable, and requiring no smart contracts. An inscription number is a permanent, globally unique integer anchored to the Bitcoin blockchain. OpenNum makes it a resolvable, shareable identity.

**Long-term goal:** Inscription numbers should represent not only assets, but identity — for people, wallets, creators, and AI agents.

---

## Phase 1 — Foundation ✅ Largely Complete
**Timeline: 2026 Q1**

This phase establishes the protocol specification, public documentation, and the initial demonstration of three live identities on mainnet.

### Protocol & Documentation
- [x] Protocol Specification v1.0 published (`spec-v1.0.md`)
- [x] Dual-Anchor Design — every registration binds both `inscription_number` (human-readable) and `inscription_txid` (Bitcoin consensus primitive), making OpenNum numbering-dispute-immune across indexer versions
- [x] Four-State Identity Machine defined — **Active 🟢 / Dormant ⚫ / Cooling 🟠 / Flagged 🔵**
- [x] Registration message format v1.0 (Personal Identity) — secp256k1 signature over canonical message
- [x] Registration message format v1.1 (AI Agent Identity) — `agent_wallet` + `agent_role` + `agent_label` fields, operator-signed
- [x] Cursed Inscription support — `#c-1234` format for the ~472,043 pre-block-824,544 inscriptions, treated as first-class citizens
- [x] `.btc` display alias — SNS domain inscriptions automatically read as human-readable aliases
- [x] Whitepaper published (EN / CN / KR)
- [x] GitHub repository open at `github.com/OpenNum/opennum-protocol`

### Website & Identity Pages
- [x] `opennum.org` live on Vercel
- [x] Three live identity pages: `opennum.org/n/2025`, `/n/9164`, `/n/60585`
- [x] Identity pages include: status badge, linked wallet, inscription ID, state machine lifecycle, share copy, Resolver field
- [x] `opennum.org/explore` — Explorer page with stats, identity list, card grid, search, and Resolver API preview

---

## Phase 2 — Resolver & Registration
**Timeline: 2026 Q2**

This phase makes OpenNum a functioning protocol network — real registrations, real resolution.

### Resolver API
- [ ] `GET /api/v1/resolve/:number` → returns wallet / status / inscription
- [ ] `GET /api/v1/profile/:number` → full profile metadata
- [ ] `GET /api/v1/agents/:number` → list agent wallets registered under a number
- [ ] Reference indexer deployed, validating registrations against Bitcoin chain state
- [ ] Explorer connected to live API data (replaces static demo data)

### Registration Page
- [ ] `opennum.org/register` — users submit a registration by signing a canonical message with their Bitcoin wallet
- [ ] Wallet connect flow (compatible with Unisat, Xverse, OKX Wallet)
- [ ] On-screen signature generation and `POST /api/v1/register` submission
- [ ] Registration confirmation — number transitions from unregistered → Active

### Anti-Spam & Validity
- [ ] Indexer enforces all validity rules (§5 of spec): inscription ownership check, signature verification, timestamp freshness, uniqueness constraint
- [ ] Rate limiting at the indexer application layer

---

## Phase 3 — Ecosystem Integration
**Timeline: 2026 Q3**

This phase brings OpenNum identity into existing Bitcoin and Ordinals applications.

### Wallet Integration
- [ ] Approach wallet providers (Unisat, Xverse, OKX Wallet, Magic Eden Wallet) for native OpenNum identity display
- [ ] Wallets can show `#2025` as an identity label alongside a Bitcoin address

### Ordinals Explorer Integration
- [ ] Approach existing Ordinals explorers (Ordiscan, Ord.io, Magic Eden Ordinals) to display OpenNum identity alongside inscription data
- [ ] Enables users to see `opennum.org/n/2025` linked directly from inscription explorer pages

### NFT Marketplace Integration
- [ ] NFT marketplaces (Magic Eden, OKX NFT) display OpenNum identity for sellers and buyers
- [ ] Identity adds context to Ordinals listings — a verified wallet identity behind the address

### Developer SDK (Early)
- [ ] Open-source JavaScript/TypeScript SDK: `npm install opennum-sdk`
- [ ] `resolve(number)` / `register(message, signature)` / `verify(message)` interface
- [ ] Third-party developers can integrate OpenNum identity into their apps

---

## Phase 4 — Identity Expansion
**Timeline: 2026 Q4**

This phase deepens the protocol and expands what an OpenNum identity can represent.

### OpenNum Profile
- [ ] Profile metadata fields: avatar, bio, links, social handles
- [ ] `opennum.org/n/2025` becomes a full public profile, not just an identity record
- [ ] `GET /api/v1/profile/:number` serves full structured profile data

### AI Agent Identity (Full Ecosystem)
- [ ] v1.1 agent identity delegation widely deployed: operators can assign inscription-backed identities to autonomous AI agents
- [ ] Agent identity verifiable by any application: `agent_did`, `capabilities`, operator-signed
- [ ] Tooling and documentation for AI framework integrations (MCP servers, agent platforms)

### Decentralized Indexer Network
- [ ] Any party can run a conformant OpenNum indexer (§9 of spec)
- [ ] Multi-indexer consistency: deterministic validation rules ensure independent indexers converge to identical state
- [ ] P2P Gossip network (v2.0) enables registration message propagation without any centralized entry point

### Community & Developer Ecosystem
- [ ] Developer documentation portal at `opennum.org/docs`
- [ ] Open-source community indexer implementation
- [ ] Grants or bounties for third-party integrations

---

## Phase 5 — Scale
**Timeline: 2027 and beyond**

This phase takes OpenNum from a Bitcoin-native protocol to a broader identity primitive.

- [ ] Mobile-first experience for registration and identity management
- [ ] Multi-language support (EN / CN / JP / KR / ES and beyond)
- [ ] OpenNum as a login primitive — "Sign in with inscription" for web applications
- [ ] Cross-chain identity bridges (Ethereum, Solana address binding via OpenNum record)
- [ ] Global adoption push: wallets, marketplaces, social platforms, DeFi protocols

---

## Technical Milestones Summary

| Phase | Timeline | Key Deliverables | Status |
|-------|----------|-----------------|--------|
| **Phase 1 — Foundation** | 2026 Q1 | Protocol spec · Dual-Anchor · State Machine · AI Agent v1.1 · Cursed Inscriptions · Website · Identity Pages · Explorer | ✅ Largely complete |
| **Phase 2 — Resolver & Registration** | 2026 Q2 | Resolver API · Registration page · Live indexer | 🔲 In progress |
| **Phase 3 — Ecosystem Integration** | 2026 Q3 | Wallet / Explorer / Marketplace integration · SDK | 🔲 Planned |
| **Phase 4 — Identity Expansion** | 2026 Q4 | Full Profile · AI Agent ecosystem · Decentralized indexer network | 🔲 Planned |
| **Phase 5 — Scale** | 2027+ | Mobile · Multi-language · Cross-chain · Global | 🔲 Future |

---

## What Makes OpenNum Different

| Feature | OpenNum | ENS / Unstoppable Domains | Ordinals Name Services |
|---------|---------|--------------------------|----------------------|
| Identity anchor | Inscription number (permanent integer) | Domain string | Domain string |
| Smart contracts required | ❌ None | ✅ Ethereum smart contract | Varies |
| Bitcoin-native | ✅ | ❌ | ✅ |
| Dispute-immune | ✅ Dual-anchor design | N/A | ❌ |
| AI Agent delegation | ✅ v1.1 | ❌ | ❌ |
| Cursed inscription support | ✅ First-class | N/A | Varies |

---

*OpenNum Protocol Roadmap · MIT License · [opennum.org](https://opennum.org) · [@OpenNumBTC](https://twitter.com/OpenNumBTC)*
