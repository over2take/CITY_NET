import React, { useState, useEffect, useRef, useMemo } from 'react';
import { DraggableWindow } from './DraggableWindow';
import { useParts } from '../sheets/parts';
import { currenciesFor, formatAmount, parseAmount, type BankCurrencyAccount, type Currency } from '../sheets/currencies';
import {
  amountExample, amountProblem, bankRefusal, celebrationsFor, payShare, readAccountEdit, type BankAction,
} from '../sheets/moneyText';
import creditsPngIcon from '../assets/Credits.png';

export type BankSoundKey = 'cashregister' | 'debtpaid' | 'highroller' | 'firstpay' | 'overdraft';
export type BankSoundVolumes = Record<BankSoundKey, number>;

export function CurrencyIcon({ icon, size = 18, color = 'currentColor' }: { icon?: string; size?: number; color?: string }) {
  if (!icon || icon === 'credits') {
    return <div style={{ width: size, height: size, backgroundColor: color, WebkitMaskImage: `url(${creditsPngIcon})`, WebkitMaskSize: 'contain', WebkitMaskRepeat: 'no-repeat', WebkitMaskPosition: 'center', maskImage: `url(${creditsPngIcon})`, maskSize: 'contain', maskRepeat: 'no-repeat', maskPosition: 'center', flexShrink: 0 }} />;
  }
  // Single-char symbols ($, £, €) need a larger multiplier to match emoji visual weight
  const isEmoji = [...icon].length > 1;
  return <span style={{ fontSize: size * (isEmoji ? 0.85 : 1.15), lineHeight: 1, color, flexShrink: 0 }}>{icon}</span>;
}

export const formatBankValue = (val: number) => {
  const rounded = Math.round(val * 100) / 100;
  return (rounded === 0 ? 0 : rounded).toFixed(2);
};

interface AdminBankWindowProps {
  pos: { x: number; y: number };
  setPos: (pos: { x: number; y: number }) => void;
  onClose: () => void;
  targetUser: string;
  socket: any;
  token: string;
  /** The running system: a custom one with the bank off shows no bank at all (3b2b). */
  system?: string;
}

/** The GM's view of one player's account; nothing while the running system has the bank off. */
export function AdminBankWindow(props: AdminBankWindowProps) {
  return useParts(props.system)('bank') ? <AdminBankAccount {...props} /> : null;
}

function AdminBankAccount(props: AdminBankWindowProps) {
  // A custom system with currencies of its own has an account in each (3c2b5).
  return currenciesFor(props.system).length ? <AdminBankCurrencies {...props} /> : <AdminBankMoney {...props} />;
}

function AdminBankMoney({ pos, setPos, onClose, targetUser, socket, token }: AdminBankWindowProps) {
  const [bankData, setBankData] = useState({ balance: 0, debt: 0 });
  const [balInput, setBalInput] = useState('');
  const [debtInput, setDebtInput] = useState('');

  useEffect(() => {
    const handleUpdate = (data: any) => {
      if (data.username === targetUser) {
        setBankData({ balance: data.balance, debt: data.debt });
        setBalInput(data.balance.toString());
        setDebtInput(data.debt.toString());
      }
    };
    socket.on('bankUpdate', handleUpdate);
    socket.emit('requestBankBalance', { username: targetUser });
    return () => socket.off('bankUpdate', handleUpdate);
  }, [targetUser, socket]);

  const handleSave = () => {
    const balance = parseFloat(balInput);
    const debt = parseFloat(debtInput);
    if (!isNaN(balance) && !isNaN(debt)) {
      socket.emit('adminUpdateBank', { token, username: targetUser, balance, debt });
      onClose();
    }
  };

  return (
    <DraggableWindow title={`BANK_ADMIN.EXE · ${targetUser}`} pos={pos} setPos={setPos} onClose={onClose} windowStyle={{ width: '300px' }}>
      <div style={{ padding: '10px' }}>
        <div style={{ marginBottom: '10px' }}>
          <label style={{ color: '#00ff66', display: 'block', marginBottom: '5px' }}>Balance</label>
          <input type="number" step="1" value={balInput} onChange={e => setBalInput(e.target.value)} style={{ width: '100%', padding: '5px', background: '#000', color: '#fff', border: '1px solid #333' }} />
        </div>
        <div style={{ marginBottom: '15px' }}>
          <label style={{ color: '#ff0044', display: 'block', marginBottom: '5px' }}>Debt</label>
          <input type="number" step="1" value={debtInput} onChange={e => setDebtInput(e.target.value)} style={{ width: '100%', padding: '5px', background: '#000', color: '#fff', border: '1px solid #333' }} />
        </div>
        <button className="panel-btn" style={{ width: '100%' }} onClick={handleSave}>SAVE CHANGES</button>
      </div>
    </DraggableWindow>
  );
}

/**
 * One player's accounts in a custom system's own currencies (3c2b5, mockup approved 2026-10-02):
 * a row for each, the main one first, the balance and (where it can be owed, or is) the debt
 * written the currency's way. Each row says how it read what was typed, or what the currency
 * won't allow, and SAVE CHANGES sends only the accounts that changed, once every row is good.
 */
function AdminBankCurrencies({ pos, setPos, onClose, targetUser, socket, token, system }: AdminBankWindowProps) {
  const currencies = currenciesFor(system);
  const [held, setHeld] = useState<Record<string, { balance: number; debt: number }>>({});
  const [edits, setEdits] = useState<Record<string, { balance: string; debt: string }>>({});
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    const handleUpdate = (data: { username: string; balance: number; debt: number; currencies?: BankCurrencyAccount[] }) => {
      if (data.username !== targetUser) return;
      const list = currenciesFor(system);
      const accounts = Object.fromEntries(list.map((c, i) => {
        const a = data.currencies?.find((x) => x.id === c.id) ?? (i === 0 ? data : { balance: 0, debt: 0 });
        return [c.id, { balance: Number(a.balance) || 0, debt: Number(a.debt) || 0 }];
      }));
      setHeld(accounts);
      setEdits(Object.fromEntries(list.map((c) => [c.id, { balance: formatAmount(c, accounts[c.id].balance), debt: formatAmount(c, accounts[c.id].debt) }])));
    };
    socket.on('bankUpdate', handleUpdate);
    socket.emit('requestBankBalance', { username: targetUser });
    return () => socket.off('bankUpdate', handleUpdate);
  }, [targetUser, socket, system]);

  /** A debt box where the currency can be owed, or something is owed in it all the same. */
  const hasDebt = (c: Currency) => c.debt || (held[c.id]?.debt ?? 0) > 0;
  const readRow = (c: Currency) => readAccountEdit(c, edits[c.id]?.balance ?? '', hasDebt(c) ? edits[c.id]?.debt ?? '' : null);

  const handleSave = () => {
    const rows = currencies.map((c) => ({ c, read: readRow(c) }));
    const bad = rows.find((r) => !r.read.ok);
    if (bad && !bad.read.ok) { setProblem(`${bad.c.name}: ${bad.read.problem}`); return; }
    for (const { c, read } of rows) {
      if (!read.ok) continue;
      if (held[c.id] && read.balance === held[c.id].balance && read.debt === held[c.id].debt) continue;
      socket.emit('adminUpdateBank', { token, username: targetUser, balance: read.balance, debt: read.debt, currency: c.id });
    }
    onClose();
  };

  const input: React.CSSProperties = { width: '100%', padding: '5px', background: 'var(--black)', color: 'var(--text)', border: '1px solid var(--dark-green)', boxSizing: 'border-box' };
  return (
    <DraggableWindow title={`BANK_ADMIN.EXE · ${targetUser}`} pos={pos} setPos={setPos} onClose={onClose} windowStyle={{ width: '360px' }}>
      <div style={{ padding: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '64px minmax(0, 1fr) minmax(0, 1fr)', gap: '4px 8px', fontSize: '10px', letterSpacing: '1px', opacity: 0.7 }}>
          <span /><span>BALANCE</span><span>DEBT</span>
        </div>
        {currencies.map((c) => {
          const read = readRow(c);
          const set = (field: 'balance' | 'debt', value: string) => {
            setProblem(null);
            setEdits((e) => ({ ...e, [c.id]: { ...(e[c.id] ?? { balance: '', debt: '' }), [field]: value } }));
          };
          return (
            <div key={c.id} data-testid={`admin-account-${c.id}`}>
              <div style={{ display: 'grid', gridTemplateColumns: '64px minmax(0, 1fr) minmax(0, 1fr)', gap: '4px 8px', alignItems: 'center' }}>
                <span style={{ fontSize: '11px', fontWeight: 'bold', letterSpacing: '1px' }}>{c.name.toUpperCase()}</span>
                <input type="text" aria-label={`${c.name} balance`} value={edits[c.id]?.balance ?? ''} onChange={(e) => set('balance', e.target.value)} style={input} />
                {hasDebt(c)
                  ? <input type="text" aria-label={`${c.name} debt`} value={edits[c.id]?.debt ?? ''} onChange={(e) => set('debt', e.target.value)} style={input} />
                  : <span style={{ fontSize: '10px', letterSpacing: '1px', opacity: 0.5 }}>NO DEBT</span>}
              </div>
              <div data-testid={`admin-read-${c.id}`} style={{ fontSize: '10px', minHeight: '1.2em', marginLeft: '72px', color: read.ok ? 'var(--cyan)' : 'var(--danger)' }}>
                {read.ok ? `= ${formatAmount(c, read.balance)}${read.debt ? ` · OWES ${formatAmount(c, read.debt)}` : ''}` : read.problem}
              </div>
            </div>
          );
        })}
        <button className="panel-btn" style={{ width: '100%' }} onClick={handleSave}>SAVE CHANGES</button>
        {problem && <div role="status" style={{ color: 'var(--danger)', fontSize: '11px' }}>{problem}</div>}
      </div>
    </DraggableWindow>
  );
}

interface AdminPayWindowProps {
  pos: { x: number; y: number };
  setPos: (pos: { x: number; y: number }) => void;
  onClose: () => void;
  socket: any;
  token: string;
  activeUsers: any[];
  /** The running system: a custom one with the bank off shows no bank at all (3b2b). */
  system?: string;
}

/** PAY_PLAYERS; nothing while the running system has the bank off. */
export function AdminPayWindow(props: AdminPayWindowProps) {
  return useParts(props.system)('bank') ? <AdminPay {...props} /> : null;
}

function AdminPay({ pos, setPos, onClose, socket, token, activeUsers, system }: AdminPayWindowProps) {
  const [amount, setAmount] = useState('');
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  /**
   * A custom system with currencies of its own pays in the one picked, the main one unless another
   * is (3c2b5): the amount read as written, sent in whole units with the currency. None in a
   * built-in system, which pays today's money.
   */
  const currencies = currenciesFor(system);
  const [currencyId, setCurrencyId] = useState<string | null>(null);
  const currency: Currency | null = currencies.find((c) => c.id === currencyId) ?? currencies[0] ?? null;
  const read = currency ? parseAmount(currency, amount) : null;
  const problem = currency && read ? amountProblem(currency, read, { positive: true }) : null;

  const allUsers = (activeUsers || [])
    .filter((u: any) => !u.isNPC && !(u.isAdmin && !u.isTemporaryAdmin))
    .map((u: any) => u.userName)
    .filter(Boolean);

  const toggleUser = (u: string) => {
    setSelectedUsers(prev => prev.includes(u) ? prev.filter(x => x !== u) : [...prev, u]);
  };

  /** The total to pay, or NaN when there is none to pay. */
  const total = currency ? (read?.ok && read.amount > 0 ? read.amount : NaN) : parseFloat(amount);
  const pay = (usernames: string[]) => {
    if (!isNaN(total) && total > 0 && usernames.length > 0) {
      socket.emit('adminPayPlayers', { token, usernames, totalAmount: total, ...(currency ? { currency: currency.id } : {}) });
      onClose();
    }
  };
  const handlePay = () => pay(selectedUsers);
  const handleDivideAll = () => pay(allUsers);
  /** Who a press would pay: those ticked, or everybody for SPLIT_AMONG_ALL. */
  const payees = selectedUsers.length || allUsers.length;

  return (
    <DraggableWindow title="PAYROLL.EXE" pos={pos} setPos={setPos} onClose={onClose} windowStyle={{ width: '300px' }}>
      <div style={{ padding: '10px' }}>
        {currencies.length > 1 && (
          <>
            <label htmlFor="payroll-currency" style={{ display: 'block', marginBottom: '5px', color: '#00ff66' }}>CURRENCY</label>
            <select id="payroll-currency" value={currency?.id} onChange={(e) => { setCurrencyId(e.target.value); setAmount(''); }}
              style={{ width: '100%', padding: '5px', marginBottom: '10px', background: 'var(--black)', color: 'var(--green)', border: '1px solid var(--dark-green)' }}>
              {currencies.map((c) => <option key={c.id} value={c.id}>{c.name.toUpperCase()}</option>)}
            </select>
          </>
        )}
        <label style={{ display: 'block', marginBottom: '5px', color: '#00ff66' }}>TOTAL_AMOUNT</label>
        {currency ? (
          <>
            <input type="text" aria-label="Total amount" autoComplete="off" value={amount} onChange={e => setAmount(e.target.value)}
              style={{ width: '100%', padding: '5px', marginBottom: '4px', background: '#000', color: '#fff', border: '1px solid #333', boxSizing: 'border-box' }} />
            <div data-testid="payroll-share" style={{ fontSize: '10px', minHeight: '2.4em', marginBottom: '8px', lineHeight: 1.4,
              color: problem ? 'var(--danger)' : 'var(--cyan)', opacity: amount.trim() ? 1 : 0.6 }}>
              {problem ?? (!isNaN(total) && payees
                ? `${formatAmount(currency, total)} for ${payShare(currency, total, payees)}`
                : `Write it like ${amountExample(currency)}`)}
            </div>
          </>
        ) : (
          <input type="number" step="1" min="1" value={amount} onChange={e => setAmount(e.target.value)} style={{ width: '100%', padding: '5px', marginBottom: '15px', background: '#000', color: '#fff', border: '1px solid #333' }} />
        )}

        <div style={{ maxHeight: '150px', overflowY: 'auto', border: '1px solid #333', padding: '5px', marginBottom: '10px', background: 'rgba(0,0,0,0.5)' }}>
          {allUsers.length === 0 ? (
            <div style={{ color: '#888', fontSize: '12px' }}>No users online.</div>
          ) : allUsers.map((u: string) => (
            <div key={u} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '5px' }}>
              <input type="checkbox" checked={selectedUsers.includes(u)} onChange={() => toggleUser(u)} />
              <span style={{ color: '#fff' }}>{u}</span>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button className="panel-btn" style={{ flex: 1 }} onClick={handleDivideAll} disabled={allUsers.length === 0}>SPLIT_AMONG_ALL</button>
          <button className="panel-btn" style={{ flex: 1 }} onClick={handlePay} disabled={selectedUsers.length === 0}>PAY_SELECTED</button>
        </div>
      </div>
    </DraggableWindow>
  );
}

export function playCashRegister(vol = 1) {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const master = ctx.createGain(); master.gain.value = vol; master.connect(ctx.destination);

    const click = ctx.createOscillator(); const clickGain = ctx.createGain();
    click.connect(clickGain); clickGain.connect(master);
    click.frequency.setValueAtTime(1400, ctx.currentTime);
    click.frequency.exponentialRampToValueAtTime(220, ctx.currentTime + 0.06);
    clickGain.gain.setValueAtTime(0.26, ctx.currentTime);
    clickGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.09);
    click.start(ctx.currentTime); click.stop(ctx.currentTime + 0.09);

    const bell = ctx.createOscillator(); const bellGain = ctx.createGain();
    bell.type = 'sine'; bell.connect(bellGain); bellGain.connect(master);
    bell.frequency.setValueAtTime(2200, ctx.currentTime + 0.07);
    bellGain.gain.setValueAtTime(0.001, ctx.currentTime + 0.07);
    bellGain.gain.linearRampToValueAtTime(0.34, ctx.currentTime + 0.09);
    bellGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.9);
    bell.start(ctx.currentTime + 0.07); bell.stop(ctx.currentTime + 0.9);

    const bell2 = ctx.createOscillator(); const bell2Gain = ctx.createGain();
    bell2.type = 'sine'; bell2.connect(bell2Gain); bell2Gain.connect(master);
    bell2.frequency.setValueAtTime(3520, ctx.currentTime + 0.07);
    bell2Gain.gain.setValueAtTime(0.001, ctx.currentTime + 0.07);
    bell2Gain.gain.linearRampToValueAtTime(0.165, ctx.currentTime + 0.09);
    bell2Gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.55);
    bell2.start(ctx.currentTime + 0.07); bell2.stop(ctx.currentTime + 0.55);

    setTimeout(() => ctx.close(), 1100);
  } catch (_) {}
}

export function playWompWomp(vol = 1) {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const master = ctx.createGain(); master.gain.value = vol; master.connect(ctx.destination);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 420; filter.Q.value = 0.8;
    filter.connect(master);

    const womp = (t: number, from: number, to: number, dur: number) => {
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.type = 'sawtooth'; osc.connect(gain); gain.connect(filter);
      osc.frequency.setValueAtTime(from, t);
      osc.frequency.exponentialRampToValueAtTime(to, t + dur);
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.28, t + 0.06);
      gain.gain.setValueAtTime(0.28, t + dur - 0.1);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.start(t); osc.stop(t + dur);
    };
    womp(ctx.currentTime,        220, 110, 0.45);
    womp(ctx.currentTime + 0.52, 175,  85, 0.56);
    setTimeout(() => ctx.close(), 1300);
  } catch (_) {}
}

// Calibration tone sequence — sterile, precise beeps ascending in pitch
export function playCalibration(vol = 1) {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const master = ctx.createGain(); master.gain.value = vol; master.connect(ctx.destination);
    const freqs = [440, 550, 660, 880];
    freqs.forEach((hz, i) => {
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.type = 'sine'; osc.frequency.value = hz;
      osc.connect(gain); gain.connect(master);
      const t = ctx.currentTime + i * 0.18;
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.3, t + 0.02);
      gain.gain.setValueAtTime(0.3, t + 0.10);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      osc.start(t); osc.stop(t + 0.16);
    });
    setTimeout(() => ctx.close(), 1200);
  } catch (_) {}
}

// Proud fanfare — triumphant ascending brass-like chord resolve
export function playProudFanfare(vol = 1) {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const master = ctx.createGain(); master.gain.value = vol; master.connect(ctx.destination);

    const note = (hz: number, t: number, dur: number, peak = 0.25) => {
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.type = 'triangle'; osc.frequency.value = hz;
      osc.connect(gain); gain.connect(master);
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(peak, t + 0.04);
      gain.gain.setValueAtTime(peak, t + dur - 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.start(t); osc.stop(t + dur);
    };

    // Rising motif: G A B — then triumphant C major chord held
    const T = ctx.currentTime;
    note(392, T,        0.18);          // G4
    note(440, T + 0.20, 0.18);          // A4
    note(494, T + 0.40, 0.18);          // B4
    note(523, T + 0.62, 0.70);          // C5 \
    note(659, T + 0.62, 0.70, 0.20);   // E5  > major chord
    note(784, T + 0.62, 0.70, 0.15);   // G5 /

    setTimeout(() => ctx.close(), 1600);
  } catch (_) {}
}

// High Roller jackpot — dramatic casino ascending arpeggio + big hit
export function playHighRollerSound(vol = 1) {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const master = ctx.createGain(); master.gain.value = vol; master.connect(ctx.destination);

    const note = (hz: number, t: number, dur: number, peak = 0.22, type: OscillatorType = 'sine') => {
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.type = type; osc.frequency.value = hz;
      osc.connect(gain); gain.connect(master);
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(peak, t + 0.03);
      gain.gain.setValueAtTime(peak, t + dur - 0.06);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.start(t); osc.stop(t + dur);
    };

    const T = ctx.currentTime;
    // Fast ascending arpeggio
    [261, 330, 392, 523, 659, 784, 1047].forEach((hz, i) => note(hz, T + i * 0.07, 0.12, 0.18));
    // Big final hit — thick chord
    note(523, T + 0.56, 0.9, 0.30);
    note(659, T + 0.56, 0.9, 0.25);
    note(784, T + 0.56, 0.9, 0.20);
    note(1047, T + 0.56, 0.7, 0.15);
    // Shimmer on top
    note(2093, T + 0.58, 0.5, 0.08, 'sine');

    setTimeout(() => ctx.close(), 1800);
  } catch (_) {}
}

const OVERDRAFT_CSS = `
@keyframes sad-droop {
  0%   { transform: translateY(-40px) scale(0.4); opacity: 0; }
  60%  { transform: translateY(6px) scale(1.1); opacity: 1; }
  78%  { transform: translateY(-3px) scale(0.97); }
  100% { transform: translateY(0) scale(1); opacity: 1; }
}
@keyframes sad-wobble {
  0%, 100% { transform: rotate(-4deg); }
  50%       { transform: rotate(4deg); }
}
@keyframes overdraft-flicker {
  0%, 100% { opacity: 1; }
  45%       { opacity: 0.35; }
  50%       { opacity: 1; }
  55%       { opacity: 0.2; }
  60%       { opacity: 1; }
}
@keyframes fine-print-slide {
  0%   { transform: translateY(20px); opacity: 0; }
  100% { transform: translateY(0);    opacity: 1; }
}
`;

const HIGH_ROLLER_CSS = `
@keyframes credit-rain {
  0%   { transform: translateY(-10px) rotate(0deg); opacity: 1; }
  85%  { opacity: 0.8; }
  100% { transform: translateY(340px) rotate(540deg); opacity: 0; }
}
@keyframes whale-pop {
  0%   { transform: scale(0) rotate(-15deg); opacity: 0; }
  65%  { transform: scale(1.18) rotate(5deg); opacity: 1; }
  82%  { transform: scale(0.93) rotate(-2deg); }
  100% { transform: scale(1) rotate(0deg); opacity: 1; }
}
@keyframes gold-shimmer {
  0%   { background-position: -200% center; }
  100% { background-position:  200% center; }
}
`;

const FIRST_PAY_CSS = `
@keyframes coin-bounce {
  0%   { transform: translateY(-80px) scale(0.5); opacity: 0; }
  55%  { transform: translateY(10px)  scale(1.2); opacity: 1; }
  72%  { transform: translateY(-5px)  scale(0.95); }
  86%  { transform: translateY(3px)   scale(1.03); }
  100% { transform: translateY(0)     scale(1); opacity: 1; }
}
@keyframes pay-shimmer {
  0%   { background-position: -200% center; }
  100% { background-position:  200% center; }
}
`;

interface BankWindowProps {
  pos: { x: number; y: number };
  setPos: (pos: { x: number; y: number }) => void;
  onClose: () => void;
  /** The main currency's balance and debt; `currencies` lists every currency's under a custom system with its own (3c2b3). */
  bankData: { balance: number; debt: number; currencies?: BankCurrencyAccount[] };
  socket: any;
  userName: string;
  isBankOpen: boolean;
  /** The running system: a custom one with the bank off shows no bank at all (3b2b). */
  system?: string;
  firstPayDone?: boolean;
  highRollerDone?: boolean;
  audioEnabled?: boolean;
  soundVolumes?: Record<string, number>;
  currencyIcon?: string;
}

/**
 * A player's account in one of a custom system's currencies, from the last bank update. The main
 * currency's is the balance and debt every update carries, so it is known even before an update
 * lists the others; a currency not listed yet holds nothing.
 */
const accountIn = (bankData: BankWindowProps['bankData'], currencies: Currency[], c: Currency) =>
  bankData.currencies?.find((a) => a.id === c.id)
  ?? (c.id === currencies[0]?.id ? { id: c.id, balance: bankData.balance, debt: bankData.debt } : { id: c.id, balance: 0, debt: 0 });

/** An amount that wraps between coins, never between a number and its coin or symbol. */
const unbroken = (text: string) => text.replace(/(\d) (\S)/g, '$1\u00a0$2');

const CONFETTI_COLORS =['#ff0066', '#00ff66', 'var(--warning)', '#00ccff', '#ff6600', '#cc00ff', '#ffffff'];

const CELEBRATION_CSS = `
@keyframes confetti-fall {
  0%   { transform: translateY(-10px) rotate(0deg) scale(1);   opacity: 1; }
  80%  { opacity: 1; }
  100% { transform: translateY(320px) rotate(720deg) scale(0.5); opacity: 0; }
}
@keyframes congrats-pop {
  0%   { transform: scale(0.3) rotate(-8deg); opacity: 0; }
  60%  { transform: scale(1.12) rotate(3deg); opacity: 1; }
  80%  { transform: scale(0.95) rotate(-1deg); }
  100% { transform: scale(1) rotate(0deg); opacity: 1; }
}
@keyframes star-drop {
  0%   { transform: translateY(-60px) scale(0.4) rotate(-20deg); opacity: 0; }
  55%  { transform: translateY(12px)  scale(1.25) rotate(10deg);  opacity: 1; }
  75%  { transform: translateY(-6px)  scale(0.95) rotate(-4deg); }
  90%  { transform: translateY(3px)   scale(1.05) rotate(2deg);  }
  100% { transform: translateY(0)     scale(1)    rotate(0deg);  opacity: 1; }
}
@keyframes star-glow {
  0%, 100% { text-shadow: 0 0 8px var(--warning), 0 0 20px var(--warning); }
  50%       { text-shadow: 0 0 20px var(--warning), 0 0 50px #ff8800, 0 0 80px var(--warning); }
}
@keyframes debt-free-shimmer {
  0%   { background-position: -200% center; }
  100% { background-position:  200% center; }
}
`;

export function BankWindow({ pos, setPos, onClose, bankData, socket, userName, isBankOpen, system, firstPayDone, highRollerDone, audioEnabled, soundVolumes, currencyIcon }: BankWindowProps) {
  const bankOn = useParts(system)('bank');
  /**
   * A custom system's own currencies (3c2b3, mockup approved 2026-10-02): every account listed,
   * the boxes below for the one picked. None for a built-in system, which keeps today's window.
   */
  const currencies = currenciesFor(system);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const picked: Currency | null = currencies.find((c) => c.id === pickedId) ?? currencies[0] ?? null;
  /** Why the bank last did nothing, as the server said (bankRefused), until the next try. */
  const [refused, setRefused] = useState<string | null>(null);
  const bankDataRef = useRef(bankData);
  bankDataRef.current = bankData;
  useEffect(() => {
    if (!socket || !currencies.length) return;
    const onRefused = (data: { action: BankAction; reason: string; currency: string | null }) => {
      const list = currenciesFor(system);
      const c = list.find((x) => x.id === data?.currency);
      if (c) setRefused(bankRefusal(c, data.action, data.reason, accountIn(bankDataRef.current, list, c)));
    };
    socket.on('bankRefused', onRefused);
    return () => socket.off('bankRefused', onRefused);
  }, [socket, system, currencies.length]);
  /**
   * The celebrations: every built-in system as today; a custom system's only if its GM turned them
   * on, whale status only at its own threshold (decided with the user, 2026-10-02). Read from a ref
   * in the effects below, which run on the main balance alone.
   */
  const party = celebrationsFor(system);
  const partyRef = useRef(party);
  partyRef.current = party;
  const vol = (key: string) => (soundVolumes?.[key] ?? 1);
  const audioEnabledRef = useRef(audioEnabled);
  useEffect(() => { audioEnabledRef.current = audioEnabled; }, [audioEnabled]);
  const [activePrompt, setActivePrompt] = useState<'withdraw' | 'borrow' | 'pay' | null>(null);
  const [promptAmount, setPromptAmount] = useState('');
  const [showCelebration, setShowCelebration] = useState(false);
  const [showHighRoller, setShowHighRoller] = useState(false);
  const [showFirstPay, setShowFirstPay] = useState(false);
  const [showOverdraft, setShowOverdraft] = useState(false);
  const prevDebtRef = useRef(bankData.debt);
  const prevBalanceRef = useRef(bankData.balance);
  const hasHighRollerFiredRef = useRef(!!highRollerDone);
  const hasFirstPayFiredRef = useRef(!!firstPayDone);
  const bankInitializedRef = useRef(false);
  const isBankOpenRef = useRef(isBankOpen);
  useEffect(() => { isBankOpenRef.current = isBankOpen; }, [isBankOpen]);
  // Suppress bank sounds for 5s after mount so they don't overlap the login chime
  const startupGraceRef = useRef(true);
  useEffect(() => { const t = setTimeout(() => { startupGraceRef.current = false; }, 5000); return () => clearTimeout(t); }, []);

  // Sync the guard when the DB value arrives after mount (firstPayDone starts undefined).
  useEffect(() => {
    if (firstPayDone) hasFirstPayFiredRef.current = true;
  }, [firstPayDone]);
  useEffect(() => {
    if (highRollerDone) hasHighRollerFiredRef.current = true;
  }, [highRollerDone]);

  const confettiPieces = useMemo(() => Array.from({ length: 45 }, (_, i) => ({
    left: Math.random() * 96,
    size: 5 + Math.random() * 9,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    round: Math.random() > 0.5,
    duration: 1.8 + Math.random() * 1.8,
    delay: Math.random() * 1.6,
  })), [showCelebration]); // eslint-disable-line react-hooks/exhaustive-deps

  const creditRainPieces = useMemo(() => Array.from({ length: 35 }, (_, i) => ({
    left: Math.random() * 96,
    duration: 1.6 + Math.random() * 1.8,
    delay: Math.random() * 1.8,
    size: 11 + Math.random() * 10,
  })), [showHighRoller]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debt paid off
  useEffect(() => {
    if (!bankInitializedRef.current) return;
    if (prevDebtRef.current > 0 && bankData.debt === 0 && partyRef.current.on) {
      if (audioEnabledRef.current && !startupGraceRef.current) playProudFanfare(vol('debtpaid'));
      if (!isBankOpenRef.current) { prevDebtRef.current = bankData.debt; return; }
      setShowCelebration(true);
      const t = setTimeout(() => setShowCelebration(false), 7000);
      return () => clearTimeout(t);
    }
    prevDebtRef.current = bankData.debt;
  }, [bankData.debt]);

  // Balance increased → cash register sound + easter eggs
  useEffect(() => {
    if (!bankInitializedRef.current) {
      // First real data load — seed refs silently, no sounds
      bankInitializedRef.current = true;
      prevDebtRef.current = bankData.debt;
      prevBalanceRef.current = bankData.balance;
      return;
    }
    const prev = prevBalanceRef.current;
    const curr = bankData.balance;

    const canPlaySound = audioEnabledRef.current && !startupGraceRef.current;
    const bankIsOpen = isBankOpenRef.current;

    if (curr > prev) {
      if (canPlaySound) playCashRegister(vol('cashregister'));

      // First Paycheck: balance was ≤ 0, now positive
      if (prev <= 0 && curr > 0 && !hasFirstPayFiredRef.current && partyRef.current.on) {
        hasFirstPayFiredRef.current = true; socket.emit("markFirstPayDone", { username: userName });
        if (canPlaySound) playCalibration(vol('firstpay'));
        if (bankIsOpen) {
          setShowFirstPay(true);
          const t = setTimeout(() => setShowFirstPay(false), 6000);
          return () => clearTimeout(t);
        }
      }

      // High Roller: balance crosses threshold for first time this session
      const whale = partyRef.current.whale;
      if (whale !== null && curr >= whale && !hasHighRollerFiredRef.current) {
        hasHighRollerFiredRef.current = true;
        socket.emit('markHighRollerDone', { username: userName });
        if (canPlaySound) playHighRollerSound(vol('highroller'));
        if (bankIsOpen) {
          setShowHighRoller(true);
          const t = setTimeout(() => setShowHighRoller(false), 7000);
          return () => clearTimeout(t);
        }
      }
    }

    // Overdraft: balance just went negative
    if (prev >= 0 && curr < 0 && partyRef.current.on) {
      if (canPlaySound) playWompWomp(vol('overdraft'));
      if (bankIsOpen) {
        setShowOverdraft(true);
        const t = setTimeout(() => setShowOverdraft(false), 7000);
        return () => clearTimeout(t);
      }
    }

    prevBalanceRef.current = curr;
  }, [bankData.balance]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isBankOpen || !bankOn) return null;

  // In a custom currency the box reads money as written ("2 gp 5 sp", "$4.34"), says how it read
  // it, and sends whole smallest units for the picked currency; CONFIRM waits for an amount.
  const promptRead = picked ? parseAmount(picked, promptAmount) : null;
  const promptProblem = picked && promptRead ? amountProblem(picked, promptRead, { positive: true }) : null;
  const promptReady = !promptRead || (promptRead.ok && promptRead.amount > 0);

  const open = (prompt: 'withdraw' | 'borrow' | 'pay') => { setRefused(null); setActivePrompt(prompt); };

  const handleAction = () => {
    if (picked && promptRead) {
      if (!promptRead.ok || promptRead.amount <= 0) return;
      const event = { withdraw: 'withdrawFunds', borrow: 'borrowFunds', pay: 'payDebt' }[activePrompt!];
      socket.emit(event, { username: userName, amount: promptRead.amount, currency: picked.id });
      setActivePrompt(null);
      setPromptAmount('');
      return;
    }
    const amount = parseFloat(promptAmount);
    if (isNaN(amount) || amount <= 0) {
      setActivePrompt(null);
      setPromptAmount('');
      return;
    }

    if (activePrompt === 'withdraw') {
      socket.emit('withdrawFunds', { username: userName, amount });
    } else if (activePrompt === 'borrow') {
      socket.emit('borrowFunds', { username: userName, amount });
    } else if (activePrompt === 'pay') {
      socket.emit('payDebt', { username: userName, amount });
    }

    setActivePrompt(null);
    setPromptAmount('');
  };

  // The picked currency's account in a custom system's money; the one balance otherwise.
  const shown = picked ? accountIn(bankData, currencies, picked) : bankData;
  const roundedBalance = Math.round(shown.balance * 100) / 100;
  const roundedDebt = Math.round(shown.debt * 100) / 100;
  const balanceColor = roundedBalance > 0 ? '#00ff66' : roundedBalance < 0 ? '#ff0044' : '#fff';
  const debtColor = roundedDebt > 0 ? '#ff0044' : '#fff';
  const pickedName = picked ? picked.name.toUpperCase() : '';
  /** A figure in a box: the currency's own writing, or today's icon and two decimals. */
  const figure = (value: number, color: string) => (picked
    ? <span style={{ fontSize: '20px', textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{unbroken(formatAmount(picked, value))}</span>
    : <><CurrencyIcon icon={currencyIcon} size={18} color={color} />{formatBankValue(value)}</>);
  // A currency that can't be owed has no DEBT box, unless something is owed in it all the same.
  const showDebt = !picked || picked.debt || shown.debt > 0;

  return (
    <DraggableWindow title="BANK.EXE" pos={pos} setPos={setPos} onClose={onClose} windowStyle={{ width: '420px' }} contentStyle={{ overflow: 'hidden', maxHeight: 'none', minHeight: '220px' }}>
      {picked && currencies.length > 1 && (
        <div role="group" aria-label="Accounts" style={{ margin: '10px 10px 0', border: '1px solid var(--dark-green)', display: 'flex', flexDirection: 'column' }}>
          {currencies.map((c, i) => {
            const a = accountIn(bankData, currencies, c);
            const on = c.id === picked.id;
            return (
              <button key={c.id} type="button" aria-pressed={on} data-testid={`bank-account-${c.id}`}
                onClick={() => { setPickedId(c.id); setRefused(null); }}
                style={{
                  display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: '2px 10px', width: '100%', padding: '5px 8px',
                  background: on ? 'color-mix(in srgb, var(--green) 14%, transparent)' : 'transparent',
                  boxShadow: on ? 'inset 3px 0 0 var(--green)' : 'none',
                  border: 0, borderBottom: i < currencies.length - 1 ? '1px solid var(--dark-green)' : 0,
                  color: 'var(--green)', fontFamily: 'inherit', fontSize: '12px', fontWeight: on ? 'bold' : 'normal', textAlign: 'left', cursor: 'pointer',
                }}>
                <span>{c.name.toUpperCase()}{i === 0 && <span style={{ fontSize: '9px', opacity: 0.6, marginLeft: '6px', fontWeight: 'normal' }}>MAIN</span>}</span>
                <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: a.balance < 0 ? 'var(--danger)' : undefined }}>{unbroken(formatAmount(c, a.balance))}</span>
                {a.debt > 0 && <span style={{ gridColumn: 2, textAlign: 'right', color: 'var(--danger)', fontSize: '10px', fontWeight: 'normal' }}>OWES {unbroken(formatAmount(c, a.debt))}</span>}
              </button>
            );
          })}
        </div>
      )}

      <div style={{ display: 'flex', gap: '20px', padding: '10px' }}>
        <div style={{ flex: 1, minWidth: 0, border: '1px solid #333', padding: '10px', background: 'rgba(0,0,0,0.5)' }}>
          <div style={{ textAlign: 'center', fontSize: '12px', color: '#888', marginBottom: '5px', textTransform: 'uppercase' }}>{picked ? `BALANCE · ${pickedName}` : 'BALANCE'}</div>
          <div data-testid="bank-balance" style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: '5px', fontSize: '24px', color: balanceColor, marginBottom: '15px' }}>
            {figure(shown.balance, balanceColor)}
          </div>
          <button className="panel-btn" style={{ width: '100%' }} onClick={() => open('withdraw')}>WITHDRAW</button>
        </div>

        {showDebt && (
          <div style={{ flex: 1, minWidth: 0, border: '1px solid #333', padding: '10px', background: 'rgba(0,0,0,0.5)' }}>
            <div style={{ textAlign: 'center', fontSize: '12px', color: '#888', marginBottom: '5px', textTransform: 'uppercase' }}>{picked ? `DEBT · ${pickedName}` : 'DEBT'}</div>
            <div data-testid="bank-debt" style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: '5px', fontSize: '24px', color: debtColor, marginBottom: '15px' }}>
              {figure(shown.debt, debtColor)}
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button className="panel-btn" style={{ flex: 1 }} onClick={() => open('borrow')} disabled={!!picked && !picked.debt}>BORROW</button>
              <button className="panel-btn" style={{ flex: 1 }} onClick={() => open('pay')}>PAY</button>
            </div>
          </div>
        )}
      </div>

      {picked && !picked.debt && (
        <div style={{ textAlign: 'center', fontSize: '10px', letterSpacing: '1px', opacity: 0.6, color: 'var(--green)', padding: '0 10px 6px' }}>
          {pickedName} CAN&apos;T BE BORROWED IN THIS GAME{picked.negative ? '' : ' · NEVER BELOW ZERO'}
        </div>
      )}
      {refused && (
        <div role="status" style={{ color: 'var(--danger)', fontSize: '11px', textAlign: 'center', padding: '0 10px 6px' }}>{refused}</div>
      )}

      {/* Keyed by currency, so picking another starts its own chart rather than reading the switch as a crash. */}
      <CandleChart key={picked ? picked.id : 'money'} balance={shown.balance} />

      {activePrompt && (
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 10 }}>
          <div style={{ background: '#111', border: '1px solid #444', padding: '20px', width: '200px' }}>
            <div style={{ color: '#00ff66', marginBottom: '10px', textTransform: 'uppercase', textAlign: 'center' }}>
              AMOUNT TO {activePrompt === 'pay' ? 'PAY OFF' : activePrompt.toUpperCase()}?
              {picked && <div style={{ fontSize: '10px', opacity: 0.7 }}>IN {pickedName}</div>}
            </div>
            {picked ? (
              <>
                <input type="text" aria-label="Amount" autoComplete="off" value={promptAmount}
                  onChange={(e) => setPromptAmount(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAction(); }}
                  style={{ width: '100%', padding: '5px', marginBottom: '6px', background: '#000', color: '#fff', border: '1px solid #333', outline: 'none', textAlign: 'center' }} autoFocus />
                <div data-testid="bank-amount-read" style={{ minHeight: '2.4em', fontSize: '10px', textAlign: 'center', marginBottom: '6px', lineHeight: 1.4,
                  color: promptProblem ? 'var(--danger)' : promptAmount.trim() ? 'var(--cyan)' : 'var(--text)', opacity: promptAmount.trim() ? 1 : 0.6 }}>
                  {promptProblem ?? (promptAmount.trim() && promptRead?.ok ? `READS AS ${formatAmount(picked, promptRead.amount)}` : `Write it like ${amountExample(picked)}`)}
                </div>
              </>
            ) : (
              <input type="number" step="1" min="1" value={promptAmount} onChange={(e) => setPromptAmount(e.target.value)} style={{ width: '100%', padding: '5px', marginBottom: '10px', background: '#000', color: '#fff', border: '1px solid #333', outline: 'none', textAlign: 'center' }} autoFocus />
            )}
            <div style={{ display: 'flex', gap: '10px' }}>
              <button className="panel-btn" style={{ flex: 1 }} onClick={handleAction} disabled={!promptReady}>CONFIRM</button>
              <button className="panel-btn" style={{ flex: 1 }} onClick={() => setActivePrompt(null)}>CANCEL</button>
            </div>
          </div>
        </div>
      )}

      {showCelebration && (
        <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', zIndex: 20, borderRadius: 'inherit' }}>
          <style>{CELEBRATION_CSS}</style>

          {/* Confetti rain */}
          {confettiPieces.map((p, i) => (
            <div key={i} style={{
              position: 'absolute',
              left: `${p.left}%`,
              top: 0,
              width: p.size,
              height: p.size,
              background: p.color,
              borderRadius: p.round ? '50%' : '2px',
              animation: `confetti-fall ${p.duration}s ${p.delay}s ease-in forwards`,
              pointerEvents: 'none',
            }} />
          ))}

          {/* Dark backing so text is readable */}
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.72)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '10px', padding: '16px' }}>

            <div style={{
              fontSize: '26px', fontWeight: 'bold', fontFamily: 'monospace', textAlign: 'center',
              background: 'linear-gradient(90deg, #00ff66, #00ccff, #00ff66)',
              backgroundSize: '200% auto',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              animation: 'congrats-pop 0.6s cubic-bezier(0.34,1.56,0.64,1) both, debt-free-shimmer 2s linear 0.6s infinite',
            }}>
              🎉 CONGRATS!!! 🎉
            </div>

            <div style={{
              fontSize: '13px', color: '#aaa', fontFamily: 'monospace', textAlign: 'center',
              animation: 'congrats-pop 0.6s 0.15s cubic-bezier(0.34,1.56,0.64,1) both',
            }}>
              DEBT CLEARED — YOU ARE FREE
            </div>

            <div style={{
              fontSize: '64px', lineHeight: 1,
              animation: 'star-drop 0.8s 0.4s cubic-bezier(0.34,1.56,0.64,1) both, star-glow 1.6s 1.2s ease-in-out infinite',
              display: 'inline-block',
            }}>
              ⭐
            </div>

            <div style={{
              fontSize: '15px', color: 'var(--warning)', fontFamily: 'monospace', fontWeight: 'bold', textAlign: 'center',
              animation: 'congrats-pop 0.6s 0.7s cubic-bezier(0.34,1.56,0.64,1) both',
            }}>
              You Deserve a Star
            </div>

            <button
              className="panel-btn"
              onClick={() => setShowCelebration(false)}
              style={{ marginTop: '8px', animation: 'congrats-pop 0.5s 1s both' }}
            >
              THANKS ✓
            </button>
          </div>
        </div>
      )}

      {/* ── HIGH ROLLER ── */}
      {showHighRoller && (
        <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', zIndex: 20, borderRadius: 'inherit' }}>
          <style>{HIGH_ROLLER_CSS}</style>

          {creditRainPieces.map((p, i) => (
            <div key={i} style={{
              position: 'absolute', left: `${p.left}%`, top: 0,
              fontSize: p.size, color: 'var(--warning)', pointerEvents: 'none',
              animation: `credit-rain ${p.duration}s ${p.delay}s ease-in forwards`,
            }}>₡</div>
          ))}

          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.78)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '14px', padding: '20px' }}>
            <div style={{ fontSize: '52px', animation: 'whale-pop 0.65s cubic-bezier(0.34,1.56,0.64,1) both' }}>🐋</div>

            <div style={{
              fontSize: '22px', fontWeight: 'bold', fontFamily: 'monospace', textAlign: 'center',
              background: 'linear-gradient(90deg, var(--warning), #ff8800, var(--warning))',
              backgroundSize: '200% auto',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              animation: 'whale-pop 0.65s 0.1s cubic-bezier(0.34,1.56,0.64,1) both, gold-shimmer 2s linear 0.75s infinite',
            }}>
              WHALE STATUS ACHIEVED
            </div>

            <div style={{ fontSize: '13px', color: 'var(--warning)', fontFamily: 'monospace', textAlign: 'center', opacity: 0.8, animation: 'whale-pop 0.5s 0.3s both' }}>
              BALANCE EXCEEDED {currencies.length ? formatAmount(currencies[0], party.whale ?? 0) : `₡${(party.whale ?? 0).toLocaleString()}`}
            </div>
            <div style={{ fontSize: '12px', color: '#888', fontFamily: 'monospace', textAlign: 'center', animation: 'whale-pop 0.5s 0.45s both' }}>
              The city knows your name now.
            </div>

            <button className="panel-btn" onClick={() => setShowHighRoller(false)} style={{ marginTop: '8px', borderColor: 'var(--warning)', color: 'var(--warning)', animation: 'whale-pop 0.5s 0.8s both' }}>
              I KNOW 💰
            </button>
          </div>
        </div>
      )}

      {/* ── FIRST PAYCHECK ── */}
      {showFirstPay && (
        <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', zIndex: 20, borderRadius: 'inherit' }}>
          <style>{FIRST_PAY_CSS}</style>

          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.78)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '14px', padding: '20px' }}>
            <div style={{ fontSize: '52px', animation: 'coin-bounce 0.7s cubic-bezier(0.34,1.56,0.64,1) both' }}>🎊</div>

            <div style={{
              fontSize: '20px', fontWeight: 'bold', fontFamily: 'monospace', textAlign: 'center',
              background: 'linear-gradient(90deg, #00ff66, #00ccff, #00ff66)',
              backgroundSize: '200% auto',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              animation: 'coin-bounce 0.7s 0.12s cubic-bezier(0.34,1.56,0.64,1) both, pay-shimmer 2s linear 0.82s infinite',
            }}>
              FIRST PAYDAY
            </div>

            <div style={{ fontSize: '13px', color: '#00ff66', fontFamily: 'monospace', textAlign: 'center', animation: 'coin-bounce 0.5s 0.3s both' }}>
              Welcome to the economy, choom.
            </div>
            <div style={{ fontSize: '12px', color: '#888', fontFamily: 'monospace', textAlign: 'center', animation: 'coin-bounce 0.5s 0.45s both' }}>
              Try not to spend it all at once.
            </div>

            <button className="panel-btn" onClick={() => setShowFirstPay(false)} style={{ marginTop: '8px', animation: 'coin-bounce 0.5s 0.8s both' }}>
              THANKS, I WILL 🫡
            </button>
          </div>
        </div>
      )}

      {/* ── OVERDRAFT ── */}
      {showOverdraft && (
        <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', zIndex: 20, borderRadius: 'inherit' }}>
          <style>{OVERDRAFT_CSS}</style>

          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.82)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '16px' }}>

            {/* Row of drooping sad faces */}
            <div style={{ display: 'flex', gap: '8px' }}>
              {['😢', '😞', '😔'].map((emoji, i) => (
                <div key={i} style={{
                  fontSize: '32px',
                  animation: `sad-droop 0.6s ${i * 0.12}s cubic-bezier(0.34,1.56,0.64,1) both, sad-wobble 2.4s ${0.8 + i * 0.1}s ease-in-out infinite`,
                  display: 'inline-block',
                }}>{emoji}</div>
              ))}
            </div>

            <div style={{
              fontSize: '18px', fontWeight: 'bold', fontFamily: 'monospace', color: '#ff4444', textAlign: 'center',
              animation: 'overdraft-flicker 2s 0.5s ease-in-out infinite',
            }}>
              BALANCE NEGATIVE
            </div>

            <div style={{
              fontSize: '13px', color: '#ff8888', fontFamily: 'monospace', textAlign: 'center', maxWidth: '280px',
              animation: 'fine-print-slide 0.5s 0.6s both',
            }}>
              We'll overlook the overdraft fee.
            </div>
            <div style={{
              fontSize: '11px', color: '#888', fontFamily: 'monospace', textAlign: 'center', fontStyle: 'italic',
              animation: 'fine-print-slide 0.5s 0.85s both',
            }}>
              This time...
            </div>

            <button className="panel-btn" onClick={() => setShowOverdraft(false)} style={{ marginTop: '8px', borderColor: '#ff4444', color: '#ff4444', animation: 'fine-print-slide 0.4s 1.1s both' }}>
              I'M SORRY 😔
            </button>
          </div>
        </div>
      )}
    </DraggableWindow>
  );
}

// ── CANDLE CHART ──────────────────────────────────────────────────────────────

interface Candle { open: number; close: number; high: number; low: number; }

const CANDLE_COUNT = 28;
const CANDLE_INTERVAL_MS = 2500;

/**
 * How far a change in the balance nudges the next candle.
 *
 * By the size of the change rather than the amount: it was `change * 0.012`, tuned for
 * everyday sums, so +500cr was a green tick of 6 but a 150,000cr sale was a jump of 1,800
 * on a chart that sits near 100 - one spike, and the rescale flattened every other candle
 * into a line for a minute. On a log scale 500cr is still about 6, 50,000cr about 10, and
 * nothing goes past the cap. Money in is up, money out is down, as before.
 */
export const BALANCE_BIAS_CAP = 14;
export const balanceBias = (change: number): number => {
  if (!Number.isFinite(change) || change === 0) return 0;
  return Math.sign(change) * Math.min(BALANCE_BIAS_CAP, Math.log10(1 + Math.abs(change)) * 2.2);
};

export function generateNextCandle(prev: Candle, biasDelta: number): Candle {
  const drift = balanceBias(biasDelta) + (Math.random() - 0.48) * 4.5;
  const bodySize = 1.5 + Math.random() * 5;
  const open = prev.close;
  const close = open + drift + (Math.random() - 0.5) * bodySize;
  const high = Math.max(open, close) + Math.random() * 3;
  const low = Math.min(open, close) - Math.random() * 3;
  return { open, close, high, low };
}

function seedCandles(startPrice: number): Candle[] {
  const candles: Candle[] = [];
  let price = startPrice;
  for (let i = 0; i < CANDLE_COUNT; i++) {
    const drift = (Math.random() - 0.48) * 3.5;
    const bodySize = 1.5 + Math.random() * 5;
    const open = price;
    const close = open + drift + (Math.random() - 0.5) * bodySize;
    const high = Math.max(open, close) + Math.random() * 3;
    const low = Math.min(open, close) - Math.random() * 3;
    candles.push({ open, close, high, low });
    price = close;
  }
  return candles;
}

const FAKE_TICKERS: { name: string; ticker: string }[] = [
  { name: 'NEON DYNAMICS',       ticker: 'NDX' },
  { name: 'GHOST PROTOCOL TECH', ticker: 'GPT' },
  { name: 'AXIOM CORP',          ticker: 'AXM' },
  { name: 'SYNTHEX INDUSTRIES',  ticker: 'SYX' },
  { name: 'VORTEX CAPITAL',      ticker: 'VTX' },
  { name: 'HELIX BIOSYNTH',      ticker: 'HLX' },
  { name: 'OMNIVAULT SYSTEMS',   ticker: 'OVS' },
  { name: 'DARKPOOL FINANCE',    ticker: 'DPF' },
  { name: 'CHROME FUTURES',      ticker: 'CRF' },
  { name: 'PARALLAX HOLDINGS',   ticker: 'PRX' },
  { name: 'CIPHER NETWORKS',     ticker: 'CPH' },
  { name: 'ZERO POINT ENERGY',   ticker: 'ZPE' },
  { name: 'REDLINE MOTORS',      ticker: 'RLM' },
  { name: 'SPECTRE ARMS',        ticker: 'SPA' },
  { name: 'NEURAL LATTICE',      ticker: 'NLT' },
  { name: 'BLACKSITE VENTURES',  ticker: 'BSV' },
  { name: 'MIRAGE LOGISTICS',    ticker: 'MRL' },
  { name: 'PULSE PHARMA',        ticker: 'PLP' },
  { name: 'VOID TECHNOLOGIES',   ticker: 'VDT' },
  { name: 'APEX MUNITIONS',      ticker: 'APX' },
];

function CandleChart({ balance }: { balance: number }) {
  const [candles, setCandles] = useState<Candle[]>(() => seedCandles(100));
  const [ticker] = useState(() => FAKE_TICKERS[Math.floor(Math.random() * FAKE_TICKERS.length)]);
  const prevBalanceRef = useRef(balance);

  useEffect(() => {
    const id = setInterval(() => {
      const biasDelta = balance - prevBalanceRef.current;
      prevBalanceRef.current = balance;
      setCandles(prev => [...prev.slice(1), generateNextCandle(prev[prev.length - 1], biasDelta)]);
    }, CANDLE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [balance]);

  const W = 390;
  const H = 110;
  const PAD = { top: 8, bottom: 8, left: 6, right: 40 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;
  const candleW = chartW / CANDLE_COUNT;
  const bodyW = Math.max(2, candleW * 0.55);

  const allPrices = candles.flatMap(c => [c.high, c.low]);
  const minP = Math.min(...allPrices);
  const maxP = Math.max(...allPrices);
  const range = maxP - minP || 1;
  const toY = (p: number) => PAD.top + chartH - ((p - minP) / range) * chartH;

  const lastCandle = candles[candles.length - 1];
  const lastPrice = lastCandle.close;
  const firstPrice = candles[0].open;
  const sessionUp = lastPrice >= firstPrice;
  const upColor = '#00ff66';
  const downColor = 'var(--danger)';
  const priceColor = sessionUp ? upColor : downColor;

  return (
    <div style={{ padding: '0 10px 10px', userSelect: 'none' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '4px' }}>
        <span style={{ fontSize: '9px', color: '#444', fontFamily: 'monospace', letterSpacing: '1px' }}>{ticker.name} &nbsp; {ticker.ticker}</span>
        <span style={{ fontSize: '10px', fontFamily: 'monospace', color: priceColor, textShadow: `0 0 6px ${priceColor}` }}>
          {sessionUp ? '▲' : '▼'} {Math.abs(lastPrice - firstPrice).toFixed(2)}
        </span>
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', background: 'rgba(0,0,0,0.4)', border: '1px solid #1a1a1a' }}>
        {[0.25, 0.5, 0.75].map(t => (
          <line key={t} x1={PAD.left} x2={W - PAD.right} y1={PAD.top + chartH * t} y2={PAD.top + chartH * t} stroke="#0d200d" strokeWidth="1" />
        ))}

        {candles.map((c, i) => {
          const x = PAD.left + i * candleW + candleW / 2;
          const bull = c.close >= c.open;
          const color = bull ? upColor : downColor;
          const bodyTop = toY(Math.max(c.open, c.close));
          const bodyBot = toY(Math.min(c.open, c.close));
          const bodyH = Math.max(1, bodyBot - bodyTop);
          return (
            <g key={i}>
              <line x1={x} x2={x} y1={toY(c.high)} y2={toY(c.low)} stroke={color} strokeWidth="1" opacity="0.6" />
              <rect
                x={x - bodyW / 2} y={bodyTop} width={bodyW} height={bodyH}
                fill={bull ? color : 'none'} stroke={color} strokeWidth="1"
              />
            </g>
          );
        })}

        <line x1={PAD.left} x2={W - PAD.right} y1={toY(lastPrice)} y2={toY(lastPrice)}
          stroke={priceColor} strokeWidth="1" strokeDasharray="3 3" opacity="0.6" />

        <text x={W - PAD.right + 4} y={toY(lastPrice) + 3} textAnchor="start"
          fill={priceColor} fontSize="8" fontFamily="monospace">
          {lastPrice.toFixed(1)}
        </text>

        <text x={W - PAD.right + 4} y={PAD.top + 4} textAnchor="start"
          fill="#333" fontSize="7" fontFamily="monospace">
          {maxP.toFixed(0)}
        </text>
        <text x={W - PAD.right + 4} y={H - PAD.bottom} textAnchor="start"
          fill="#333" fontSize="7" fontFamily="monospace">
          {minP.toFixed(0)}
        </text>
      </svg>
    </div>
  );
}
