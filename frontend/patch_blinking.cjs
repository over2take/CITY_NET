const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

// Normalize line endings for reliable replace
code = code.replace(/\r\n/g, '\n');

const globalTabOld = `<div 
                  onClick={() => { setActiveTab('GLOBAL'); setSendAs(userName); }}
                  style={{ padding: '8px 15px', background: activeTab === 'GLOBAL' ? 'var(--black)' : 'transparent', color: activeTab === 'GLOBAL' ? 'var(--green)' : '#888', borderTopLeftRadius: '5px', borderTopRightRadius: '5px', cursor: 'pointer', fontWeight: 'bold' }}
                >
                  [ GLOBAL ]
                </div>`;

const globalTabNew = `<div 
                  className={unreadTabs.has('GLOBAL') ? 'unread-blink' : ''}
                  onClick={() => { setActiveTab('GLOBAL'); setSendAs(userName); }}
                  style={{ padding: '8px 15px', background: activeTab === 'GLOBAL' ? 'var(--black)' : 'transparent', color: activeTab === 'GLOBAL' ? 'var(--green)' : (unreadTabs.has('GLOBAL') ? '#ffaa00' : '#888'), borderTopLeftRadius: '5px', borderTopRightRadius: '5px', cursor: 'pointer', fontWeight: 'bold' }}
                >
                  [ GLOBAL ] {unreadTabs.has('GLOBAL') && '*'}
                </div>`;

if (code.includes(globalTabOld)) {
    code = code.replace(globalTabOld, globalTabNew);
} else {
    console.log("Could not find globalTabOld");
}

const customTabOld = `{openTabs.map(tab => (
                    <div 
                        key={tab}
                        onClick={() => openTab(tab)}
                        style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 15px', background: activeTab === tab ? 'var(--black)' : 'transparent', color: activeTab === tab ? 'var(--cyan)' : (unreadTabs.has(tab) ? '#ffaa00' : '#888'), borderTopLeftRadius: '5px', borderTopRightRadius: '5px', cursor: 'pointer', fontWeight: 'bold' }}
                    >`;

const customTabNew = `{openTabs.map(tab => (
                    <div 
                        key={tab}
                        className={unreadTabs.has(tab) ? 'unread-blink' : ''}
                        onClick={() => openTab(tab)}
                        style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 15px', background: activeTab === tab ? 'var(--black)' : 'transparent', color: activeTab === tab ? 'var(--cyan)' : (unreadTabs.has(tab) ? '#ffaa00' : '#888'), borderTopLeftRadius: '5px', borderTopRightRadius: '5px', cursor: 'pointer', fontWeight: 'bold' }}
                    >`;

if (code.includes(customTabOld)) {
    code = code.replace(customTabOld, customTabNew);
} else {
    console.log("Could not find customTabOld");
}

const effectOld = `    const scrollRef = useRef<HTMLDivElement>(null);
  
    useEffect(() => {`;

const effectNew = `    const scrollRef = useRef<HTMLDivElement>(null);
  
    useEffect(() => {
        if (activeTab !== 'GLOBAL' && messages.length > 0) {
            const lastMsg = messages[messages.length - 1];
            if (lastMsg.sender !== userName && lastMsg.sender !== sendAs) {
                setUnreadTabs(prev => new Set(prev).add('GLOBAL'));
            }
        }
    }, [messages, activeTab, userName, sendAs]);

    useEffect(() => {`;

if (code.includes(effectOld)) {
    code = code.replace(effectOld, effectNew);
} else {
    console.log("Could not find effectOld");
}

// Convert back to CRLF just in case (though Vite handles \n fine)
code = code.replace(/\n/g, '\r\n');

fs.writeFileSync('src/App.tsx', code);
console.log('Patched App.tsx for blinking unread tabs');
