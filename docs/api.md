# OpenNum API

Base URL: `https://opennum.org`

Status: Phase 2 alpha. The hosted API is live, but response fields may expand as the profile model matures.

## Resolve

Resolve an OpenNum inscription number to its current wallet mapping.

```http
GET /api/resolve?num=2311
```

Compatibility alias:

```http
GET /api/v1/resolve/2311
```

Response:

```json
{
  "inscription_num": 2311,
  "inscription_id": "64-character-hex-txidi0",
  "inscription_txid": "64-character-hex-txid",
  "wallet": "bc1p...",
  "status": "active",
  "display_name": null,
  "registered_at": "2026-05-24T05:27:11.426215+00:00"
}
```

Unregistered response:

```json
{
  "status": "unregistered",
  "inscription_num": 2311
}
```

## Profile

Fetch an identity profile with best-effort Ordinals metadata.

```http
GET /api/profile?num=2311
```

Compatibility alias:

```http
GET /api/v1/profile/2311
```

Response includes the resolver record plus:

- `inscription_id`
- `inscription_txid`
- `bio`
- `indexer_ruleset`
- `metadata.content_type`
- `metadata.content_url`
- `metadata.sat_ordinal`
- `metadata.genesis_block_height`
- `metadata.genesis_timestamp`

## List

List active registrations.

```http
GET /api/list?sort=number&order=asc&limit=50
```

Parameters:

| Parameter | Values | Default |
|-----------|--------|---------|
| `sort` | `number`, `registered_at` | `registered_at` |
| `order` | `asc`, `desc` | `desc` |
| `limit` | `1`-`100` | `50` |
| `offset` | integer | `0` |

Compatibility alias:

```http
GET /api/v1/list
```

## Register

Submit a registration message signed by the wallet that owns the inscription.

```http
POST /api/register
Content-Type: application/json
```

Compatibility alias:

```http
POST /api/v1/register
```

Body:

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

Signed message:

```text
opennum:register:<inscription_num>:<wallet>:<timestamp>
```

Validation:

- The timestamp must be fresh.
- The signature must verify for the submitted wallet.
- When Ordinals metadata is reachable, the inscription owner and number must match.
- `inscription_id` is optional for compatibility, but should be sent by wallets because one Bitcoin transaction can contain multiple inscriptions (`i0`, `i1`, `i2`, ...).
- A wallet can have only one active OpenNum ID. Registering a second ID requires unbinding the existing active ID first.
- Existing active registrations can be transferred only when on-chain ownership is verified.

## Wallet

Check whether a wallet already has an active OpenNum ID.

```http
GET /api/wallet?wallet=bc1p...
```

Response:

```json
{
  "wallet": "bc1p...",
  "has_active_id": true,
  "registration": {
    "inscription_num": 2311,
    "inscription_id": "64-character-hex-txidi0",
    "status": "active"
  }
}
```

## Unbind

Unbind the wallet's active OpenNum ID so the same wallet can register another inscription.

```http
POST /api/unbind
Content-Type: application/json
```

Body:

```json
{
  "inscription_num": 2311,
  "wallet": "bc1p...",
  "signature": "BIP322 signature",
  "timestamp": 1779744378
}
```

Signed message:

```text
opennum:unbind:<inscription_num>:<wallet>:<timestamp>
```

Unbinding does not delete the historical record. It changes `status` to `unbound`.

## Guestbook

Fetch public wallet-signed messages for an identity.

```http
GET /api/guestbook?num=2311
```

Compatibility alias:

```http
GET /api/v1/guestbook/2311
```

Response:

```json
{
  "inscription_num": 2311,
  "messages": [
    {
      "id": "uuid",
      "inscription_num": 2311,
      "parent_id": null,
      "message": "gm OpenNum",
      "author_wallet": "bc1p...",
      "author_number": 2025,
      "created_at": "2026-05-26T00:00:00.000Z"
    }
  ]
}
```

Post a signed public message:

```http
POST /api/guestbook
Content-Type: application/json
```

```json
{
  "inscription_num": 2311,
  "parent_id": "optional parent message uuid",
  "author_wallet": "bc1p...",
  "message": "gm OpenNum",
  "signature": "BIP322 signature",
  "timestamp": 1779744378
}
```

Signed message:

```text
opennum:guestbook:<inscription_num>:<author_wallet>:<message>:<timestamp>
```

Messages are off-chain and public. OpenNum verifies the wallet signature but does not provide private chat in this version.
