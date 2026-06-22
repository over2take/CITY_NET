const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

// Normalize line endings
code = code.replace(/\r\n/g, '\n');

const effectOld = `    const scrollRef = useRef<HTMLDivElement>(null);
  
    useEffect(() => {
        if (activeTab !== 'GLOBAL' && messages.length > 0) {
            const lastMsg = messages[messages.length - 1];
            if (lastMsg.sender !== userName && lastMsg.sender !== sendAs) {
                setUnreadTabs(prev => new Set(prev).add('GLOBAL'));
            }
        }
    }, [messages, activeTab, userName, sendAs]);`;

const effectNew = `    const scrollRef = useRef<HTMLDivElement>(null);
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
    }, [messages, activeTab, userName, sendAs]);`;

if (code.includes(effectOld)) {
    code = code.replace(effectOld, effectNew);
    console.log("Patched useEffect for GLOBAL blinking");
} else {
    // Try regex
    console.log("Could not find effectOld exactly, trying regex");
    code = code.replace(
        /const scrollRef = useRef<HTMLDivElement>\(null\);\s*useEffect\(\(\) => \{\s*if \(activeTab !== 'GLOBAL' && messages\.length > 0\) \{\s*const lastMsg = messages\[messages\.length - 1\];\s*if \(lastMsg\.sender !== userName && lastMsg\.sender !== sendAs\) \{\s*setUnreadTabs\(prev => new Set\(prev\)\.add\('GLOBAL'\)\);\s*\}\s*\}\s*\}, \[messages, activeTab, userName, sendAs\]\);/g,
        effectNew
    );
}

code = code.replace(/\n/g, '\r\n');
fs.writeFileSync('src/App.tsx', code);
