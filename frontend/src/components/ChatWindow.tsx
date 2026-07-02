import React, { useState, useEffect, useRef } from 'react';
import { DraggableWindow } from './DraggableWindow';

interface ChatWindowProps {
  pos: { x: number; y: number };
  setPos: (pos: { x: number; y: number }) => void;
  onClose: () => void;
  messages: any[];
  activeUsers: any[];
  userName: string;
  onSendMessage: (text: string, sendAs: string) => void;
  notificationsEnabled: boolean;
  onToggleNotifications: () => void;
  isPrimaryAdmin: boolean;
  onGrantAccess: (userName: string) => void;
  onRevokeAccess: (userName: string) => void;
  onOpenPlayerInfo: (userName: string) => void;
  socket: any;
  token: string;
  isChatOpen: boolean;
}

export function ChatWindow({ pos, setPos, onClose, messages, activeUsers, userName, onSendMessage, notificationsEnabled, onToggleNotifications, isPrimaryAdmin, onGrantAccess, onRevokeAccess, onOpenPlayerInfo, socket, token, isChatOpen }: ChatWindowProps) {
  const [inputText, setInputText] = useState('');

  const [activeTab, setActiveTab] = useState('GLOBAL');
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [privateMessages, setPrivateMessages] = useState<Record<string, any[]>>({});
  const [unreadTabs, setUnreadTabs] = useState<Set<string>>(new Set());
  const [sendAs, setSendAs] = useState(userName);

  const [npcNameInput, setNpcNameInput] = useState('');
  const [showNpcPrompt, setShowNpcPrompt] = useState(false);
  const [lastNpcContext, setLastNpcContext] = useState<Record<string, string>>({});

  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const lastMessageCountRef = useRef(messages.length);

  useEffect(() => {
    if (messages.length > lastMessageCountRef.current) {
      if (activeTab !== 'GLOBAL') {
        const lastMsg = messages[messages.length - 1];
        if (lastMsg.sender !== userName && lastMsg.sender !== sendAs) {
          setUnreadTabs(prev => new Set(prev).add('GLOBAL'));
        }
      }
    }
    lastMessageCountRef.current = messages.length;
  }, [messages, activeTab, userName, sendAs]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, privateMessages, activeTab]);

  useEffect(() => {
    if (!socket) return;

    const handleReceivePM = (msg: any) => {
      const npcs = activeUsers.filter((u: any) => u.isNPC).map((u: any) => u.userName);
      let tabName = '';

      const senderIsNPC = npcs.includes(msg.sender);
      const recipientIsNPC = npcs.includes(msg.recipient);

      if (msg.sender === userName || (isPrimaryAdmin && senderIsNPC)) {
        tabName = msg.recipient;
        if (senderIsNPC) {
          tabName = `${msg.recipient} [${msg.sender}]`;
          setLastNpcContext(prev => ({ ...prev, [tabName]: msg.sender }));
        }
      } else if (msg.recipient === userName || (isPrimaryAdmin && recipientIsNPC)) {
        tabName = msg.sender;
        if (recipientIsNPC) {
          tabName = `${msg.sender} [${msg.recipient}]`;
          setLastNpcContext(prev => ({ ...prev, [tabName]: msg.recipient }));
        }
      } else {
        return;
      }

      setPrivateMessages(prev => {
        const history = prev[tabName] || [];
        return { ...prev, [tabName]: [...history, msg] };
      });

      setActiveTab(currentActive => {
        if (currentActive !== tabName) {
          setUnreadTabs(prev => new Set(prev).add(tabName));
          setOpenTabs(prev => prev.includes(tabName) ? prev : [...prev, tabName]);
        }
        return currentActive;
      });
    };

    const handlePrivateHistory = (data: any) => {
      setPrivateMessages(prev => ({ ...prev, [data.targetUser]: data.history }));
    };

    const handlePurge = () => {
      setPrivateMessages({});
      setOpenTabs([]);
      setActiveTab('GLOBAL');
      setUnreadTabs(new Set());
    };

    socket.on('receivePrivateMessage', handleReceivePM);
    socket.on('privateHistory', handlePrivateHistory);
    socket.on('purgePrivateMessages', handlePurge);

    return () => {
      socket.off('receivePrivateMessage', handleReceivePM);
      socket.off('privateHistory', handlePrivateHistory);
      socket.off('purgePrivateMessages', handlePurge);
    };
  }, [socket, userName, isPrimaryAdmin, activeUsers]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputText.trim()) {
      if (activeTab === 'GLOBAL') {
        onSendMessage(inputText, sendAs);
      } else {
        let realRecipient = activeTab;
        const match = activeTab.match(/^(.+?) \[(.+?)\]$/);
        if (match) realRecipient = match[1];
        socket.emit('sendPrivateMessage', { sender: sendAs, recipient: realRecipient, text: inputText });
      }
      setInputText('');
    }
  };

  const handleCreateNPC = () => {
    if (npcNameInput.trim() && token) {
      socket.emit('createNPC', { adminToken: token, npcName: npcNameInput.trim() });
      setNpcNameInput('');
      setShowNpcPrompt(false);
    }
  };

  const openTab = (targetUser: string) => {
    if (!openTabs.includes(targetUser)) {
      setOpenTabs(prev => [...prev, targetUser]);
    }
    setActiveTab(targetUser);
    setActiveDropdown(null);
    setUnreadTabs(prev => { const next = new Set(prev); next.delete(targetUser); return next; });

    let historyUser1 = userName;
    let historyUser2 = targetUser;
    const match = targetUser.match(/^(.+?) \[(.+?)\]$/);
    if (match) {
      historyUser1 = match[2];
      historyUser2 = match[1];
      setSendAs(match[2]);
    } else {
      setSendAs(userName);
    }

    socket.emit('getPrivateHistory', { user1: historyUser1, user2: historyUser2, originalTab: targetUser });
  };

  const closeTab = (e: React.MouseEvent, targetUser: string) => {
    e.stopPropagation();
    setOpenTabs(prev => prev.filter(t => t !== targetUser));
    if (activeTab === targetUser) setActiveTab('GLOBAL');
  };

  const handleUserClick = (user: any) => {
    if (user.userName === userName) return;
    setActiveDropdown(activeDropdown === user.userName ? null : user.userName);
  };

  const displayMessages = activeTab === 'GLOBAL' ? messages : (privateMessages[activeTab] || []);
  const myNPCs = activeUsers.filter((u: any) => u.isNPC && u.isActive !== false).map((u: any) => u.userName);
  const showSendAs = isPrimaryAdmin && myNPCs.length > 0;

  return (
    <div style={{ display: isChatOpen ? 'block' : 'none' }}>
      <DraggableWindow
        title="CITY_NET // COMMS"
        pos={pos}
        setPos={setPos}
        onClose={onClose}
        windowStyle={{ maxWidth: 'none', width: '600px', height: '400px', minWidth: '400px', minHeight: '300px', resize: 'both', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
        contentStyle={{ maxHeight: 'none', padding: 0, flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        notificationsEnabled={notificationsEnabled}
        onToggleNotifications={onToggleNotifications}
      >
        {activeDropdown && (
          <div
            style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 999 }}
            onClick={() => setActiveDropdown(null)}
          />
        )}

        <div style={{ display: 'flex', background: 'var(--dark-green)', padding: '5px 5px 0 5px', gap: '5px', overflowX: 'auto', flexShrink: 0 }}>
          <div
            className={unreadTabs.has('GLOBAL') ? 'unread-blink' : ''}
            onClick={() => { setActiveTab('GLOBAL'); setSendAs(userName); setUnreadTabs(prev => { const next = new Set(prev); next.delete('GLOBAL'); return next; }); }}
            style={{ padding: '8px 15px', background: activeTab === 'GLOBAL' ? 'var(--black)' : 'transparent', color: activeTab === 'GLOBAL' ? 'var(--green)' : (unreadTabs.has('GLOBAL') ? '#ffaa00' : '#888'), borderTopLeftRadius: '5px', borderTopRightRadius: '5px', cursor: 'pointer', fontWeight: 'bold' }}
          >
            [ GLOBAL ] {unreadTabs.has('GLOBAL') && '*'}
          </div>
          {openTabs.map(tab => (
            <div
              key={tab}
              className={unreadTabs.has(tab) ? 'unread-blink' : ''}
              onClick={() => openTab(tab)}
              style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 15px', background: activeTab === tab ? 'var(--black)' : 'transparent', color: activeTab === tab ? 'var(--cyan)' : (unreadTabs.has(tab) ? '#ffaa00' : '#888'), borderTopLeftRadius: '5px', borderTopRightRadius: '5px', cursor: 'pointer', fontWeight: 'bold' }}
            >
              {tab} {unreadTabs.has(tab) && '*'}
              <span onClick={(e) => closeTab(e, tab)} style={{ color: '#ff0000', marginLeft: '5px', cursor: 'pointer' }}>×</span>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'row', flex: 1, background: 'var(--black)', minHeight: 0 }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderRight: '2px solid var(--dark-green)', minWidth: 0 }}>
            <div
              ref={scrollRef}
              style={{ flex: 1, overflowY: 'auto', padding: '15px', fontSize: '0.8rem', textAlign: 'left' }}
            >
              {displayMessages.map((msg: any) => (
                <div key={msg.id || Math.random()} style={{ marginBottom: '10px', opacity: msg.sender === 'SYSTEM' ? 0.6 : 1 }}>
                  <span style={{ color: 'var(--green)', fontSize: '0.65rem', marginRight: '8px', fontFamily: 'monospace' }}>[{msg.timestamp}]</span>
                  <span style={{ color: msg.sender === userName ? 'var(--cyan)' : (msg.sender === 'SYSTEM' ? '#ff0000' : (myNPCs.includes(msg.sender) ? '#ffaa00' : 'var(--green)')), fontWeight: 'bold' }}>
                    {msg.sender}:
                  </span>
                  <span style={{ marginLeft: '8px', wordBreak: 'break-all', color: activeTab === 'GLOBAL' ? '#fff' : '#aaa' }}>{msg.text}</span>
                </div>
              ))}
            </div>
            <form onSubmit={handleSubmit} style={{ padding: '10px', display: 'flex', gap: '5px', background: 'rgba(0,25,0,0.5)', borderTop: '2px solid var(--dark-green)', alignItems: 'center', flexShrink: 0, flexWrap: 'wrap' }}>
              {showSendAs && (
                <select
                  value={sendAs}
                  onChange={(e) => setSendAs(e.target.value)}
                  style={{ background: 'var(--black)', border: '1px solid var(--green)', color: 'var(--green)', padding: '10px', fontSize: '0.8rem', cursor: 'pointer' }}
                >
                  <option value={userName}>{userName}</option>
                  {myNPCs.map((npc: string) => (
                    <option key={npc} value={npc}>[NPC] {npc}</option>
                  ))}
                </select>
              )}
              <input
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                placeholder={activeTab === 'GLOBAL' ? "TYPE_GLOBAL_BROADCAST..." : `ENCRYPTED_MESSAGE_TO_${activeTab}...`}
                style={{ flex: 1, background: 'rgba(0,40,0,0.6)', border: '1px solid var(--green)', color: 'var(--green)', padding: '10px', fontSize: '0.9rem' }}
              />
              <button type="submit" className="upload-btn" style={{ width: '100px', margin: 0 }}>SEND</button>
            </form>
          </div>

          <div style={{ width: '160px', display: 'flex', flexDirection: 'column', background: 'rgba(0,10,0,0.3)', flexShrink: 0 }}>
            <div style={{ padding: '8px', fontSize: '0.7rem', fontWeight: 'bold', borderBottom: '2px solid var(--dark-green)', color: 'var(--green)', textShadow: 'var(--glow)', textAlign: 'center' }}>OPERATORS_ONLINE</div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '10px', position: 'relative' }}>
              {activeUsers.map((user: any) => {
                const dotColor = user.isAdmin ? '#ff0000' : (user.isTemporaryAdmin ? '#ffaa00' : (user.isNPC ? (user.isActive === false ? '#555' : '#aa00ff') : 'var(--green)'));
                const dotShadow = (user.isNPC && user.isActive === false) ? 'none' : `0 0 5px ${dotColor}`;
                return (
                  <div key={user.userName} style={{ position: 'relative' }}>
                    <div
                      onClick={() => handleUserClick(user)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        marginBottom: '10px',
                        padding: '5px',
                        background: user.userName === userName ? 'rgba(0,255,255,0.05)' : 'transparent',
                        cursor: user.userName !== userName ? 'pointer' : 'default',
                        borderRadius: '4px',
                        opacity: (user.isNPC && user.isActive === false) ? 0.5 : 1
                      }}
                      onMouseOver={(e) => {
                        if (user.userName !== userName) e.currentTarget.style.background = 'rgba(0,255,255,0.1)';
                      }}
                      onMouseOut={(e) => {
                        e.currentTarget.style.background = user.userName === userName ? 'rgba(0,255,255,0.05)' : 'transparent';
                      }}
                    >
                      <div style={{ width: '6px', height: '6px', background: dotColor, borderRadius: '50%', boxShadow: dotShadow }}></div>
                      <span style={{ color: user.userName === userName ? 'var(--cyan)' : '#888', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '5px' }}>
                        {user.userName}
                        {user.isAdmin && <span title="Primary Admin"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="#ff7b00" style={{verticalAlign:'middle'}}><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/></svg></span>}
                        {user.isTemporaryAdmin && <span title="Temporary Admin"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="#ffaa00" style={{verticalAlign:'middle'}}><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/></svg></span>}
                        {user.isNPC && <span title="NPC" style={{ color: user.isActive === false ? '#555' : '#aa00ff' }}>[NPC]</span>}
                      </span>
                    </div>

                    {activeDropdown === user.userName && (
                      <div style={{ position: 'absolute', top: '25px', left: '15px', background: 'var(--black)', border: '1px solid var(--green)', padding: '5px', zIndex: 1000, display: 'flex', flexDirection: 'column', gap: '5px', minWidth: '150px' }}>
                        <button
                          className="utility-btn"
                          style={{ margin: 0, textAlign: 'left', width: '100%' }}
                          onClick={() => openTab(user.userName)}
                        >
                          PRIVATE_MESSAGE
                        </button>

                        {!user.isNPC && (
                          <button
                            className="utility-btn"
                            style={{ margin: 0, textAlign: 'left', width: '100%' }}
                            onClick={() => { onOpenPlayerInfo(user.userName); setActiveDropdown(null); }}
                          >
                            VIEW_PLAYER_INFO
                          </button>
                        )}

                        {isPrimaryAdmin && !user.isAdmin && !user.isNPC && (
                          <button
                            className={`utility-btn ${user.isTemporaryAdmin ? 'danger-btn' : ''}`}
                            style={{ margin: 0, textAlign: 'left', width: '100%' }}
                            onClick={() => {
                              if (user.isTemporaryAdmin) onRevokeAccess(user.userName);
                              else onGrantAccess(user.userName);
                              setActiveDropdown(null);
                            }}
                          >
                            {user.isTemporaryAdmin ? 'REVOKE_ADMIN' : 'GRANT_ADMIN'}
                          </button>
                        )}

                        {isPrimaryAdmin && user.isNPC && (
                          <>
                            <button
                              className="utility-btn"
                              style={{ margin: 0, textAlign: 'left', width: '100%' }}
                              onClick={() => {
                                socket.emit('toggleNPCStatus', { adminToken: token, npcName: user.userName, isActive: user.isActive === false ? true : false });
                                setActiveDropdown(null);
                              }}
                            >
                              {user.isActive === false ? 'ACTIVATE_NPC' : 'DEACTIVATE_NPC'}
                            </button>
                            <button
                              className="danger-btn"
                              style={{ margin: 0, textAlign: 'left', width: '100%' }}
                              onClick={() => {
                                socket.emit('deleteNPC', { adminToken: token, npcName: user.userName });
                                setActiveDropdown(null);
                              }}
                            >
                              DELETE_NPC
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {isPrimaryAdmin && (
              <div style={{ padding: '10px', borderTop: '2px solid var(--dark-green)' }}>
                {showNpcPrompt ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                    <input
                      value={npcNameInput}
                      onChange={e => setNpcNameInput(e.target.value)}
                      placeholder="NPC NAME..."
                      style={{ background: 'var(--black)', border: '1px solid var(--green)', color: 'var(--green)', padding: '5px', fontSize: '0.7rem' }}
                    />
                    <div style={{ display: 'flex', gap: '5px' }}>
                      <button className="upload-btn" style={{ margin: 0, flex: 1, padding: '5px' }} onClick={handleCreateNPC}>CREATE</button>
                      <button className="utility-btn" style={{ margin: 0, flex: 1, padding: '5px' }} onClick={() => setShowNpcPrompt(false)}>CANCEL</button>
                    </div>
                  </div>
                ) : (
                  <button className="utility-btn" style={{ margin: 0, width: '100%' }} onClick={() => setShowNpcPrompt(true)}>
                    [+] ADD NPC
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </DraggableWindow>
    </div>
  );
}
