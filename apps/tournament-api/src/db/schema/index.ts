// Domain schemas re-exported here as they are added (T2.1+).
export { players, type Player } from './players.js';
export { deviceBindings, type DeviceBinding } from './device_bindings.js';
export { oauthIdentities, type OauthIdentity } from './oauth_identities.js';
export { sessions, type Session } from './auth.js';
export { courses, type Course } from './courses.js';
export { courseRevisions, type CourseRevision } from './courses.js';
export { courseTees, type CourseTee } from './courses.js';
export { courseHoles, type CourseHole } from './courses.js';
// T3-1 event/group/rule/subgame schema
export { events, type Event } from './events.js';
export { eventRounds, type EventRound } from './events.js';
export { invites, type Invite } from './events.js';
export { eventScorerDesignees, type EventScorerDesignee } from './events.js';
export { playerJoinCodes, type PlayerJoinCode } from './events.js';
export { eventHandicaps, type EventHandicap } from './events.js';
export { groups, type Group } from './groups.js';
export { groupMembers, type GroupMember } from './groups.js';
export { ruleSets, type RuleSet } from './rules.js';
export { ruleSetRevisions, type RuleSetRevision } from './rules.js';
export { subGames, type SubGame } from './subgames.js';
export { subGameParticipants, type SubGameParticipant } from './subgames.js';
export { subGameResults, type SubGameResult } from './subgames.js';
// T4-2 pairings schema
export { pairings, type Pairing } from './pairings.js';
export { pairingMembers, type PairingMember } from './pairings.js';
// T5-1 scoring + audit schema
export { rounds, type Round } from './scoring.js';
export { holeScores, type HoleScore } from './scoring.js';
export { scoreCorrections, type ScoreCorrection } from './scoring.js';
export { roundStates, type RoundState } from './scoring.js';
export { scorerAssignments, type ScorerAssignment } from './scoring.js';
export { auditLog, type AuditLog } from './audit.js';
// T6-3 cross-foursome individual bets schema
export { individualBets, type IndividualBet } from './bets.js';
export { individualBetRounds, type IndividualBetRound } from './bets.js';
export { individualBetPresses, type IndividualBetPress } from './bets.js';
// "The Action" betting schema (FR1–FR54) — NEW, additive; does NOT extend individual_bets
export { bets, type Bet } from './action-bets.js';
export { betSides, type BetSide } from './action-bets.js';
// T6-4 team press log schema
export { teamPressLog, type TeamPressLog } from './press.js';
// T7-4 gallery_photos schema
export { galleryPhotos, type GalleryPhoto } from './gallery.js';
// T8-1 activity spine
export { activity, type Activity } from './activity.js';
