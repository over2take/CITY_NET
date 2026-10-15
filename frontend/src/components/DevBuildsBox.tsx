import React, { useEffect, useState } from 'react';
import { currentBootId, waitForRestart } from '../utils/updateClient';

// The LOOK FOR DEV BUILDS box, under "Check for update" in SYSTEM_INFO (the primary admin only).
// Ticking it switches this deployment to development builds: the server copies the database,
// then sets IMAGE_TAG=dev in backend/.env and the .env beside docker-compose.yml (backend
// updateChannel.js). Nothing is pulled here; "Check for update" then offers the newest dev build.
// Unticking sets it back to latest, and the next stable release newer than this build is offered.
//
// On a dev build it also offers GO BACK TO STABLE: the copy made when dev builds were turned on
// put back (the dev database set aside, never deleted) and the stable release started, by a
// helper on the server. The page then waits for the restart, as an update does.
//
// Shown on a Docker install only, which is the only kind that pulls images. Where the app can't
// switch it (no Docker socket, say), the box is greyed and says which line to set by hand.

interface Channel { dev: boolean; canSwitch: boolean; manual?: string; devBuild?: boolean; copy?: string | null }

const small: React.CSSProperties = { fontSize: '0.6rem', letterSpacing: '1px', lineHeight: 1.5, textAlign: 'center' };
const btn: React.CSSProperties = { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--green)', fontSize: '0.6rem', letterSpacing: '1px', padding: 0, textDecoration: 'underline' };

export function DevBuildsBox({ token }: { token: string }) {
  const [channel, setChannel] = useState<Channel | null>(null);
  const [version, setVersion] = useState('');
  const [asking, setAsking] = useState<'on' | 'back' | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let live = true;
    const auth = { headers: { Authorization: `Bearer ${token}` } };
    Promise.all([
      fetch('/api/version').then((r) => r.json()),
      fetch('/api/update/channel', auth).then((r) => (r.ok ? r.json() : null)),
    ]).then(([v, read]) => {
      if (!live || !v?.isDocker || !read) return;
      setVersion(v.version ?? '');
      setChannel(read);
    }).catch(() => { /* no box rather than a broken one */ });
    return () => { live = false; };
  }, [token]);

  if (!channel) return null;

  const refused = (body: { error?: string; manual?: string }, fallback: string) => ({
    ok: false, text: body.manual ? `${body.error} ${body.manual}` : (body.error || fallback),
  });

  const turn = async (dev: boolean) => {
    setAsking(null);
    setBusy('SWITCHING…');
    setSaid(null);
    try {
      const res = await fetch('/api/update/channel', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ dev }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setSaid(refused(body, 'The channel could not be changed.')); return; }
      setChannel((c) => (c ? { ...c, dev: body.dev } : c));
      setSaid({
        ok: true,
        text: body.dev
          ? `Dev builds on. Database copied to ${body.backup}. Check for update to get the newest.`
          : 'Stable releases only. The next release newer than this build will be offered.',
      });
    } catch {
      setSaid({ ok: false, text: 'Connection failed. Nothing was changed.' });
    } finally {
      setBusy(null);
    }
  };

  const goBack = async () => {
    setAsking(null);
    setBusy('GOING BACK…');
    setSaid(null);
    try {
      const bootId = await currentBootId();
      const res = await fetch('/api/update/revert', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setSaid(refused(body, 'Could not go back to stable. Nothing was changed.')); setBusy(null); return; }
      setSaid({ ok: true, text: 'Going back to stable. The server restarts; this page reloads when it is back.' });
      await waitForRestart({
        bootId,
        currentVersion: version,
        onRestart: () => { window.location.href = `/?v=${Date.now()}`; },
        onStillWorking: () => setSaid({ ok: true, text: 'Still working: downloading the stable release can take a few minutes.' }),
        onFailed: (error, cmd) => { setBusy(null); setSaid({ ok: false, text: cmd ? `${error} ${cmd}` : error }); },
      });
    } catch {
      setBusy(null);
      setSaid({ ok: false, text: 'Connection failed. Nothing was changed.' });
    }
  };

  const tick = () => {
    if (channel.dev) { turn(false); return; }
    setSaid(null);
    setAsking('on');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, marginTop: 4, color: 'var(--green)' }}>
      <label style={{ ...small, display: 'flex', alignItems: 'center', gap: 6, opacity: channel.canSwitch ? 0.8 : 0.4, cursor: channel.canSwitch ? 'pointer' : 'default' }}>
        <input
          type="checkbox"
          checked={channel.dev || asking === 'on'}
          disabled={!channel.canSwitch || !!busy}
          onChange={tick}
          style={{ accentColor: 'var(--green)', margin: 0 }}
        />
        LOOK FOR DEV BUILDS
      </label>
      {!channel.canSwitch && channel.manual && <span style={{ ...small, opacity: 0.6 }}>{channel.manual}</span>}
      {channel.devBuild && channel.canSwitch && channel.copy && !asking && !busy && (
        <button type="button" style={btn} onClick={() => { setSaid(null); setAsking('back'); }}>GO BACK TO STABLE</button>
      )}
      {channel.devBuild && channel.canSwitch && !channel.copy && (
        <span style={{ ...small, opacity: 0.6 }}>No copy from before dev builds to go back to.</span>
      )}
      {asking === 'on' && (
        <div role="group" aria-label="Turn on dev builds" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <span style={{ ...small, color: 'var(--warning)' }}>
            Dev builds are unreleased and may break. A copy of your database is made first.
          </span>
          <div style={{ display: 'flex', gap: 12 }}>
            <button type="button" style={btn} onClick={() => turn(true)}>TURN ON</button>
            <button type="button" style={btn} onClick={() => setAsking(null)}>CANCEL</button>
          </div>
        </div>
      )}
      {asking === 'back' && (
        <div role="group" aria-label="Go back to stable" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <span style={{ ...small, color: 'var(--warning)' }}>
            Goes back to the stable release, with your database as it was when dev builds were turned on
            ({channel.copy}). Anything done since is set aside in a copy, not deleted. The server restarts.
          </span>
          <div style={{ display: 'flex', gap: 12 }}>
            <button type="button" style={btn} onClick={goBack}>GO BACK</button>
            <button type="button" style={btn} onClick={() => setAsking(null)}>CANCEL</button>
          </div>
        </div>
      )}
      {busy && <span style={{ ...small, opacity: 0.7 }}>{busy}</span>}
      {said && <span role="status" style={{ ...small, color: said.ok ? 'var(--green)' : 'var(--danger)' }}>{said.text}</span>}
    </div>
  );
}
