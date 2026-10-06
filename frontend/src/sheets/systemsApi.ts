// SYSTEMS.EXE's requests to the server (4a1b2): backend/routes/systems.js, main admin only. Each
// answers { ok: true, value } or { ok: false, error }, the error being the server's own words
// ("Another system is already called Ember.") so the window can show them where they apply.
// What the answers mean is systemsLibrary.ts.

import type { InstallMode, InstallPreview, InstallResult, LibrarySystem } from './systemsLibrary';

type Problem = { where: string; message: string };

/** A system's definition as stored: the builder edits it whole (backend/systemBuilder/definition.js). */
export type Definition = { format: number; name: string; author?: string; [section: string]: unknown };

/** One system as GET /api/systems/:id answers (store.getSystem). */
export interface SystemCopies {
  id: string;
  name: string;
  version: number;
  updatedAt: string;
  publishedAt: string | null;
  draft: Definition | null;
  published: Definition | null;
  problems: Problem[];
}

export type Answer<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; status: number; changed?: boolean; problems?: Problem[] };

const UNREACHABLE = 'Could not reach the server.';

/** One request, its answer read whatever happened. `status` 0 when the server was never reached. */
const call = async <T>(fetcher: typeof fetch, token: string, url: string, method = 'GET', body?: unknown): Promise<Answer<T>> => {
  let res: Response;
  try {
    res = await fetcher(url, {
      method,
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), Authorization: `Bearer ${token}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    return { ok: false, error: UNREACHABLE, status: 0 };
  }
  const json = await res.json().catch(() => null);
  if (res.ok) return { ok: true, value: json as T };
  return {
    ok: false,
    status: res.status,
    error: json && typeof json.error === 'string' ? json.error : UNREACHABLE,
    ...(json && json.changed === true ? { changed: true } : {}),
    ...(json && Array.isArray(json.problems) ? { problems: json.problems } : {}),
  };
};

/** The requests, for one GM's token. */
export const systemsApi = (token: string, fetcher: typeof fetch = fetch) => {
  const id = (systemId: string) => `/api/systems/${encodeURIComponent(systemId)}`;
  return {
    list: () => call<LibrarySystem[]>(fetcher, token, '/api/systems'),
    /** One system with both copies and the draft's problems: the facts panel and the builder. */
    get: (systemId: string) => call<SystemCopies>(fetcher, token, id(systemId)),
    /** Store the builder's draft; its problems come back, stored either way. */
    saveDraft: (systemId: string, definition: Definition) =>
      call<{ problems: Problem[] }>(fetcher, token, `${id(systemId)}/draft`, 'PUT', { definition }),
    /** Make the stored draft what the game runs; refused, with `problems`, while it has any. */
    publish: (systemId: string) => call<{ version: number }>(fetcher, token, `${id(systemId)}/publish`, 'POST', {}),
    create: (name: string) => call<{ id: string }>(fetcher, token, '/api/systems', 'POST', { name }),
    rename: (systemId: string, name: string) => call<{ name: string }>(fetcher, token, `${id(systemId)}/name`, 'PUT', { name }),
    duplicate: (systemId: string) => call<{ id: string; name: string }>(fetcher, token, `${id(systemId)}/duplicate`, 'POST', {}),
    remove: (systemId: string) => call<{ deleted: true }>(fetcher, token, id(systemId), 'DELETE'),
    preview: (file: string) => call<InstallPreview>(fetcher, token, '/api/systems/install/preview', 'POST', { file }),
    install: (file: string, mode: InstallMode, replaceChanges = false) =>
      call<InstallResult>(fetcher, token, '/api/systems/install', 'POST', { file, mode, ...(replaceChanges ? { replaceChanges: true } : {}) }),
    /** A published system as its .citysys file: its name and text, for the window to save. */
    exportFile: async (systemId: string): Promise<Answer<{ fileName: string; text: string }>> => {
      let res: Response;
      try {
        res = await fetcher(`${id(systemId)}/export`, { headers: { Authorization: `Bearer ${token}` } });
      } catch {
        return { ok: false, error: UNREACHABLE, status: 0 };
      }
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        return { ok: false, status: res.status, error: json && typeof json.error === 'string' ? json.error : UNREACHABLE };
      }
      const named = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '');
      return { ok: true, value: { fileName: named ? named[1] : 'system.citysys', text: await res.text() } };
    },
  };
};
