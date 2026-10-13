// GIVE ITEM's window, as logic and requests (4g4a; approved mockup docs/mockups/give-item.html,
// 2026-10-12). The server says what the running game can give, places a gift and keeps the GIVEN
// list (backend/shops/give.js, sheets/giving.js, sheets/givenList.js, through the socket); this
// searches the list, says where a gift lands and why not, and shapes what is sent.

import { catalogueLabel, type ShopStock } from '../data/buildingTypes';
import { catalogueCurrencyFor, formatAmount } from './currencies';

/** One item the game can give, with what it's worth. */
export interface GivableItem { id: string; name: string; price: number }
/** A catalogue of them, as the server sends it ('givableItems'). */
export interface GivableCatalogue { catalogue: string; items: GivableItem[] }
/** An item as the window lists it: with its catalogue. */
export interface ListedItem extends GivableItem { catalogue: string }

/** Where a gift went on one sheet, as the server says (sheets/giving.js landing). */
export type Lands =
  | { shape: 'rows'; group: string; rows: number[] }
  | { shape: 'cyberware' }
  | { shape: 'inventory'; stacked: boolean };

/** One character a GIVE (or its preview) reached. */
export interface Recipient {
  kind: 'player' | 'npc';
  username?: string;
  location_id?: number;
  name: string;
  given: boolean;
  lands?: Lands;
  reason?: string;
}

/** A line of the GIVEN list (sheets/givenList.js). */
export interface GivenLine { id: number; at: string; by: string; catalogue: string; item: string; qty: number; to: string[]; note: string }

/** The answer to a GIVE or a preview ('itemGiven'). */
export type GiveAnswer =
  | { ok: true; preview: boolean; item: { catalogue: string; id: string; name: string; price: number }; qty: number; note: string; recipients: Recipient[]; given?: GivenLine[] | null }
  | { ok: false; reason: string };

/** What a player is told ('itemReceived'). */
export interface ReceivedNotice { item: string; catalogue: string; qty: number; note: string }

/** The most of one item given at once, and the longest note: the server's own (sheets/giving.js LIMITS). */
export const QTY_MAX = 99;
export const NOTE_MAX = 200;

/** HOW MANY, kept to what the server takes. */
export const clampQty = (n: number): number => (Number.isFinite(n) ? Math.min(QTY_MAX, Math.max(1, Math.floor(n))) : 1);

/** Every item, in one list, narrowed to a catalogue (`chip`, or all) and to names holding `query`; by name. */
export const searchItems = (catalogues: GivableCatalogue[], query: string, chip: string | null): ListedItem[] => {
  const q = query.trim().toLowerCase();
  return catalogues
    .filter((c) => !chip || c.catalogue === chip)
    .flatMap((c) => c.items.map((i) => ({ ...i, catalogue: c.catalogue })))
    .filter((i) => !q || i.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name) || a.catalogue.localeCompare(b.catalogue));
};

/** An item's key in the window: a catalogue can share an id with another. */
export const itemKey = (i: Pick<ListedItem, 'catalogue' | 'id'>) => `${i.catalogue}/${i.id}`;

/** A catalogue's name in this game, for its chip (the shop's own names). */
export const chipLabel = (catalogue: string, system: string | null | undefined) => catalogueLabel(catalogue as ShopStock, system).toUpperCase();

/** What an item is worth, as the shop prints it: in its catalogue's currency, or credits. */
export const worthOf = (system: string | null | undefined, catalogue: string, price: number): string => {
  if (price === 0) return 'N/A';
  const c = catalogueCurrencyFor(system, catalogue);
  return c ? formatAmount(c, price) : `${price.toLocaleString()}cr`;
};

/**
 * Where it lands, as the window says it: "weapon row 3, Stowed" (CWN stows a weapon), "weapon rows
 * 2–3", "a cyberware row, not yet placed", "inventory ×3, stacked", "an inventory line".
 */
export const landsText = (lands: Lands, qty: number, stows: boolean): string => {
  if (lands.shape === 'rows') {
    const [first] = lands.rows;
    const last = lands.rows[lands.rows.length - 1];
    const where = lands.rows.length > 1 ? `${lands.group} rows ${first}–${last}` : `${lands.group} row ${first}`;
    return stows && lands.group === 'weapon' ? `${where}, Stowed` : where;
  }
  if (lands.shape === 'cyberware') return qty > 1 ? `${qty} cyberware rows, not yet placed` : 'a cyberware row, not yet placed';
  if (lands.stacked) return `inventory ×${qty}, stacked`;
  return qty > 1 ? `inventory ×${qty}` : 'an inventory line';
};

/** Why not, short: the server's reason up to its dash ("No free weapon row"). */
export const shortReason = (reason: string): string => reason.split(' — ')[0].replace(/\.$/, '');

/** One recipient's line: where it lands (or went), or why not. */
export const recipientText = (r: Recipient, qty: number, stows: boolean): string =>
  (r.lands ? landsText(r.lands, qty, stows) : shortReason(r.reason ?? ''));

/** A result line after a GIVE: "VEX: GIVEN, WEAPON ROWS 2–3" or "JUNO: NOT GIVEN, NO FREE WEAPON ROW". */
export const resultText = (r: Recipient, qty: number, stows: boolean): string =>
  `${r.name}: ${r.given ? 'GIVEN' : 'NOT GIVEN'}, ${recipientText(r, qty, stows)}`.toUpperCase();

/** The GIVE button: "GIVE 2 × HEAVY PISTOL TO 3". */
export const giveLabel = (qty: number, item: string, count: number): string =>
  `GIVE ${qty} × ${item.toUpperCase()}${count ? ` TO ${count}` : ''}`;

/** Why the server refused a whole GIVE, in words. */
export const refusalText = (reason: string): string => ({
  give_off: 'GIVE ITEM is switched off in this game.',
  no_system: 'The server could not read which game is running.',
  write: 'A sheet could not be saved. The GIVEN list shows who got it.',
  read: 'The GIVEN list could not be read.',
} as Record<string, string>)[reason] ?? reason;

/** When a line was given, as a time today or a date before ("14:05", "Oct 12"); the server writes UTC. */
export const givenAt = (at: string, now: Date = new Date()): string => {
  const when = new Date(`${at.replace(' ', 'T')}Z`);
  if (Number.isNaN(when.getTime())) return at;
  return when.toDateString() === now.toDateString()
    ? `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`
    : when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

/** A GIVEN line as the list reads it: "14:05 · gm gave Vex, Rook: Heavy Pistol ×2". */
export const givenText = (l: GivenLine, now?: Date): string =>
  `${givenAt(l.at, now)} · ${l.by} gave ${l.to.join(', ')}: ${l.item} ×${l.qty}`;

/** What a player is told: "THE GM GAVE YOU HEAVY PISTOL ×2", in the game's own word for the GM. */
export const noticeText = (n: ReceivedNotice, gm = 'GM'): string => `THE ${gm.toUpperCase()} GAVE YOU ${n.item.toUpperCase()} ×${n.qty}`;

/** A recipient's key, for ticking: a player by name, an NPC by token. */
export const recipientKey = (r: Pick<Recipient, 'kind' | 'username' | 'location_id'>) =>
  (r.kind === 'player' ? `player:${String(r.username).toLowerCase()}` : `npc:${r.location_id}`);

/** The preview that lists everyone the window can tick: every player character, and the NPCs given. */
export const previewRequest = (item: Pick<ListedItem, 'catalogue' | 'id'>, qty: number, npcs: number[]) =>
  ({ catalogue: item.catalogue, id: item.id, qty: clampQty(qty), players: true as const, npcs, preview: true as const });

/** The GIVE itself, to the ticked ones. */
export const giveRequest = (item: Pick<ListedItem, 'catalogue' | 'id'>, qty: number, ticked: Recipient[], note: string) => ({
  catalogue: item.catalogue,
  id: item.id,
  qty: clampQty(qty),
  players: ticked.filter((r) => r.kind === 'player').map((r) => String(r.username)),
  npcs: ticked.filter((r) => r.kind === 'npc').map((r) => Number(r.location_id)),
  note: note.slice(0, NOTE_MAX),
});

/** A socket, as far as asking once and hearing one answer goes. */
export interface AskSocket {
  emit: (event: string, payload?: unknown) => unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on: (event: string, fn: (...args: any[]) => void) => unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  off: (event: string, fn: (...args: any[]) => void) => unknown;
}

/** How long the window waits for the server before saying it got no answer. */
export const ASK_TIMEOUT_MS = 15_000;

/**
 * Send `event` and wait for the first `answer`, or null after `timeoutMs`. One question at a time per
 * answer event: the window doesn't ask again until it hears back.
 */
export const askOnce = <T>(socket: AskSocket, event: string, payload: unknown, answer: string, timeoutMs = ASK_TIMEOUT_MS): Promise<T | null> =>
  new Promise((resolve) => {
    const heard = (data: T) => { clearTimeout(timer); socket.off(answer, heard); resolve(data); };
    const timer = setTimeout(() => { socket.off(answer, heard); resolve(null); }, timeoutMs);
    socket.on(answer, heard);
    socket.emit(event, payload);
  });

/** The window's three questions to the server. */
export const giveCalls = (socket: AskSocket, timeoutMs = ASK_TIMEOUT_MS) => ({
  givable: () => askOnce<{ ok: true; system: string; catalogues: GivableCatalogue[] } | { ok: false; reason: string }>(socket, 'requestGivable', undefined, 'givableItems', timeoutMs),
  give: (request: ReturnType<typeof previewRequest> | ReturnType<typeof giveRequest>) => askOnce<GiveAnswer>(socket, 'giveItem', request, 'itemGiven', timeoutMs),
  given: () => askOnce<{ ok: true; system: string; entries: GivenLine[] } | { ok: false; reason: string }>(socket, 'requestGiven', undefined, 'givenList', timeoutMs),
});
