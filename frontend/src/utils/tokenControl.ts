// Who may move a token, for the client.
//
// Mirrored from backend/sockets/tokenControl.js, which is authoritative: the server checks
// this on every move and a client cannot talk it out of a refusal. This exists so the map
// does not offer a drag that would be silently rejected, and so the admin panel can show
// who a token is currently shared with.
//
// A test cross-checks the two against the same rows, the same way the sheet mirrors are.

export interface TokenGrant {
  all: boolean;
  users: string[];
}

/** The token shapes a grant can apply to. Enemies stay with the GM. */
export const GRANTABLE_SHAPES = ['friendly_rhombus'];

const NO_CONTROL: TokenGrant = { all: false, users: [] };

/**
 * Read the stored grant.
 *
 * Anything unreadable means "nobody", which is the safe way to fail: a malformed grant
 * must never appear to open a token up, or the map would offer a drag the server refuses.
 */
export const parseGrant = (raw: unknown): TokenGrant => {
  if (raw === null || raw === undefined || raw === '') return { ...NO_CONTROL };
  let value: unknown = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return { ...NO_CONTROL };
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...NO_CONTROL };
  const v = value as { all?: unknown; users?: unknown };
  const users = Array.isArray(v.users)
    ? v.users.filter((u): u is string => typeof u === 'string' && u.trim() !== '').map((u) => u.trim())
    : [];
  return { all: v.all === true, users };
};

export const isGrantable = (row: { shape?: string } | null | undefined) =>
  GRANTABLE_SHAPES.includes(String(row?.shape ?? ''));

/**
 * Whether this viewer may move this token.
 *
 * `isAdmin` first and unconditionally: an admin never loses control of anything, whatever
 * the grant says and whatever shape the token is.
 */
export const canMoveToken = (
  row: { shape?: string; owner?: string | null; controllers?: unknown } | null | undefined,
  { isAdmin, userName }: { isAdmin?: boolean; userName?: string | null } = {},
): boolean => {
  if (isAdmin) return true;
  if (!row) return false;
  if (userName && row.owner && userName === row.owner) return true;
  if (!isGrantable(row)) return false;
  const grant = parseGrant(row.controllers);
  if (grant.all) return true;
  return Boolean(userName) && grant.users.includes(userName as string);
};

/** A short line for the admin panel: who this token is shared with right now. */
export const describeGrant = (row: { shape?: string; controllers?: unknown }): string => {
  if (!isGrantable(row)) return 'Only friendly NPCs can be shared.';
  const { all, users } = parseGrant(row.controllers);
  if (all && users.length) return `ALL PLAYERS (+${users.length} named)`;
  if (all) return 'ALL PLAYERS';
  if (users.length) return users.join(', ');
  return 'NOBODY — admin only';
};
