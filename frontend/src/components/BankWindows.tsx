import React, { useState, useEffect, useRef, useMemo } from 'react';
import { DraggableWindow } from './DraggableWindow';
import creditsPngIcon from '../assets/Credits.png';

export type BankSoundKey = 'cashregister' | 'debtpaid' | 'highroller' | 'firstpay' | 'overdraft';
export type BankSoundVolumes = Record<BankSoundKey, number>;

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
}

export function AdminBankWindow({ pos, setPos, onClose, targetUser, socket, token }: AdminBankWindowProps) {
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
    <DraggableWindow title={`ADMIN BANK: ${targetUser}`} pos={pos} setPos={setPos} onClose={onClose} windowStyle={{ width: '300px' }}>
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

interface AdminPayWindowProps {
  pos: { x: number; y: number };
  setPos: (pos: { x: number; y: number }) => void;
  onClose: () => void;
  socket: any;
  token: string;
  activeUsers: any[];
}

export function AdminPayWindow({ pos, setPos, onClose, socket, token, activeUsers }: AdminPayWindowProps) {
  const [amount, setAmount] = useState('');
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);

  const allUsers = (activeUsers || [])
    .filter((u: any) => !u.isNPC && !(u.isAdmin && !u.isTemporaryAdmin))
    .map((u: any) => u.userName)
    .filter(Boolean);

  const toggleUser = (u: string) => {
    setSelectedUsers(prev => prev.includes(u) ? prev.filter(x => x !== u) : [...prev, u]);
  };

  const handlePay = () => {
    const total = parseFloat(amount);
    if (!isNaN(total) && total > 0 && selectedUsers.length > 0) {
      socket.emit('adminPayPlayers', { token, usernames: selectedUsers, totalAmount: total });
      onClose();
    }
  };

  const handleDivideAll = () => {
    const total = parseFloat(amount);
    if (!isNaN(total) && total > 0 && allUsers.length > 0) {
      socket.emit('adminPayPlayers', { token, usernames: allUsers, totalAmount: total });
      onClose();
    }
  };

  return (
    <DraggableWindow title="ADMIN // PAY_PLAYERS" pos={pos} setPos={setPos} onClose={onClose} windowStyle={{ width: '300px' }}>
      <div style={{ padding: '10px' }}>
        <label style={{ display: 'block', marginBottom: '5px', color: '#00ff66' }}>Total Amount</label>
        <input type="number" step="1" min="1" value={amount} onChange={e => setAmount(e.target.value)} style={{ width: '100%', padding: '5px', marginBottom: '15px', background: '#000', color: '#fff', border: '1px solid #333' }} />

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
          <button className="panel-btn" style={{ flex: 1 }} onClick={handleDivideAll} disabled={allUsers.length === 0}>DIVIDE_ALL</button>
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

const HIGH_ROLLER_THRESHOLD = 10000;

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
  bankData: { balance: number; debt: number };
  socket: any;
  userName: string;
  isBankOpen: boolean;
  firstPayDone?: boolean;
  highRollerDone?: boolean;
  audioEnabled?: boolean;
  soundVolumes?: Record<string, number>;
}

const CONFETTI_COLORS = ['#ff0066', '#00ff66', '#ffcc00', '#00ccff', '#ff6600', '#cc00ff', '#ffffff'];

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
  0%, 100% { text-shadow: 0 0 8px #ffcc00, 0 0 20px #ffcc00; }
  50%       { text-shadow: 0 0 20px #ffcc00, 0 0 50px #ff8800, 0 0 80px #ffcc00; }
}
@keyframes debt-free-shimmer {
  0%   { background-position: -200% center; }
  100% { background-position:  200% center; }
}
`;

export function BankWindow({ pos, setPos, onClose, bankData, socket, userName, isBankOpen, firstPayDone, highRollerDone, audioEnabled, soundVolumes }: BankWindowProps) {
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
    if (prevDebtRef.current > 0 && bankData.debt === 0) {
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
      if (prev <= 0 && curr > 0 && !hasFirstPayFiredRef.current) {
        hasFirstPayFiredRef.current = true; socket.emit("markFirstPayDone", { username: userName });
        if (canPlaySound) playCalibration(vol('firstpay'));
        if (bankIsOpen) {
          setShowFirstPay(true);
          const t = setTimeout(() => setShowFirstPay(false), 6000);
          return () => clearTimeout(t);
        }
      }

      // High Roller: balance crosses threshold for first time this session
      if (curr >= HIGH_ROLLER_THRESHOLD && !hasHighRollerFiredRef.current) {
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
    if (prev >= 0 && curr < 0) {
      if (canPlaySound) playWompWomp(vol('overdraft'));
      if (bankIsOpen) {
        setShowOverdraft(true);
        const t = setTimeout(() => setShowOverdraft(false), 7000);
        return () => clearTimeout(t);
      }
    }

    prevBalanceRef.current = curr;
  }, [bankData.balance]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isBankOpen) return null;

  const handleAction = () => {
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

  const roundedBalance = Math.round(bankData.balance * 100) / 100;
  const roundedDebt = Math.round(bankData.debt * 100) / 100;
  const balanceColor = roundedBalance > 0 ? '#00ff66' : roundedBalance < 0 ? '#ff0044' : '#fff';
  const debtColor = roundedDebt > 0 ? '#ff0044' : '#fff';

  return (
    <DraggableWindow title="CITY_NET // BANK" pos={pos} setPos={setPos} onClose={onClose} windowStyle={{ width: '420px' }} contentStyle={{ overflow: 'hidden', maxHeight: 'none', minHeight: '220px' }}>
      <div style={{ display: 'flex', gap: '20px', padding: '10px' }}>
        <div style={{ flex: 1, border: '1px solid #333', padding: '10px', background: 'rgba(0,0,0,0.5)' }}>
          <div style={{ textAlign: 'center', fontSize: '12px', color: '#888', marginBottom: '5px', textTransform: 'uppercase' }}>Balance</div>
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '5px', fontSize: '24px', color: balanceColor, marginBottom: '15px' }}>
            <div style={{ width: '18px', height: '18px', backgroundColor: balanceColor, WebkitMaskImage: `url(${creditsPngIcon})`, WebkitMaskSize: 'contain', WebkitMaskRepeat: 'no-repeat', WebkitMaskPosition: 'center', maskImage: `url(${creditsPngIcon})`, maskSize: 'contain', maskRepeat: 'no-repeat', maskPosition: 'center' }} />
            {formatBankValue(bankData.balance)}
          </div>
          <button className="panel-btn" style={{ width: '100%' }} onClick={() => setActivePrompt('withdraw')}>withdraw</button>
        </div>

        <div style={{ flex: 1, border: '1px solid #333', padding: '10px', background: 'rgba(0,0,0,0.5)' }}>
          <div style={{ textAlign: 'center', fontSize: '12px', color: '#888', marginBottom: '5px', textTransform: 'uppercase' }}>Debt</div>
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '5px', fontSize: '24px', color: debtColor, marginBottom: '15px' }}>
            <div style={{ width: '18px', height: '18px', backgroundColor: debtColor, WebkitMaskImage: `url(${creditsPngIcon})`, WebkitMaskSize: 'contain', WebkitMaskRepeat: 'no-repeat', WebkitMaskPosition: 'center', maskImage: `url(${creditsPngIcon})`, maskSize: 'contain', maskRepeat: 'no-repeat', maskPosition: 'center' }} />
            {formatBankValue(bankData.debt)}
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button className="panel-btn" style={{ flex: 1 }} onClick={() => setActivePrompt('borrow')}>borrow</button>
            <button className="panel-btn" style={{ flex: 1 }} onClick={() => setActivePrompt('pay')}>pay</button>
          </div>
        </div>
      </div>

      <CandleChart balance={bankData.balance} />

      {activePrompt && (
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 10 }}>
          <div style={{ background: '#111', border: '1px solid #444', padding: '20px', width: '200px' }}>
            <div style={{ color: '#00ff66', marginBottom: '10px', textTransform: 'uppercase', textAlign: 'center' }}>Amount to {activePrompt}?</div>
            <input type="number" step="1" min="1" value={promptAmount} onChange={(e) => setPromptAmount(e.target.value)} style={{ width: '100%', padding: '5px', marginBottom: '10px', background: '#000', color: '#fff', border: '1px solid #333', outline: 'none', textAlign: 'center' }} autoFocus />
            <div style={{ display: 'flex', gap: '10px' }}>
              <button className="panel-btn" style={{ flex: 1 }} onClick={handleAction}>Okay</button>
              <button className="panel-btn" style={{ flex: 1 }} onClick={() => setActivePrompt(null)}>Cancel</button>
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
              fontSize: '15px', color: '#ffcc00', fontFamily: 'monospace', fontWeight: 'bold', textAlign: 'center',
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
              fontSize: p.size, color: '#ffcc00', pointerEvents: 'none',
              animation: `credit-rain ${p.duration}s ${p.delay}s ease-in forwards`,
            }}>₡</div>
          ))}

          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.78)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '14px', padding: '20px' }}>
            <div style={{ fontSize: '52px', animation: 'whale-pop 0.65s cubic-bezier(0.34,1.56,0.64,1) both' }}>🐋</div>

            <div style={{
              fontSize: '22px', fontWeight: 'bold', fontFamily: 'monospace', textAlign: 'center',
              background: 'linear-gradient(90deg, #ffcc00, #ff8800, #ffcc00)',
              backgroundSize: '200% auto',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              animation: 'whale-pop 0.65s 0.1s cubic-bezier(0.34,1.56,0.64,1) both, gold-shimmer 2s linear 0.75s infinite',
            }}>
              WHALE STATUS ACHIEVED
            </div>

            <div style={{ fontSize: '13px', color: '#ffcc00', fontFamily: 'monospace', textAlign: 'center', opacity: 0.8, animation: 'whale-pop 0.5s 0.3s both' }}>
              BALANCE EXCEEDED ₡{HIGH_ROLLER_THRESHOLD.toLocaleString()}
            </div>
            <div style={{ fontSize: '12px', color: '#888', fontFamily: 'monospace', textAlign: 'center', animation: 'whale-pop 0.5s 0.45s both' }}>
              The city knows your name now.
            </div>

            <button className="panel-btn" onClick={() => setShowHighRoller(false)} style={{ marginTop: '8px', borderColor: '#ffcc00', color: '#ffcc00', animation: 'whale-pop 0.5s 0.8s both' }}>
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

function generateNextCandle(prev: Candle, biasDelta: number): Candle {
  const drift = biasDelta * 0.012 + (Math.random() - 0.48) * 4.5;
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
  const downColor = '#ff3333';
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
