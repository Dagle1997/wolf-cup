/**
 * Historical data for Wolf Cup champions and season standings.
 * Separate from seed.ts for clean organization and easy updates.
 *
 * Data sources:
 * - 2023: Auto-Printable sheet from Excel (full season, all players)
 * - 2025: season-standings.json from engine fixtures (full season, all players)
 * - 2021, 2022, 2024: Top-4 playoff data from Jason Moses (final points)
 * - 2015–2020: Top-4 final points from Jason Moses + partial ranks from Stats sheet
 * - Champions: Confirmed by Josh + Jason's playoff records
 *
 * Note: For years with only top-4 data, points are FINAL totals (season + playoffs).
 * For 2023 and 2025, points are regular season totals (full rosters available).
 */

export const HISTORICAL_CHAMPIONS: { year: number; playerName: string }[] = [
  { year: 2025, playerName: 'Matt Jaquint' },
  { year: 2024, playerName: 'Ronnie A.' },
  { year: 2023, playerName: 'Nathan Copley' },
  { year: 2022, playerName: 'Chris Preston' },
  { year: 2021, playerName: 'Jeff Madden' },
  { year: 2020, playerName: 'Chris Preston' },
  { year: 2019, playerName: 'Chris McNeely' },
  { year: 2018, playerName: 'Chris Preston' },
  { year: 2017, playerName: 'Chris Preston' },
  { year: 2016, playerName: 'Moses' },
  { year: 2015, playerName: 'Matt Jaquint' },
];

export const HISTORICAL_STANDINGS: {
  year: number;
  standings: { name: string; rank: number; points?: number }[];
}[] = [
  // 2025 — from season-standings.json (regular season, all players)
  {
    year: 2025,
    standings: [
      { name: 'Matt Jaquint', rank: 1, points: 271.0 },
      { name: 'Jay Patterson', rank: 2, points: 266.5 },
      { name: 'Mike Bonner', rank: 3, points: 228.5 },
      { name: 'Matt White', rank: 4, points: 250.0 },
      { name: 'Moses', rank: 5, points: 245.5 },
      { name: 'Scotty Pierson', rank: 6, points: 244.0 },
      { name: 'Josh Stoll', rank: 7, points: 234.5 },
      { name: 'Chris McNeely', rank: 8, points: 232.0 },
      { name: 'Ronnie A.', rank: 9, points: 227.5 },
      { name: 'Tim Biller', rank: 10, points: 226.0 },
      { name: 'Jeff Madden', rank: 11, points: 213.0 },
      { name: 'Ben McGinnis', rank: 12, points: 205.5 },
      { name: 'Kyle Cox', rank: 13, points: 167.0 },
      { name: 'Jeff Biederman', rank: 14, points: 155.5 },
      { name: 'Chris Keaton', rank: 15, points: 131.5 },
      { name: 'Bobby Marshall', rank: 16, points: 123.0 },
      { name: 'Sean Wilson', rank: 17, points: 88.5 },
    ],
  },
  // 2024 — top-4 final points from Jason Moses
  {
    year: 2024,
    standings: [
      { name: 'Ronnie A.', rank: 1, points: 436.5 },
      { name: 'Tim Biller', rank: 2, points: 411 },
      { name: 'Ben McGinnis', rank: 3, points: 391 },
      { name: 'Matt Jaquint', rank: 4, points: 390.5 },
    ],
  },
  // 2023 — from Auto-Printable sheet (regular season, all players)
  {
    year: 2023,
    standings: [
      { name: 'Ronnie A.', rank: 1, points: 285.5 },
      { name: 'Nathan Copley', rank: 2, points: 273.5 },
      { name: 'Chris Preston', rank: 3, points: 270 },
      { name: 'Chris McNeely', rank: 4, points: 269 },
      { name: 'Matt Jaquint', rank: 5, points: 268 },
      { name: 'Josh Stoll', rank: 6, points: 263.5 },
      { name: 'Moses', rank: 7, points: 255 },
      { name: 'Scotty Pierson', rank: 8, points: 252.5 },
      { name: 'Ben McGinnis', rank: 9, points: 244 },
      { name: 'Jeff Biederman', rank: 10, points: 239 },
      { name: 'Mike Bonner', rank: 11, points: 232 },
      { name: 'Jeff Madden', rank: 12, points: 231.5 },
      { name: 'A. Dawson', rank: 13, points: 215.5 },
      { name: 'Kyle Cox', rank: 14, points: 199 },
      { name: 'Matt White', rank: 15, points: 198.5 },
      { name: 'Sean Wilson', rank: 16, points: 132 },
      { name: 'Chris Keaton', rank: 17, points: 131 },
      { name: 'Jay Patterson', rank: 18, points: 111.5 },
      { name: 'Alan Beasley', rank: 19, points: 32.5 },
    ],
  },
  // 2022 — top-4 final points from Jason Moses
  {
    year: 2022,
    standings: [
      { name: 'Chris Preston', rank: 1, points: 462 },
      { name: 'Jeff Madden', rank: 2, points: 440 },
      { name: 'Ben McGinnis', rank: 3, points: 402 },
      { name: 'Kyle Cox', rank: 4, points: 364 },
    ],
  },
  // 2021 — top-4 final points from Jason Moses
  {
    year: 2021,
    standings: [
      { name: 'Jeff Madden', rank: 1, points: 357.5 },
      { name: 'Moses', rank: 2, points: 325 },
      { name: 'Jay Patterson', rank: 3, points: 294.5 },
      { name: 'Chris Preston', rank: 4, points: 294.5 },
    ],
  },
  // 2020 — top-4 final points from Jason Moses + partial ranks from Stats sheet
  {
    year: 2020,
    standings: [
      { name: 'Chris Preston', rank: 1, points: 284 },
      { name: 'Sean Wilson', rank: 2, points: 263 },
      { name: 'A. Dawson', rank: 3, points: 243.5 },
      { name: 'Jay Patterson', rank: 4, points: 242 },
      { name: 'Ronnie A.', rank: 5 },
      { name: 'Josh Stoll', rank: 6 },
      { name: 'Jeff Madden', rank: 7 },
      { name: 'Kyle Cox', rank: 8 },
    ],
  },
  // 2019 — top-4 final points from Jason Moses + partial ranks from Stats sheet
  {
    year: 2019,
    standings: [
      { name: 'Chris McNeely', rank: 1, points: 288 },
      { name: 'Jay Patterson', rank: 2, points: 263.5 },
      { name: 'Moses', rank: 3, points: 240.5 },
      { name: 'Josh Stoll', rank: 4, points: 228.5 },
      { name: 'Chris Preston', rank: 5 },
      { name: 'Jeff Madden', rank: 6 },
      { name: 'Sean Wilson', rank: 7 },
    ],
  },
  // 2018 — top-4 final points from Jason Moses + partial ranks from Stats sheet
  {
    year: 2018,
    standings: [
      { name: 'Chris Preston', rank: 1, points: 266.5 },
      { name: 'Jeff Madden', rank: 2, points: 263 },
      { name: 'Chris Keaton', rank: 3, points: 259 },
      { name: 'Josh Stoll', rank: 4, points: 258.5 },
      { name: 'Jay Patterson', rank: 5 },
      { name: 'Ronnie A.', rank: 6 },
      { name: 'Moses', rank: 7 },
      { name: 'Matt Jaquint', rank: 8 },
    ],
  },
  // 2017 — top-4 final points from Jason Moses + partial ranks from Stats sheet
  {
    year: 2017,
    standings: [
      { name: 'Chris Preston', rank: 1, points: 267 },
      { name: 'Matt Jaquint', rank: 2, points: 257.5 },
      { name: 'A. Dawson', rank: 3, points: 251 },
      { name: 'Matt White', rank: 4, points: 239 },
      { name: 'Jay Patterson', rank: 6 },
      { name: 'Moses', rank: 7 },
      { name: 'Jeff Madden', rank: 8 },
    ],
  },
  // 2016 — top-4 final points from Jason Moses + partial ranks from Stats sheet
  {
    year: 2016,
    standings: [
      { name: 'Moses', rank: 1, points: 281.5 },
      { name: 'Matt Jaquint', rank: 2, points: 276 },
      { name: 'Matt White', rank: 3, points: 268.5 },
      { name: 'Chris Preston', rank: 4, points: 223.5 },
      { name: 'Jeff Madden', rank: 5 },
      { name: 'Chris McNeely', rank: 8 },
    ],
  },
  // 2015 — top-4 final points from Jason Moses + partial ranks from Stats sheet
  {
    year: 2015,
    standings: [
      { name: 'Matt Jaquint', rank: 1, points: 277 },
      { name: 'Moses', rank: 2, points: 241.5 },
      { name: 'Matt White', rank: 3, points: 234 },
      { name: 'Brian White', rank: 4, points: 232 },
      { name: 'Chris Preston', rank: 5 },
      { name: 'Chris Keaton', rank: 6 },
      { name: 'Chris McNeely', rank: 7 },
      { name: 'Josh Stoll', rank: 8 },
    ],
  },
];

/** Players that may need to be created for historical data (with isActive: 0) */
export const HISTORICAL_PLAYERS: string[] = [
  'Nathan Copley',
  'Chris Preston',
  'A. Dawson',
  'Alan Beasley',
  'Brian White',
];

/**
 * Maps historical/Excel names → database player names.
 * Historical data uses nicknames; the DB uses formal names.
 */
export const NAME_MAP: Record<string, string> = {
  'John Patterson': 'Jay Patterson',
  'Moses': 'Jason Moses',
  'Bob Marshall': 'Bobby Marshall',
  'Mike Bonner': 'Michael Bonner',
  'Ronnie A.': 'Ronnie Adkins',
  'Scotty Pierson': 'Scott Pierson',
};

/** Normalize a historical name to the DB name */
export function normalizePlayerName(name: string): string {
  return NAME_MAP[name] ?? name;
}

/** Player names per year — used for OG / Every Season badge detection */
export const HISTORICAL_ROSTERS: Record<number, string[]> = {
  2015: ['Moses', 'Brian White', 'Matt Jaquint', 'Chris Preston', 'Matt White', 'Chris McNeely', 'Nick Goff', 'Chris Keaton', 'Josh Stoll', 'Allan Thacker', 'A. Dawson', 'David Sheils', 'Jack Taylor', 'Chris Michael', 'Sid Torlone'],
  2016: ['Moses', 'Matt Jaquint', 'Brian White', 'Matt White', 'Sid Torlone', 'Chris Preston', 'Jeff Madden', 'Chris McNeely', 'John Short', 'Scott Crouch', 'Tim Eves', 'Chris Keaton', 'Jay Patterson', 'Josh Stoll', 'A. Dawson'],
  2017: ['Sid Torlone', 'Jeff Madden', 'Matt White', 'Matt Jaquint', 'A. Dawson', 'Jay Patterson', 'Moses', 'Chris Preston', 'Josh Stoll', 'Chris Keaton', 'Tim Eves', 'Ronnie A.', 'Chris McNeely', 'John Short'],
  2018: ['Josh Stoll', 'Jeff Madden', 'Matt Jaquint', 'Chris Preston', 'Jay Patterson', 'Ronnie A.', 'Moses', 'Chris Keaton', 'Sean Wilson', 'Chris McNeely', 'Matt White', 'A. Dawson', 'Tim Eves'],
  2019: ['Chris McNeely', 'Moses', 'Josh Stoll', 'Jeff Madden', 'Chris Preston', 'Jay Patterson', 'Sean Wilson', 'Tim Eves', 'Chris Keaton', 'Matt White', 'A. Dawson', 'Ronnie A.'],
  2020: ['Ronnie A.', 'A. Dawson', 'Chris Preston', 'Jeff Madden', 'Josh Stoll', 'Jay Patterson', 'Sean Wilson', 'Kyle Cox', 'Moses', 'Chris McNeely', 'Chris Keaton', 'Matt White'],
  2021: ['Moses', 'Jeff Madden', 'Chris Preston', 'Chris McNeely', 'Jay Patterson', 'Ronnie A.', 'Sean Wilson', 'Kyle Cox', 'Mike Bonner', 'Josh Stoll', 'A. Dawson', 'Nathan Copley', 'Jeff Biederman', 'Alan Beasley', 'Matt White', 'Chris Keaton'],
  2022: ['Jeff Madden', 'Ben McGinnis', 'Chris McNeely', 'Kyle Cox', 'Nathan Copley', 'Chris Preston', 'Scotty Pierson', 'Matt White', 'A. Dawson', 'Jeff Biederman', 'Jay Patterson', 'Mike Bonner', 'Josh Stoll', 'Ronnie A.', 'Sean Wilson', 'Chris Keaton', 'Moses', 'Matt Jaquint', 'Alan Beasley'],
  2023: ['Ronnie A.', 'Nathan Copley', 'Chris Preston', 'Chris McNeely', 'Matt Jaquint', 'Josh Stoll', 'Moses', 'Scotty Pierson', 'Ben McGinnis', 'Jeff Biederman', 'Mike Bonner', 'Jeff Madden', 'A. Dawson', 'Kyle Cox', 'Matt White', 'Sean Wilson', 'Chris Keaton', 'Jay Patterson', 'Alan Beasley'],
  2024: ['Ronnie A.', 'Tim Biller', 'Matt Jaquint', 'Scotty Pierson', 'Ben McGinnis', 'Jay Patterson', 'Moses', 'Mike Bonner', 'Jeff Madden', 'Chris McNeely', 'Josh Stoll', 'A. Dawson', 'Jeff Biederman', 'Kyle Cox', 'Sean Wilson', 'Matt White', 'Chris Preston', 'Chris Keaton'],
  2025: ['Matt Jaquint', 'Jay Patterson', 'Matt White', 'Moses', 'Scotty Pierson', 'Josh Stoll', 'Chris McNeely', 'Mike Bonner', 'Ronnie A.', 'Tim Biller', 'Jeff Madden', 'Ben McGinnis', 'Kyle Cox', 'Jeff Biederman', 'Chris Keaton', 'Bobby Marshall', 'Sean Wilson'],
};

/** Per-season Money Man and Philanthropist winners (2023+ only — earlier eras had different point scales) */
export const HISTORICAL_CASH: { year: number; moneyMan: { name: string; cash: number }; philanthropist: { name: string; cash: number } }[] = [
  { year: 2023, moneyMan: { name: 'Matt Jaquint', cash: 124 }, philanthropist: { name: 'Chris Keaton', cash: -228 } },
  { year: 2024, moneyMan: { name: 'Matt Jaquint', cash: 108 }, philanthropist: { name: 'Chris Keaton', cash: -143 } },
  { year: 2025, moneyMan: { name: 'Jay Patterson', cash: 159 }, philanthropist: { name: 'Chris Keaton', cash: -127 } },
];

/** All-time single-season cash records (2016-2025) */
export const HISTORICAL_CASH_RECORDS = {
  biggestWin: { name: 'Josh Stoll', year: 2018, cash: 191 },
  biggestLoss: { name: 'Chris Keaton', year: 2023, cash: -228 },
};

/** Custom/joke awards — hardcoded one-offs */
export const CUSTOM_AWARDS = [
  {
    id: 'snow_cone',
    emoji: '🍧',
    name: 'Snow Cone',
    category: 'superlatives' as const,
    description: 'Never lost a ball. Not once. Ever.',
    recipients: [{ playerName: 'Tim Eves', years: [2016, 2017, 2018, 2019], detail: '4 seasons, 0 lost balls' }],
  },
  {
    id: 'the_ronnie',
    emoji: '😤',
    name: 'The Ronnie',
    category: 'superlatives' as const,
    description: '#1 seed in the regular season. Eliminated before the Final Four.',
    recipients: [
      { playerName: 'Ronnie A.', years: [2020], detail: '#1 seed, bounced in playoffs' },
    ],
  },
];

/** Years where players played every regular season round */
export const HISTORICAL_IRONMAN: { year: number; maxRounds: number; perfectAttendance: string[] }[] = [
  { year: 2020, maxRounds: 18, perfectAttendance: ['Jay Patterson'] },
];
