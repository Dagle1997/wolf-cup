-- generated_pairing: set-once snapshot of the engine's generated pairing,
-- captured in-transaction at from-attendance Generate. JSON shape:
--   [{ "groupNumber": 1, "playerIds": [id, id, id, id] }, ...]
-- Nullable: rounds created before this feature (or never generated from
-- attendance) read NULL = "not tracked" in the pairing audit.
ALTER TABLE `rounds` ADD `generated_pairing` text;
