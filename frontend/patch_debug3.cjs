const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

// 1. Remove DebugOverlay from the Canvas
code = code.replace(
    /<DebugOverlay isDragging=\{isDragging\} targetObject=\{targetObject\} view=\{view\} editId=\{editId\} \/>/g,
    ''
);

// 2. Remove the DebugOverlay component definition
const debugOverlayDefRegex = /const DebugOverlay = \(\{.*?\}\) => \{[\s\S]*?return \([\s\S]*?<\/Html>[\s\S]*?\);\s*\};\s*/;
code = code.replace(debugOverlayDefRegex, '');

// 3. Inject debug info into AdminPanel
const adminPanelContentRegex = /<form onSubmit=\{handleSubmit\}>/;
const debugPanelUI = `
            {/* Debug Dropdown */}
            <div style={{marginBottom: '10px', background: 'rgba(0,0,0,0.8)', border: '1px solid var(--green)', padding: '5px'}}>
                <details>
                    <summary style={{cursor: 'pointer', fontSize: '0.8rem', fontWeight: 'bold', color: 'var(--green)'}}>SYSTEM DEBUG_STATE</summary>
                    <div style={{fontSize: '0.7rem', color: '#0f0', marginTop: '5px', whiteSpace: 'pre-wrap', fontFamily: 'monospace'}}>
                        {\`TARGET_OBJECT_ACTIVE: \${!!targetObject}
EDIT_ID_LOCKED: \${editId || 'NONE'}\`}
                    </div>
                </details>
            </div>
            <form onSubmit={handleSubmit}>
`;

code = code.replace(adminPanelContentRegex, debugPanelUI);

fs.writeFileSync('src/App.tsx', code);
console.log('Moved debug to AdminPanel');
