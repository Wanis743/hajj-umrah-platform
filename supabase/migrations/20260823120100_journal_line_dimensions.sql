-- 20260823120100_journal_line_dimensions.sql (rebuild-authored, slice-3 support)
--
-- The reviewed accounting RPCs (post_journal_entry, fix_rpcs variant) write
-- package_id / branch_id dimensions onto journal_lines. The original migration
-- that added these columns is absent from the repository history (applied to
-- the previous dev database manually). Recreate them idempotently:
--   - journal_lines.package_id  → package-level cost/revenue dimension
--   - journal_lines.branch_id already exists on the live table; only package_id is added here.
ALTER TABLE public.journal_lines
ADD COLUMN IF NOT EXISTS package_id UUID REFERENCES public.packages(id) ON DELETE SET NULL;
