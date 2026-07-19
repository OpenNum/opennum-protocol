# Ownership sync

OpenNum treats Bitcoin inscription ownership as authoritative. Public resolver/profile requests still verify ownership on demand, and a Supabase scheduled Edge Function proactively checks active registrations so transferred inscriptions do not remain active until somebody opens their profile.

## Runtime

- Function: `ownership-sync`
- Schedule: every 10 minutes through Supabase Cron (`pg_cron` + `pg_net`)
- Batch: the 50 active registrations with the oldest `owner_checked_at`
- Concurrency: 8 resolver checks at a time
- Effect: `/api/resolve` verifies the current ordinals.com owner, closes the former holder period, archives period-bound state, records an `ownership_transferred` event, and marks the registration `dormant`
- Failure policy: fail closed; an unavailable indexer never transfers or reactivates an identity

The Edge Function requires JWT verification. The scheduled call reads the project URL and legacy anon JWT from Supabase Vault; neither credential is committed to this repository.

## Verification

After deployment, confirm all three layers:

1. `cron.job` contains the active `opennum-ownership-sync` schedule.
2. The latest Edge Function invocation returns `checked`, `changed`, and `failures` counts.
3. A transferred inscription returns `status: dormant`, `wallet: null`, `claim_required: true`; its previous wallet returns `has_active_id: false`.
