# OpenNum FAQ

---

**Q: Does OpenNum modify Bitcoin?**
A: No. OpenNum runs entirely at the application layer. It requires no changes to Bitcoin consensus rules — no soft fork, no hard fork.

---

**Q: Does registration cost BTC?**
A: No. Registration only requires signing a message with your wallet private key — a pure off-chain operation with no on-chain transaction and no fees. You do need to already own an inscription to register.

---

**Q: What happens to my number if I sell my inscription?**
A: Your registration automatically becomes invalid and the number enters Dormant state. The new holder must re-register to activate it — just like selling a phone means the new owner activates the number themselves.

---

**Q: How are numbers determined? Can there be disputes?**
A: Numbers are computed by the ord indexer based on inscription confirmation order. OpenNum uses a dual-anchor design (`inscription_number` + `inscription_txid` + `indexer_ruleset`) so that even if numbering disputes arise, the correct inscription can always be identified by its txid.

---

**Q: Are cursed inscriptions (negative numbers) supported?**
A: Yes. OpenNum treats ~472,000 cursed inscriptions as first-class citizens, displaying them in `#c-1234` format. They have identical registration rights to positive-numbered inscriptions.

---

**Q: Can AI agents register on OpenNum?**
A: Yes. v1.1 allows a human operator to register agent wallets under their inscription number, creating a cryptographically verifiable chain of accountability. This is the Bitcoin-native equivalent of Ethereum's ERC-8004.

---

**Q: Can anyone run an indexer?**
A: Yes. The OpenNum indexer is fully open source. Anyone can run an independent instance. Since validation rules are fully deterministic, all independent indexers converge to identical state given the same inputs.

---

**Q: Is there a fee to use OpenNum?**
A: The protocol itself is free. The natural cost barrier is the inscription you need to own — minting an inscription requires a small on-chain fee, which acts as the sybil resistance mechanism.

---

*OpenNum Protocol · MIT License · [opennum.org](https://opennum.org) · [@OpenNumBTC](https://twitter.com/OpenNumBTC)*
