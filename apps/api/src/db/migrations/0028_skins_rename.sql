-- Rename "Most Skins" → "Skins" + drop skins from Side Game Champion track.
--
-- Change of model: the skins side game is no longer a "winner-takes-all"
-- game (one player gets a Champion-track point for having the most skins).
-- It's now a list-display game showing every player who earned ≥1 skin
-- across the field, mirroring how the league actually scores skins. The
-- per-player skin counts are computed live from scores on every leaderboard
-- fetch, including post-finalization, so corrections flow through.
--
-- This migration normalizes legacy data + scrubs persisted Champion-track
-- credits in three steps. Step ordering matters — we identify legacy skins
-- rows BY NAME first, then promote them to calculation_type='auto_skins'
-- so the runtime guards (admin-endpoint block, orchestrator wipe, history
-- aggregator filter) all key off a single semantic marker going forward:
--
--   1. Promote any side_games row named 'Most Skins' or 'Skins' (case-
--      sensitive — these are the only forms the seed has ever produced) to
--      calculation_type='auto_skins'. This catches legacy rows whose calc
--      type might be NULL (added before that column existed) or 'manual'
--      (seeded by hand). After this step the runtime filters cover them.
--
--   2. Rename 'Most Skins' → 'Skins' on those promoted rows. Idempotent.
--
--   3. Delete every side_game_results row whose side_game_id belongs to an
--      auto_skins game — historical Champion-track credits are wiped so
--      past skins weeks no longer contribute to the season-long trophy.
--      This runs AFTER step 1 so legacy NULL-calc-type rows are included.
--
-- The seed list at apps/api/src/routes/admin/side-games.ts:421 is updated
-- in the same change so future seasons initialize with the new name.

UPDATE side_games
SET calculation_type = 'auto_skins'
WHERE name IN ('Skins', 'Most Skins');

UPDATE side_games
SET name = 'Skins'
WHERE calculation_type = 'auto_skins'
  AND name = 'Most Skins';

-- DELETE bound on BOTH the calc-type promotion (step 1) AND the historical
-- name set, so we can't accidentally take out non-skins results if a future
-- migration ever reuses 'auto_skins' for a different side game. After step 1
-- the name set is the authoritative semantic marker for "this is skins."
DELETE FROM side_game_results
WHERE side_game_id IN (
  SELECT id FROM side_games
  WHERE calculation_type = 'auto_skins'
    AND name IN ('Skins', 'Most Skins')
);
