import React, { useEffect, useState } from 'react';

// The LOOK FOR DEV BUILDS box, under "Check for update" in SYSTEM_INFO (the primary admin only).
// Ticking it switches this deployment to development builds: the server copies the database,
// then sets IMAGE_TAG=dev in backend/.env and the .env beside docker-compose.yml (backend
// updateChannel.js). Nothing is pulled here; "Check for update" then offers the newest dev build.
// Unticking sets it back to latest, and the next stable release newer than this build is offered.
//
// Shown on a Docker install only, which is the only kind that pulls images. Where the app can't
// switch it (no Docker socket, say), the box is greyed and says which line to set by hand.

interface Channel { dev: boolean; canSwitch: boolean; manual?: string }

const small: React.CSSProperties = { fontSize: '0.6rem', letterSpacing: '1px', lineHeight: 1.5, textAlign: 'center' };
const btn: React.CSSProperties = { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--green)', fontSize: '0.6rem', letterSpacing: '1px', padding: 0, textDecoration: 'underline' };

export function DevBuildsBox({ token }: { token: string }) {
  const [channel, setChannel] = useState<Channel | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let live = true;
    const auth = { headers: { Authorization: `Bearer ${token}` } };
    Promise.all([
      fetch('/api/version').then((r) => r.json()),
      fetch('/api/update/channel', auth).then((r) => (r.ok ? r.json() : null)),
    ]).then(([version, read]) => {
      if (live && version?.isDocker && read) setChannel(read);
    }).catch(() => { /* no box rather than a broken one */ });
    return () => { live = false; };
  }, [token]);

  if (!channel) return null;

  const turn = async (dev: boolean) => {
    setAsking(false);
    setBusy(true);
    setSaid(null);
    try {
      const res = await fetch('/api/update/channel', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ dev }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaid({ ok: false, text: body.manual ? `${body.error} ${body.manual}` : (body.error || 'The channel could not be changed.') });
        return;
      }
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
      setBusy(false);
    }
  };

  const tick = () => {
    if (channel.dev) { turn(false); return; }
    setSaid(null);
    setAsking(true);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, marginTop: 4, color: 'var(--green)' }}>
      <label style={{ ...small, display: 'flex', alignItems: 'center', gap: 6, opacity: channel.canSwitch ? 0.8 : 0.4, cursor: channel.canSwitch ? 'pointer' : 'default' }}>
        <input
          type="checkbox"
          checked={channel.dev || asking}
          disabled={!channel.canSwitch || busy}
          onChange={tick}
          style={{ accentColor: 'var(--green)', margin: 0 }}
        />
        LOOK FOR DEV BUILDS
      </label>
      {!channel.canSwitch && channel.manual && <span style={{ ...small, opacity: 0.6 }}>{channel.manual}</span>}
      {asking && (
        <div role="group" aria-label="Turn on dev builds" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <span style={{ ...small, color: 'var(--warning)' }}>
            Dev builds are unreleased and may break. A copy of your database is made first.
          </span>
          <div style={{ display: 'flex', gap: 12 }}>
            <button type="button" style={btn} onClick={() => turn(true)}>TURN ON</button>
            <button type="button" style={btn} onClick={() => setAsking(false)}>CANCEL</button>
          </div>
        </div>
      )}
      {busy && <span style={{ ...small, opacity: 0.7 }}>SWITCHING…</span>}
      {said && <span role="status" style={{ ...small, color: said.ok ? 'var(--green)' : 'var(--danger)' }}>{said.text}</span>}
    </div>
  );
}
