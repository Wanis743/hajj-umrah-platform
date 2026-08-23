# Fresh Database Replay

The canonical deployment path is the ordered Supabase migration chain under `supabase/migrations/`.

Run locally where Docker + Supabase CLI are available:

```bash
./scripts/fresh-db-replay.sh
```

The GitHub Actions workflow `.github/workflows/fresh-db.yml` performs the same replay on every push/PR.

A fresh replay is not considered passed merely because static migration scanning succeeds; the SQL migrations must be applied to a clean Supabase local instance and the RLS SQL suite must execute successfully.
