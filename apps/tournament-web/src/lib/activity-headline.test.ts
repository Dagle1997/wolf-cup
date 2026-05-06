import { describe, expect, test } from 'vitest';
import {
  buildActivityHeadline,
  type HeadlineSurface,
} from './activity-headline';
import type { ActivityRow } from '../providers/activity-feed-provider';

function makeRow(
  type: string,
  extra: Record<string, unknown> = {},
): ActivityRow {
  return {
    id: `row-${type}`,
    createdAt: 1_000,
    event: { type, eventId: 'evt-test', ...extra },
  };
}

describe('buildActivityHeadline — score.committed surfaces', () => {
  const row = makeRow('score.committed', {
    playerId: 'p-rick',
    grossStrokes: 3,
    holeNumber: 7,
    par: 4,
    toPar: -1,
    isBirdieOrBetter: true,
    scorerPlayerId: 'p-rick',
    roundId: 'r-1',
  });

  test('toast surface includes 🐦 emoji + exclamation', () => {
    expect(buildActivityHeadline(row, 'toast')).toMatch(/🐦/);
    expect(buildActivityHeadline(row, 'toast')).toMatch(/!$/);
    expect(buildActivityHeadline(row, 'toast')).toMatch(/birdie/);
  });

  test('feed surface drops emoji + exclamation', () => {
    expect(buildActivityHeadline(row, 'feed')).not.toMatch(/🐦/);
    expect(buildActivityHeadline(row, 'feed')).not.toMatch(/!$/);
    expect(buildActivityHeadline(row, 'feed')).toMatch(/birdie/);
  });
});

describe('buildActivityHeadline — toPar descriptor mapping', () => {
  const cases: Array<[number, string]> = [
    [-5, 'condor'], // < -4 floor
    [-4, 'condor'],
    [-3, 'albatross'],
    [-2, 'eagle'],
    [-1, 'birdie'],
    [0, 'par'],
    [1, 'bogey'],
    [2, 'double bogey'],
    [3, 'triple bogey'],
    [4, '+4'],
    [10, '+10'],
  ];
  for (const [toPar, expected] of cases) {
    test(`toPar=${toPar} → "${expected}"`, () => {
      const row = makeRow('score.committed', {
        playerId: 'p',
        grossStrokes: 5,
        holeNumber: 1,
        par: 4,
        toPar,
        isBirdieOrBetter: toPar < 0,
        scorerPlayerId: 'p',
        roundId: 'r',
      });
      const headline = buildActivityHeadline(row, 'feed');
      expect(headline).toContain(expected);
    });
  }
});

describe('buildActivityHeadline — press.auto_fired by surface', () => {
  const row = makeRow('press.auto_fired', {
    triggerHole: 5,
    team: 'teamA',
    multiplier: 2,
    trigger: 'down_2',
    roundId: 'r',
  });

  test('toast surface ⚡ + colon-prefix team', () => {
    expect(buildActivityHeadline(row, 'toast')).toMatch(/⚡/);
    expect(buildActivityHeadline(row, 'toast')).toMatch(/teamA/);
  });

  test('banner surface terse (no emoji)', () => {
    const banner = buildActivityHeadline(row, 'banner');
    expect(banner).not.toMatch(/⚡/);
    expect(banner).toMatch(/Auto-press fired/);
    expect(banner).toMatch(/teamA/);
    expect(banner).toMatch(/2x/);
  });

  test('feed surface neutral (no emoji)', () => {
    const feed = buildActivityHeadline(row, 'feed');
    expect(feed).not.toMatch(/⚡/);
    expect(feed).toMatch(/Auto-press fired on hole 5/);
  });
});

describe('buildActivityHeadline — press.manual_fired by surface', () => {
  const row = makeRow('press.manual_fired', {
    fromHole: 5,
    team: 'teamA',
    multiplier: 2,
    filedByPlayerId: 'p',
    roundId: 'r',
  });

  test('toast surface 🎯', () => {
    expect(buildActivityHeadline(row, 'toast')).toMatch(/🎯/);
  });

  test('feed surface no emoji', () => {
    expect(buildActivityHeadline(row, 'feed')).not.toMatch(/🎯/);
    expect(buildActivityHeadline(row, 'feed')).toMatch(/teamA pressed from hole 5/);
  });
});

describe('buildActivityHeadline — award.triggered by surface', () => {
  const row = makeRow('award.triggered', {
    awardType: 'first_birdie_of_event',
    playerId: 'p',
    context: { holeNumber: 7, grossStrokes: 3, par: 4 },
    roundId: 'r',
  });

  test('toast surface emoji matches award type — birdie gets 🐦', () => {
    expect(buildActivityHeadline(row, 'toast')).toMatch(/🐦/);
    expect(buildActivityHeadline(row, 'toast')).not.toMatch(/🦅/);
    expect(buildActivityHeadline(row, 'toast')).toMatch(/birdie/);
  });

  test('toast surface emoji matches award type — eagle gets 🦅', () => {
    const eagleRow = makeRow('award.triggered', {
      awardType: 'first_eagle_of_event',
      playerId: 'p',
      context: { holeNumber: 7, grossStrokes: 3, par: 5 },
      roundId: 'r',
    });
    expect(buildActivityHeadline(eagleRow, 'toast')).toMatch(/🦅/);
    expect(buildActivityHeadline(eagleRow, 'toast')).not.toMatch(/🐦/);
  });

  test('feed surface no emoji (icon column has the trophy)', () => {
    const feed = buildActivityHeadline(row, 'feed');
    expect(feed).not.toMatch(/🦅/);
    expect(feed).not.toMatch(/🏆/);
    expect(feed).toMatch(/First birdie of the trip/);
  });

  test('eagle award uses eagle label', () => {
    const eagleRow = makeRow('award.triggered', {
      awardType: 'first_eagle_of_event',
      playerId: 'p',
      context: { holeNumber: 7, grossStrokes: 3, par: 5 },
      roundId: 'r',
    });
    expect(buildActivityHeadline(eagleRow, 'feed')).toMatch(/eagle/);
  });
});

describe('buildActivityHeadline — score.corrected (feed-only with prior/new inline)', () => {
  test('contains both prior and new gross + actor attribution', () => {
    const row = makeRow('score.corrected', {
      playerId: 'p-rick',
      holeNumber: 7,
      priorGross: 5,
      newGross: 4,
      actorPlayerId: 'p-organizer',
      roundId: 'r',
    });
    const headline = buildActivityHeadline(row, 'feed');
    expect(headline).toMatch(/Corrected by p-organizer/);
    expect(headline).toMatch(/p-rick/);
    expect(headline).toMatch(/hole 7/);
    expect(headline).toMatch(/5 → 4/);
  });
});

describe('buildActivityHeadline — uniform-copy types', () => {
  // Types that render the same string across all surfaces.
  const uniformCases: Array<[string, Record<string, unknown>, string]> = [
    ['round.finalized', { roundId: 'r' }, 'Round finalized'],
    ['round.cancelled', { roundId: 'r' }, 'Round cancelled'],
    ['press.manual_undone', { roundId: 'r', pressId: 'pr', undoneByPlayerId: 'p' }, 'Press undone'],
    ['rule_set.revised', { ruleSetId: 'rs', revisionId: 'rsr' }, 'Rule set revised'],
    ['gallery.uploaded', { photoId: 'ph', actorPlayerId: 'p' }, 'Photo uploaded'],
  ];
  for (const [type, extra, expected] of uniformCases) {
    test(`${type} renders "${expected}" across surfaces`, () => {
      const row = makeRow(type, extra);
      for (const surface of ['toast', 'banner', 'feed'] as HeadlineSurface[]) {
        expect(buildActivityHeadline(row, surface)).toBe(expected);
      }
    });
  }
});

describe('buildActivityHeadline — bet.created + subgame.computed dollars', () => {
  test('bet.created formats stakePerHoleCents as dollars', () => {
    const row = makeRow('bet.created', {
      betId: 'b',
      playerAId: 'pa',
      playerBId: 'pb',
      betType: 'match-play',
      stakePerHoleCents: 500,
      actorPlayerId: 'p',
    });
    const headline = buildActivityHeadline(row, 'feed');
    expect(headline).toMatch(/match-play/);
    expect(headline).toMatch(/\$5\.00\/hole/);
  });

  test('subgame.computed formats totalPotCents as dollars', () => {
    const row = makeRow('subgame.computed', {
      subGameId: 'sg',
      subGameResultId: 'sgr',
      totalPotCents: 4000,
      actorPlayerId: 'p',
      roundId: 'r',
    });
    const headline = buildActivityHeadline(row, 'feed');
    expect(headline).toMatch(/sg/);
    expect(headline).toMatch(/\$40\.00 pot/);
  });
});

describe('buildActivityHeadline — scorer.transferred', () => {
  test('renders fromId + toId + foursome number', () => {
    const row = makeRow('scorer.transferred', {
      fromPlayerId: 'p-from',
      toPlayerId: 'p-to',
      foursomeNumber: 2,
      actorPlayerId: 'p-actor',
      roundId: 'r',
    });
    const headline = buildActivityHeadline(row, 'feed');
    expect(headline).toMatch(/p-from → p-to/);
    expect(headline).toMatch(/foursome 2/);
  });
});
