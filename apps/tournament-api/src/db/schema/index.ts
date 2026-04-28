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
export { groups, type Group } from './groups.js';
export { groupMembers, type GroupMember } from './groups.js';
export { ruleSets, type RuleSet } from './rules.js';
export { ruleSetRevisions, type RuleSetRevision } from './rules.js';
export { subGames, type SubGame } from './subgames.js';
export { subGameParticipants, type SubGameParticipant } from './subgames.js';
// T4-2 pairings schema
export { pairings, type Pairing } from './pairings.js';
export { pairingMembers, type PairingMember } from './pairings.js';
