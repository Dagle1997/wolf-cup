/**
 * Opening futures odds for each Wolf Cup season, curated manually.
 *
 * Workflow: Jaquint (acting league book) posts a board in GroupMe. Josh pastes
 * the screenshot in chat and Claude appends entries here. No admin UI, no DB
 * table — low-churn data that lives as static TypeScript alongside
 * history-data.ts.
 *
 * `timeline` is append-only. The last entry per player is the current line;
 * the first entry is the opening line. Movement is derived client-side from
 * first vs. last.
 *
 * Names are normalized via `normalizePlayerName()` (see history-data.ts) so
 * nickname forms like "Moses" or "Ronnie A." resolve to the canonical DB name.
 */

export const SEASON_ODDS: {
  year: number;
  openedAt: string; // ISO date (YYYY-MM-DD)
  players: {
    name: string;
    timeline: { odds: number; asOf: string; note?: string }[];
  }[];
}[] = [
  {
    year: 2026,
    openedAt: '2026-04-17',
    players: [
      { name: 'Matt Jaquint', timeline: [{ odds: 250, asOf: '2026-04-17' }] },
      { name: 'Moses', timeline: [{ odds: 300, asOf: '2026-04-17' }] },
      { name: 'Jay Patterson', timeline: [{ odds: 350, asOf: '2026-04-17' }] },
      { name: 'Tim Biller', timeline: [{ odds: 350, asOf: '2026-04-17' }] },
      { name: 'Ronnie A.', timeline: [{ odds: 400, asOf: '2026-04-17' }] },
      { name: 'Ben McGinnis', timeline: [{ odds: 450, asOf: '2026-04-17', note: 'Ole Peach' }] },
      { name: 'Jeff Madden', timeline: [{ odds: 450, asOf: '2026-04-17' }] },
      { name: 'Josh Stoll', timeline: [{ odds: 500, asOf: '2026-04-17' }] },
      { name: 'Mike Bonner', timeline: [{ odds: 500, asOf: '2026-04-17' }] },
      { name: 'Chris McNeely', timeline: [{ odds: 550, asOf: '2026-04-17', note: 'Bagger' }] },
      { name: 'Scotty Pierson', timeline: [{ odds: 550, asOf: '2026-04-17' }] },
      { name: 'Bob Marshall', timeline: [{ odds: 600, asOf: '2026-04-17', note: 'Birdie Marshall' }] },
      { name: 'Kyle Cox', timeline: [{ odds: 750, asOf: '2026-04-17' }] },
      { name: 'Sean Wilson', timeline: [{ odds: 800, asOf: '2026-04-17' }] },
      { name: 'Matt White', timeline: [{ odds: 900, asOf: '2026-04-17' }] },
      { name: 'Jeff Biederman', timeline: [{ odds: 1000, asOf: '2026-04-17' }] },
      { name: 'Chris Keaton', timeline: [{ odds: 1200, asOf: '2026-04-17', note: 'The Factor' }] },
    ],
  },
];
