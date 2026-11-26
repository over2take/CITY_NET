// SEND TO in the GM's tray (8b7b; approved mockup docs/mockups/send-to.html, 2026-11-26, all as recommended). The server
// keeps each damage roll that reached no target and tells the GM's tray alone (backend tokens/sendTo.js, 8b7a); here is who
// the picker offers, what it says, and what is sent. The tokens on the map and floor the GM is looking at, a running fight's
// first; each FULL or HALF.

/** A kept roll as the server tells the GM's tray of it: what it was, and the tokens it went to, as the log names them. */
export interface RollSend {
  rollId: number;
  what: string;
  from: string;
  total: number;
  types: string[];
  sent: string[];
}

/** One the picker offers: a token, its name, whether it is in the fight running here. */
export interface SendTarget { id: number; name: string; inFight: boolean }

/** What the server says one would take (sockets sendRollPreview), FULL or HALF, and whether it went there already. */
export interface SendPreview { locationId: number; half: boolean; name: string; taken: number; words: string; sent: boolean }

/** What a SEND sends: each token picked, FULL or HALF. */
export type SendPicks = Record<number, 'full' | 'half'>;

/** The most the server takes in one ask (tokens/sendTo.js MOST_TARGETS). */
export const MOST_AT_ONCE = 30;

const TOKEN_SHAPES = ['rhombus', 'enemy_rhombus', 'friendly_rhombus'];

/** A line's kept roll, where it has one: only the GM's tray is told. */
export const sendOf = (line: unknown): RollSend | null => {
  const send = line && typeof line === 'object' ? (line as { send?: unknown }).send : null;
  return send && typeof send === 'object' && Number.isInteger((send as RollSend).rollId) ? send as RollSend : null;
};

/**
 * The tokens the picker offers: every token on the map and floor the GM is looking at (`battleMapId` null for the city's),
 * as the map draws them; those in the fight running there first (`combatants`: an NPC's "npc:12", a player's their
 * name), the rest after, each kept in map order.
 */
export function sendTargets(
  locations: { id: number; name?: string | null; shape?: string; owner?: string | null; battle_map_id?: number | null; floor_index?: number | null }[],
  scene: { battleMapId: number | null; floorIndex: number | null },
  combatants?: { id: string }[] | null,
): SendTarget[] {
  const fighting = new Set((combatants ?? []).map((c) => String(c.id)));
  const here = (l: (typeof locations)[number]) => (scene.battleMapId === null
    ? l.battle_map_id == null
    : Number(l.battle_map_id) === Number(scene.battleMapId) && Number(l.floor_index ?? 0) === Number(scene.floorIndex ?? 0));
  const all = locations
    .filter((l) => TOKEN_SHAPES.includes(String(l.shape)) && here(l))
    .map((l) => ({
      id: l.id,
      name: String(l.name || (l.shape === 'rhombus' ? l.owner : '') || 'TOKEN').toUpperCase(),
      inFight: fighting.has(`npc:${l.id}`) || (l.shape === 'rhombus' && !!l.owner && fighting.has(String(l.owner))),
    }));
  return [...all.filter((t) => t.inFight), ...all.filter((t) => !t.inFight)];
}

/** The picker's head: "SEND FIREBALL (28 FIRE) TO", "SEND ARCANE BOLT (12, NO TYPE) TO". */
export const sendHeading = (send: RollSend) =>
  `SEND ${send.what.toUpperCase()} (${send.total}${send.types.length ? ` ${send.types.join(' + ')}` : ', NO TYPE'}) TO`;

/** Under the line: "SENT → GOBLIN A, FIRE IMP", or nothing where it went nowhere yet. */
export const sentWords = (send: RollSend) => (send.sent.length ? `SENT → ${send.sent.join(', ')}` : '');

/** The tokens picked as the server takes them, in the order the picker lists them. */
export const picksToTargets = (picks: SendPicks, listed: SendTarget[]) =>
  listed.filter((t) => picks[t.id]).map((t) => ({ locationId: t.id, half: picks[t.id] === 'half' }));

/** A token ticked or unticked: ticked FULL. */
export const withTicked = (picks: SendPicks, id: number): SendPicks => {
  const { [id]: was, ...rest } = picks;
  return was ? rest : { ...picks, [id]: 'full' };
};

/** Ids in asks the server takes, MOST_AT_ONCE each. */
export const inChunks = (ids: number[], size = MOST_AT_ONCE): number[][] => {
  const out: number[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
};

/** The history's lines with a kept roll's news (rollSent): where it went, on the lines it belongs to. */
export const withSendNews = <T>(lines: T[], news: RollSend): T[] =>
  lines.map((l) => (sendOf(l)?.rollId === news.rollId ? { ...l, send: news } : l));
