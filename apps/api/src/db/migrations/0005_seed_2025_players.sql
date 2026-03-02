-- Seed 2025 season roster
-- Uses conditional insert so re-running is safe (won't duplicate if already added via admin UI)

INSERT INTO players (name, ghin_number, is_active, is_guest, created_at)
SELECT 'Matt Jaquint', NULL, 1, 0, 1746144000000
WHERE NOT EXISTS (SELECT 1 FROM players WHERE name = 'Matt Jaquint');

INSERT INTO players (name, ghin_number, is_active, is_guest, created_at)
SELECT 'Jay Patterson', NULL, 1, 0, 1746144000000
WHERE NOT EXISTS (SELECT 1 FROM players WHERE name = 'Jay Patterson');

INSERT INTO players (name, ghin_number, is_active, is_guest, created_at)
SELECT 'Matt White', NULL, 1, 0, 1746144000000
WHERE NOT EXISTS (SELECT 1 FROM players WHERE name = 'Matt White');

INSERT INTO players (name, ghin_number, is_active, is_guest, created_at)
SELECT 'Moses', NULL, 1, 0, 1746144000000
WHERE NOT EXISTS (SELECT 1 FROM players WHERE name = 'Moses');

INSERT INTO players (name, ghin_number, is_active, is_guest, created_at)
SELECT 'Scotty Pierson', NULL, 1, 0, 1746144000000
WHERE NOT EXISTS (SELECT 1 FROM players WHERE name = 'Scotty Pierson');

INSERT INTO players (name, ghin_number, is_active, is_guest, created_at)
SELECT 'Josh Stoll', NULL, 1, 0, 1746144000000
WHERE NOT EXISTS (SELECT 1 FROM players WHERE name = 'Josh Stoll');

INSERT INTO players (name, ghin_number, is_active, is_guest, created_at)
SELECT 'Chris McNeely', NULL, 1, 0, 1746144000000
WHERE NOT EXISTS (SELECT 1 FROM players WHERE name = 'Chris McNeely');

INSERT INTO players (name, ghin_number, is_active, is_guest, created_at)
SELECT 'Mike Bonner', NULL, 1, 0, 1746144000000
WHERE NOT EXISTS (SELECT 1 FROM players WHERE name = 'Mike Bonner');

INSERT INTO players (name, ghin_number, is_active, is_guest, created_at)
SELECT 'Ronnie A.', NULL, 1, 0, 1746144000000
WHERE NOT EXISTS (SELECT 1 FROM players WHERE name = 'Ronnie A.');

INSERT INTO players (name, ghin_number, is_active, is_guest, created_at)
SELECT 'Tim Biller', NULL, 1, 0, 1746144000000
WHERE NOT EXISTS (SELECT 1 FROM players WHERE name = 'Tim Biller');

INSERT INTO players (name, ghin_number, is_active, is_guest, created_at)
SELECT 'Jeff Madden', NULL, 1, 0, 1746144000000
WHERE NOT EXISTS (SELECT 1 FROM players WHERE name = 'Jeff Madden');

INSERT INTO players (name, ghin_number, is_active, is_guest, created_at)
SELECT 'Ben McGinnis', NULL, 1, 0, 1746144000000
WHERE NOT EXISTS (SELECT 1 FROM players WHERE name = 'Ben McGinnis');

INSERT INTO players (name, ghin_number, is_active, is_guest, created_at)
SELECT 'Kyle Cox', NULL, 1, 0, 1746144000000
WHERE NOT EXISTS (SELECT 1 FROM players WHERE name = 'Kyle Cox');

INSERT INTO players (name, ghin_number, is_active, is_guest, created_at)
SELECT 'Jeff Biederman', NULL, 1, 0, 1746144000000
WHERE NOT EXISTS (SELECT 1 FROM players WHERE name = 'Jeff Biederman');

INSERT INTO players (name, ghin_number, is_active, is_guest, created_at)
SELECT 'Chris Keaton', NULL, 1, 0, 1746144000000
WHERE NOT EXISTS (SELECT 1 FROM players WHERE name = 'Chris Keaton');

INSERT INTO players (name, ghin_number, is_active, is_guest, created_at)
SELECT 'Bobby Marshall', NULL, 1, 0, 1746144000000
WHERE NOT EXISTS (SELECT 1 FROM players WHERE name = 'Bobby Marshall');

INSERT INTO players (name, ghin_number, is_active, is_guest, created_at)
SELECT 'Sean Wilson', NULL, 1, 0, 1746144000000
WHERE NOT EXISTS (SELECT 1 FROM players WHERE name = 'Sean Wilson');
