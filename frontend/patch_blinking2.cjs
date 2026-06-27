const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

// Effect replacement
code = code.replace(
    /const scrollRef = useRef<HTMLDivElement>\(null\);\s*useEffect\(\(\) => \{/m,
    `const scrollRef = useRef<HTMLDivElement>(null);\n\n    useEffect(() => {\n        if (activeTab !== 'GLOBAL' && messages.length > 0) {\n            const lastMsg = messages[messages.length - 1];\n            if (lastMsg.sender !== userName && lastMsg.sender !== sendAs) {\n                setUnreadTabs(prev => new Set(prev).add('GLOBAL'));\n            }\n        }\n    }, [messages, activeTab, userName, sendAs]);\n\n    useEffect(() => {`
);

// Global tab replacement
code = code.replace(
    /onClick=\{\(\) => \{ setActiveTab\('GLOBAL'\); setSendAs\(userName\); \}\}\s*style=\{\{ padding: '8px 15px', background: activeTab === 'GLOBAL' \? 'var\(--black\)' : 'transparent', color: activeTab === 'GLOBAL' \? 'var\(--green\)' : '#888', borderTopLeftRadius: '5px', borderTopRightRadius: '5px', cursor: 'pointer', fontWeight: 'bold' \}\}\s*>\s*\[ GLOBAL \]\s*<\/div>/,
    `className={unreadTabs.has('GLOBAL') ? 'unread-blink' : ''}
                  onClick={() => { setActiveTab('GLOBAL'); setSendAs(userName); }}
                  style={{ padding: '8px 15px', background: activeTab === 'GLOBAL' ? 'var(--black)' : 'transparent', color: activeTab === 'GLOBAL' ? 'var(--green)' : (unreadTabs.has('GLOBAL') ? '#ffaa00' : '#888'), borderTopLeftRadius: '5px', borderTopRightRadius: '5px', cursor: 'pointer', fontWeight: 'bold' }}
                >
                  [ GLOBAL ] {unreadTabs.has('GLOBAL') && '*'}
                </div>`
);

// Custom tab replacement
code = code.replace(
    /\{openTabs\.map\(tab => \(\s*<div \s*key=\{tab\}\s*onClick=\{\(\) => openTab\(tab\)\}\s*style=\{\{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 15px', background: activeTab === tab \? 'var\(--black\)' : 'transparent', color: activeTab === tab \? 'var\(--cyan\)' : \(unreadTabs\.has\(tab\) \? '#ffaa00' : '#888'\), borderTopLeftRadius: '5px', borderTopRightRadius: '5px', cursor: 'pointer', fontWeight: 'bold' \}\}\s*>/,
    `{openTabs.map(tab => (
                    <div 
                        key={tab}
                        className={unreadTabs.has(tab) ? 'unread-blink' : ''}
                        onClick={() => openTab(tab)}
                        style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 15px', background: activeTab === tab ? 'var(--black)' : 'transparent', color: activeTab === tab ? 'var(--cyan)' : (unreadTabs.has(tab) ? '#ffaa00' : '#888'), borderTopLeftRadius: '5px', borderTopRightRadius: '5px', cursor: 'pointer', fontWeight: 'bold' }}
                    >`
);

fs.writeFileSync('src/App.tsx', code);
console.log('Regex patch complete');
