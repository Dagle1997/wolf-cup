/**
 * T8-3 shared headline helper for activity surfaces (Toast / Banner /
 * Feed). Each surface has slightly different copy needs:
 *   - Toast: emoji-heavy, terse, action-celebratory
 *   - Banner: terse, money-focused
 *   - Feed: full historical record with all variants + score-correction
 *     prior/new inline rendering
 *
 * Player-name hydration: the API feed read service injects `*Name` fields
 * (playerName, actorPlayerName, …) alongside each player-id field. The headline
 * builders prefer those names via `nameOf`, falling back to the raw id only when
 * a name is absent (un-hydrated row / player not found).
 */

import type { ActivityRow } from '../providers/activity-feed-provider';

export type HeadlineSurface = 'toast' | 'banner' | 'feed';

/**
 * Map `toPar` to the descriptor used in score.committed and award.triggered
 * headlines. Floor is `≤-4` (= condor) per T8-1's Zod min(-4) bound; the
 * helper is defensive against a future relaxation of that bound.
 */
function toParDescriptor(toPar: number): string {
  if (!Number.isFinite(toPar)) return '?';
  if (toPar <= -4) return 'condor';
  if (toPar === -3) return 'albatross';
  if (toPar === -2) return 'eagle';
  if (toPar === -1) return 'birdie';
  if (toPar === 0) return 'par';
  if (toPar === 1) return 'bogey';
  if (toPar === 2) return 'double bogey';
  if (toPar === 3) return 'triple bogey';
  return `+${toPar}`;
}

/**
 * Defensive numeric coercion — returns the number if it's finite,
 * otherwise the literal string `'?'`. Used in headline rendering to
 * avoid emitting `NaN` (e.g. `"$NaN/hole"`) when upstream payloads
 * are missing/corrupt. T8-1's Zod schema validates payloads before
 * insert, so this defends against a future schema relaxation or a
 * bypass-the-emitter path. (codex impl-codex round-1 Med #2.)
 */
function safeNumber(v: unknown): number | '?' {
  const n = Number(v);
  return Number.isFinite(n) ? n : '?';
}

/**
 * Prefer the hydrated display name (`*Name`, injected by the API feed read
 * service) over the raw player UUID. Falls back to the id if a name is absent
 * (un-hydrated row / player not found).
 */
function nameOf(
  ev: ActivityRow['event'],
  idKey: string,
  nameKey: string,
): string {
  const name = ev[nameKey];
  if (typeof name === 'string' && name.length > 0) return name;
  return String(ev[idKey]);
}

function buildScoreCommittedHeadline(
  ev: ActivityRow['event'],
  surface: HeadlineSurface,
): string {
  const playerId = nameOf(ev, 'playerId', 'playerName');
  const grossStrokes = safeNumber(ev['grossStrokes']);
  const holeNumber = safeNumber(ev['holeNumber']);
  const toPar = Number(ev['toPar']);
  const descriptor = toParDescriptor(toPar);
  if (surface === 'toast') {
    // Toast only fires for isBirdieOrBetter (filtered upstream in
    // tournament-toast.tsx), so toPar is in [-4, -1] here. Birdie
    // gets 🐦; eagle/albatross/condor get 🦅 (codex party-codex
    // round-1 Med #2 — the prior single-emoji behavior was wrong).
    const emoji = toPar === -1 ? '🐦' : '🦅';
    return `${emoji} ${playerId} scored ${grossStrokes} on hole ${holeNumber} — ${descriptor}!`;
  }
  return `${playerId} scored ${grossStrokes} on hole ${holeNumber} — ${descriptor}`;
}

function buildPressAutoFiredHeadline(
  ev: ActivityRow['event'],
  surface: HeadlineSurface,
): string {
  const triggerHole = safeNumber(ev['triggerHole']);
  const team = String(ev['team'] ?? 'team');
  const multiplier = safeNumber(ev['multiplier']);
  if (surface === 'toast') {
    return `⚡ Auto-press fired on hole ${triggerHole}: ${team} (${multiplier}x)`;
  }
  if (surface === 'banner') {
    return `Auto-press fired (hole ${triggerHole}, ${team} ${multiplier}x)`;
  }
  return `Auto-press fired on hole ${triggerHole} (${team} ${multiplier}x)`;
}

function buildPressManualFiredHeadline(
  ev: ActivityRow['event'],
  surface: HeadlineSurface,
): string {
  const fromHole = safeNumber(ev['fromHole']);
  const team = String(ev['team']);
  const multiplier = safeNumber(ev['multiplier']);
  if (surface === 'toast') {
    return `🎯 ${team} pressed from hole ${fromHole} (${multiplier}x)`;
  }
  return `${team} pressed from hole ${fromHole} (${multiplier}x)`;
}

function buildAwardTriggeredHeadline(
  ev: ActivityRow['event'],
  surface: HeadlineSurface,
): string {
  const awardType = String(ev['awardType']);
  const ctx = ev['context'] as { holeNumber?: number } | undefined;
  const holeNumber = ctx?.holeNumber ?? '?';
  const isEagle = awardType === 'first_eagle_of_event';
  const label = isEagle ? 'eagle' : 'birdie';
  if (surface === 'toast') {
    // Match the emoji to the award type — 🦅 for eagle, 🐦 for birdie.
    // Prior code used 🦅 for both, which was semantically wrong on a
    // first-birdie award (codex party-codex round-1 Med #1).
    const emoji = isEagle ? '🦅' : '🐦';
    return `${emoji} First ${label} of the trip — hole ${holeNumber}!`;
  }
  return `First ${label} of the trip — hole ${holeNumber}!`;
}

function buildScoreCorrectedHeadline(ev: ActivityRow['event']): string {
  // Only the feed renders score.corrected. Toast filters it out;
  // Banner doesn't include score.corrected in its eligible set.
  const playerId = nameOf(ev, 'playerId', 'playerName');
  const holeNumber = safeNumber(ev['holeNumber']);
  const priorGross = safeNumber(ev['priorGross']);
  const newGross = safeNumber(ev['newGross']);
  const actorPlayerId = nameOf(ev, 'actorPlayerId', 'actorPlayerName');
  return `Corrected by ${actorPlayerId}: ${playerId} hole ${holeNumber}, ${priorGross} → ${newGross}`;
}

function buildScorerTransferredHeadline(ev: ActivityRow['event']): string {
  const fromPlayerId = nameOf(ev, 'fromPlayerId', 'fromPlayerName');
  const toPlayerId = nameOf(ev, 'toPlayerId', 'toPlayerName');
  const foursomeNumber = safeNumber(ev['foursomeNumber']);
  return `Scorer transferred: ${fromPlayerId} → ${toPlayerId} (foursome ${foursomeNumber})`;
}

function buildBetCreatedHeadline(ev: ActivityRow['event']): string {
  const betType = String(ev['betType']);
  const playerAId = nameOf(ev, 'playerAId', 'playerAName');
  const playerBId = nameOf(ev, 'playerBId', 'playerBName');
  const stakePerHoleCents = Number(ev['stakePerHoleCents']);
  const dollars = Number.isFinite(stakePerHoleCents)
    ? (stakePerHoleCents / 100).toFixed(2)
    : '?';
  return `New bet: ${betType} (${playerAId} vs ${playerBId}, $${dollars}/hole)`;
}

function buildSubgameComputedHeadline(ev: ActivityRow['event']): string {
  const subGameId = String(ev['subGameId']);
  const totalPotCents = Number(ev['totalPotCents']);
  const dollars = Number.isFinite(totalPotCents)
    ? (totalPotCents / 100).toFixed(2)
    : '?';
  return `Sub-game computed: ${subGameId} ($${dollars} pot)`;
}

export function buildActivityHeadline(
  row: ActivityRow,
  surface: HeadlineSurface,
): string {
  const ev = row.event;
  switch (ev.type) {
    case 'score.committed':
      return buildScoreCommittedHeadline(ev, surface);
    case 'score.corrected':
      return buildScoreCorrectedHeadline(ev);
    case 'scorer.transferred':
      return buildScorerTransferredHeadline(ev);
    case 'round.finalized':
      return 'Round finalized';
    case 'round.cancelled':
      return 'Round cancelled';
    case 'press.auto_fired':
      return buildPressAutoFiredHeadline(ev, surface);
    case 'press.manual_fired':
      return buildPressManualFiredHeadline(ev, surface);
    case 'press.manual_undone':
      return 'Press undone';
    case 'bet.created':
      return buildBetCreatedHeadline(ev);
    case 'rule_set.revised':
      return 'Rule set revised';
    case 'subgame.computed':
      return buildSubgameComputedHeadline(ev);
    case 'gallery.uploaded':
      return 'Photo uploaded';
    case 'award.triggered':
      return buildAwardTriggeredHeadline(ev, surface);
    default:
      return `Activity: ${ev.type}`;
  }
}
