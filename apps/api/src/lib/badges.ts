/**
 * Badge computation — pure functions that derive awards from historical data.
 * No database access; all inputs are passed in.
 */
import { normalizePlayerName, CUSTOM_AWARDS } from '../db/history-data.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AwardRecipient = {
  playerName: string;
  years: number[];
  detail: string;
};

export type Award = {
  id: string;
  emoji: string;
  name: string;
  category: 'hall_of_fame' | 'superlatives';
  description: string;
  recipients: AwardRecipient[];
};

export type PlayerBadge = {
  id: string;
  emoji: string;
  name: string;
  years: number[];
};

type Champion = { year: number; playerName: string };
type Standing = { year: number; standings: { name: string; rank: number }[] };
type CashEntry = { year: number; moneyMan: { name: string; cash: number }; philanthropist: { name: string; cash: number } };
type IronmanEntry = { year: number; maxRounds: number; perfectAttendance: string[] };
type CashRecord = { name: string; year: number; cash: number };

// ---------------------------------------------------------------------------
// Individual compute functions
// ---------------------------------------------------------------------------

/** Players who won consecutive championships */
export function computeBackToBack(champions: Champion[]): { playerName: string; years: [number, number][] }[] {
  // Sort by year ascending
  const sorted = [...champions].sort((a, b) => a.year - b.year);
  const streaks = new Map<string, [number, number][]>();
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i]!.playerName === sorted[i + 1]!.playerName && sorted[i + 1]!.year === sorted[i]!.year + 1) {
      const name = sorted[i]!.playerName;
      const arr = streaks.get(name) ?? [];
      arr.push([sorted[i]!.year, sorted[i + 1]!.year]);
      streaks.set(name, arr);
    }
  }
  return [...streaks.entries()].map(([playerName, years]) => ({ playerName, years }));
}

/** Players with 4+ championship wins */
export function computeDynasty(champions: Champion[]): { playerName: string; years: number[] }[] {
  const map = new Map<string, number[]>();
  for (const c of champions) {
    const arr = map.get(c.playerName) ?? [];
    arr.push(c.year);
    map.set(c.playerName, arr);
  }
  const result: { playerName: string; years: number[] }[] = [];
  for (const [playerName, years] of map) {
    if (years.length >= 4) {
      result.push({ playerName, years: years.sort((a, b) => a - b) });
    }
  }
  return result;
}

/** Player with the MOST 2nd-place finishes who has NEVER won a championship */
export function computeRickieFowler(
  standings: Standing[],
  champions: Champion[],
): { playerName: string; runnerUpCount: number; years: number[] }[] {
  const champNames = new Set(champions.map((c) => c.playerName));

  // Count rank-2 finishes per player
  const runnerUps = new Map<string, number[]>();
  for (const s of standings) {
    for (const st of s.standings) {
      if (st.rank === 2) {
        const arr = runnerUps.get(st.name) ?? [];
        arr.push(s.year);
        runnerUps.set(st.name, arr);
      }
    }
  }

  // Filter out champions, find max count
  let maxCount = 0;
  for (const [name, years] of runnerUps) {
    if (!champNames.has(name) && years.length > maxCount) {
      maxCount = years.length;
    }
  }

  if (maxCount === 0) return [];

  const result: { playerName: string; runnerUpCount: number; years: number[] }[] = [];
  for (const [name, years] of runnerUps) {
    if (!champNames.has(name) && years.length === maxCount) {
      result.push({ playerName: name, runnerUpCount: maxCount, years: years.sort((a, b) => a - b) });
    }
  }
  return result;
}

/** Players with 2+ 3rd-place finishes */
export function computePhBalance(standings: Standing[]): { playerName: string; thirdPlaceCount: number; years: number[] }[] {
  const thirdPlaces = new Map<string, number[]>();
  for (const s of standings) {
    for (const st of s.standings) {
      if (st.rank === 3) {
        const arr = thirdPlaces.get(st.name) ?? [];
        arr.push(s.year);
        thirdPlaces.set(st.name, arr);
      }
    }
  }

  const result: { playerName: string; thirdPlaceCount: number; years: number[] }[] = [];
  for (const [name, years] of thirdPlaces) {
    if (years.length >= 2) {
      result.push({ playerName: name, thirdPlaceCount: years.length, years: years.sort((a, b) => a - b) });
    }
  }
  return result;
}

/** Per-season biggest cash winner, grouped by player */
export function computeMoneyMan(cashData: CashEntry[]): { playerName: string; count: number; years: number[] }[] {
  const map = new Map<string, number[]>();
  for (const c of cashData) {
    const arr = map.get(c.moneyMan.name) ?? [];
    arr.push(c.year);
    map.set(c.moneyMan.name, arr);
  }
  return [...map.entries()].map(([playerName, years]) => ({
    playerName,
    count: years.length,
    years: years.sort((a, b) => a - b),
  }));
}

/** Per-season worst cash loser, grouped by player */
export function computePhilanthropist(cashData: CashEntry[]): { playerName: string; count: number; years: number[] }[] {
  const map = new Map<string, number[]>();
  for (const c of cashData) {
    const arr = map.get(c.philanthropist.name) ?? [];
    arr.push(c.year);
    map.set(c.philanthropist.name, arr);
  }
  return [...map.entries()].map(([playerName, years]) => ({
    playerName,
    count: years.length,
    years: years.sort((a, b) => a - b),
  }));
}

/** Players on both the 2015 AND 2025 rosters (still active in the league) */
export function computeOG(rosters: Record<number, string[]>): string[] {
  const roster2015 = rosters[2015] ?? [];
  const roster2025 = rosters[2025] ?? [];
  const set2025 = new Set(roster2025);
  return roster2015.filter((name) => set2025.has(name));
}

/** Players present in ALL year rosters */
export function computeEverySeason(rosters: Record<number, string[]>): string[] {
  const years = Object.keys(rosters).map(Number);
  if (years.length === 0) return [];

  // Start with first year's roster, intersect with all others
  const candidates = new Set(rosters[years[0]!]!);
  for (let i = 1; i < years.length; i++) {
    const yearRoster = new Set(rosters[years[i]!]!);
    for (const name of candidates) {
      if (!yearRoster.has(name)) candidates.delete(name);
    }
  }
  return [...candidates];
}

/** Perfect attendance seasons */
export function computeIronman(ironmanData: IronmanEntry[]): { playerName: string; year: number; rounds: number }[] {
  const result: { playerName: string; year: number; rounds: number }[] = [];
  for (const entry of ironmanData) {
    for (const name of entry.perfectAttendance) {
      result.push({ playerName: name, year: entry.year, rounds: entry.maxRounds });
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Aggregate: compute all awards
// ---------------------------------------------------------------------------

export function computeAllAwards(
  champions: Champion[],
  standings: Standing[],
  rosters: Record<number, string[]>,
  cashData: CashEntry[],
  ironmanData: IronmanEntry[],
  cashRecords?: { biggestWin: CashRecord; biggestLoss: CashRecord },
): Award[] {
  const awards: Award[] = [];

  // --- Hall of Fame ---

  const dynasty = computeDynasty(champions);
  if (dynasty.length > 0) {
    awards.push({
      id: 'dynasty',
      emoji: '🏆',
      name: 'Dynasty',
      category: 'hall_of_fame',
      description: 'Awarded to players with 4 or more Wolf Cup championship wins.',
      recipients: dynasty.map((d) => ({
        playerName: d.playerName,
        years: d.years,
        detail: `${d.years.length}× Champion`,
      })),
    });
  }

  const backToBack = computeBackToBack(champions);
  if (backToBack.length > 0) {
    awards.push({
      id: 'back_to_back',
      emoji: '🔁',
      name: 'Back to Back',
      category: 'hall_of_fame',
      description: 'Won the Wolf Cup in consecutive years.',
      recipients: backToBack.map((b) => ({
        playerName: b.playerName,
        years: b.years.flatMap(([y1, y2]) => [y1, y2]).filter((y, i, a) => a.indexOf(y) === i).sort((a, b) => a - b),
        detail: b.years.map(([y1, y2]) => `${y1}–${y2}`).join(', '),
      })),
    });
  }

  const everySeason = computeEverySeason(rosters);
  if (everySeason.length > 0) {
    const allYears = Object.keys(rosters).map(Number).sort((a, b) => a - b);
    awards.push({
      id: 'every_season',
      emoji: '🎖️',
      name: 'Every Season',
      category: 'hall_of_fame',
      description: `Played in all ${allYears.length} Wolf Cup seasons (${allYears[0]}–${allYears[allYears.length - 1]}).`,
      recipients: everySeason.map((name) => ({
        playerName: name,
        years: allYears,
        detail: `${allYears.length}/${allYears.length} seasons`,
      })),
    });
  }

  const og = computeOG(rosters);
  if (og.length > 0) {
    awards.push({
      id: 'og',
      emoji: '🍺',
      name: 'OG — Est. 2015',
      category: 'hall_of_fame',
      description: 'Played in the inaugural 2015 season and still active on the 2025 roster.',
      recipients: og.map((name) => ({
        playerName: name,
        years: [2015],
        detail: 'Day one',
      })),
    });
  }

  const ironman = computeIronman(ironmanData);
  if (ironman.length > 0) {
    awards.push({
      id: 'ironman',
      emoji: '💪',
      name: 'Ironman',
      category: 'hall_of_fame',
      description: 'Never missed a regular season round in a given year.',
      recipients: ironman.map((im) => ({
        playerName: im.playerName,
        years: [im.year],
        detail: `${im.rounds}/${im.rounds} rounds — ${im.year}`,
      })),
    });
  }

  // --- Superlatives ---

  const rickie = computeRickieFowler(standings, champions);
  if (rickie.length > 0) {
    awards.push({
      id: 'rickie_fowler',
      emoji: '🥈',
      name: 'Rickie Fowler',
      category: 'superlatives',
      description: 'Most 2nd-place finishes without ever winning a title. The eternal bridesmaid.',
      recipients: rickie.map((r) => ({
        playerName: r.playerName,
        years: r.years,
        detail: `${r.runnerUpCount}× Runner-Up, 0 Titles`,
      })),
    });
  }

  const phBalance = computePhBalance(standings);
  if (phBalance.length > 0) {
    awards.push({
      id: 'ph_balance',
      emoji: '⚖️',
      name: 'pH Balance',
      category: 'superlatives',
      description: 'Multiple 3rd-place finishes. Perfectly balanced — as all things should be.',
      recipients: phBalance.map((pb) => ({
        playerName: pb.playerName,
        years: pb.years,
        detail: `${pb.thirdPlaceCount}× 3rd Place`,
      })),
    });
  }

  const moneyMan = computeMoneyMan(cashData);
  if (moneyMan.length > 0) {
    awards.push({
      id: 'money_man',
      emoji: '💰',
      name: 'Money Man',
      category: 'superlatives',
      description: 'Biggest cash earner of the season. The wolf who always gets paid.',
      recipients: moneyMan.map((mm) => ({
        playerName: mm.playerName,
        years: mm.years,
        detail: mm.years.map((y) => {
          const entry = cashData.find((c) => c.year === y);
          return entry ? `+$${entry.moneyMan.cash}` : '';
        }).join(', '),
      })),
    });
  }

  const philanthropist = computePhilanthropist(cashData);
  if (philanthropist.length > 0) {
    awards.push({
      id: 'philanthropist',
      emoji: '💸',
      name: 'Philanthropist',
      category: 'superlatives',
      description: 'Worst cash total of the season. Generously funding everyone else\'s winnings.',
      recipients: philanthropist.map((ph) => ({
        playerName: ph.playerName,
        years: ph.years,
        detail: ph.years.map((y) => {
          const entry = cashData.find((c) => c.year === y);
          return entry ? `-$${Math.abs(entry.philanthropist.cash)}` : '';
        }).join(', '),
      })),
    });
  }

  if (cashRecords) {
    awards.push({
      id: 'biggest_season_win',
      emoji: '🤑',
      name: 'Season High Roller',
      category: 'superlatives',
      description: 'Most money won in a single season. All-time record.',
      recipients: [{
        playerName: cashRecords.biggestWin.name,
        years: [cashRecords.biggestWin.year],
        detail: `+$${cashRecords.biggestWin.cash}`,
      }],
    });

    awards.push({
      id: 'biggest_season_loss',
      emoji: '🕳️',
      name: 'Season Rock Bottom',
      category: 'superlatives',
      description: 'Most money lost in a single season. All-time record.',
      recipients: [{
        playerName: cashRecords.biggestLoss.name,
        years: [cashRecords.biggestLoss.year],
        detail: `-$${Math.abs(cashRecords.biggestLoss.cash)}`,
      }],
    });
  }

  // Custom/joke awards
  for (const custom of CUSTOM_AWARDS) {
    awards.push({ ...custom, recipients: custom.recipients.map((r) => ({ ...r })) });
  }

  // Normalize all recipient names to match DB player names
  for (const award of awards) {
    for (const r of award.recipients) {
      r.playerName = normalizePlayerName(r.playerName);
    }
  }

  return awards;
}

// ---------------------------------------------------------------------------
// Per-player badge computation (for stats page — active players only)
// ---------------------------------------------------------------------------

export function computePlayerBadges(
  playerName: string,
  awards: Award[],
): PlayerBadge[] {
  const badges: PlayerBadge[] = [];
  for (const award of awards) {
    // Skip dynasty — championship trophies rendered separately
    if (award.id === 'dynasty') continue;
    const recipient = award.recipients.find((r) => r.playerName === playerName);
    if (recipient) {
      badges.push({
        id: award.id,
        emoji: award.emoji,
        name: award.name,
        years: recipient.years,
      });
    }
  }
  return badges;
}
