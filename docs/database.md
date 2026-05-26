# OpenNum Database Notes

The hosted API expects Supabase/Postgres tables for registrations and public guestbook messages.

## Registrations migration

Older deployments only stored `inscription_txid`. Add `inscription_id` so non-`i0` inscriptions can render the correct avatar, content preview, and market link.

```sql
alter table registrations
  add column if not exists inscription_id text;

update registrations
set inscription_id = inscription_txid || 'i0'
where inscription_id is null
  and inscription_txid is not null;

create index if not exists registrations_inscription_id_idx
  on registrations (inscription_id);

alter table registrations
  add column if not exists bio text;
```

The API keeps a fallback path for older schemas, but the migration should be applied before relying on profile avatars or marketplace links.

## Guestbook table

Guestbook messages are public, off-chain, and wallet-signed.

```sql
create table if not exists guestbook (
  id uuid primary key default gen_random_uuid(),
  inscription_num bigint not null,
  message text not null check (char_length(message) <= 280),
  author_wallet text not null,
  author_number bigint,
  signature text not null,
  signed_message text not null,
  created_at timestamptz not null default now()
);

create index if not exists guestbook_inscription_num_created_at_idx
  on guestbook (inscription_num, created_at desc);

create index if not exists guestbook_author_wallet_idx
  on guestbook (author_wallet);
```

If row-level security is enabled, expose guestbook reads to anon clients and keep writes routed through the serverless API.
