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
      { name: 'Matt White', rank: 3, points: 250.0 },
      { name: 'Moses', rank: 4, points: 245.5 },
      { name: 'Scotty Pierson', rank: 5, points: 244.0 },
      { name: 'Josh Stoll', rank: 6, points: 234.5 },
      { name: 'Chris McNeely', rank: 7, points: 232.0 },
      { name: 'Mike Bonner', rank: 8, points: 228.5 },
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
