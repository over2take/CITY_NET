import React, { useState, useEffect } from 'react';
import { DraggableWindow } from './DraggableWindow';
import creditsPngIcon from '../assets/Credits.png';

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

interface BankWindowProps {
  pos: { x: number; y: number };
  setPos: (pos: { x: number; y: number }) => void;
  onClose: () => void;
  bankData: { balance: number; debt: number };
  socket: any;
  userName: string;
  isBankOpen: boolean;
}

export function BankWindow({ pos, setPos, onClose, bankData, socket, userName, isBankOpen }: BankWindowProps) {
  const [activePrompt, setActivePrompt] = useState<'withdraw' | 'borrow' | 'pay' | null>(null);
  const [promptAmount, setPromptAmount] = useState('');

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
    <DraggableWindow title="CITY_NET // BANK" pos={pos} setPos={setPos} onClose={onClose} windowStyle={{ width: '400px' }}>
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
    </DraggableWindow>
  );
}
