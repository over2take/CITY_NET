const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const searchStrRegex = /<div style=\{\{display: 'flex', gap: '5px', marginTop: '5px'\}\}>\s*<button type="button" className="utility-btn" onClick=\{\(\) => \{ if \(targetObject\) targetObject\.position\.y = 0; \}\} style=\{\{flex: 1, fontSize: '0\.7rem'\}\}>SNAP_TO_GROUND<\/button>\s*<button type="button" className=\{`utility-btn \$\{snapToGrid \? 'active' : ''\}`\} onClick=\{\(\) => setSnapToGrid\(!snapToGrid\)\} style=\{\{flex: 1, fontSize: '0\.7rem'\}\}>\{snapToGrid \? 'GRID: ON' : 'GRID: OFF'\}<\/button>\s*<button type="button" className=\{`utility-btn \$\{snapRotation \? 'active' : ''\}`\} onClick=\{\(\) => setSnapRotation\(!snapRotation\)\} style=\{\{flex: 1, fontSize: '0\.7rem'\}\}>\{snapRotation \? 'ROT: ON' : 'ROT: OFF'\}<\/button>\s*<button type="button" className=\{`utility-btn \$\{isCopyingSize \? 'active priority-danger-btn' : ''\}`\} onClick=\{\(\) => setIsCopyingSize\(!isCopyingSize\)\} style=\{\{flex: 1, fontSize: '0\.7rem'\}\}>\{isCopyingSize \? 'SELECT_ON_MAP\.\.\.' : 'COPY_SIZE'\}<\/button>\s*<\/div>/;

const replacementStr = `<div style={{display: 'flex', gap: '5px', marginTop: '5px'}}>
                <button type="button" className="utility-btn" onClick={() => { if (targetObject) targetObject.position.y = 0; }} style={{flex: 1, fontSize: '0.7rem'}}>SNAP_TO_GROUND</button>
                <button type="button" className={\`utility-btn \${isCopyingSize ? 'active priority-danger-btn' : ''}\`} onClick={() => setIsCopyingSize(!isCopyingSize)} style={{flex: 1, fontSize: '0.7rem'}}>{isCopyingSize ? 'SELECT_ON_MAP...' : 'COPY_SIZE'}</button>
              </div>
              <div style={{display: 'flex', gap: '5px', marginTop: '5px'}}>
                <button type="button" className={\`utility-btn \${snapToGrid ? 'active' : ''}\`} onClick={() => setSnapToGrid(!snapToGrid)} style={{flex: 1, fontSize: '0.7rem'}}>{snapToGrid ? 'GRID_SNAP: ON' : 'GRID_SNAP: OFF'}</button>
                <button type="button" className={\`utility-btn \${snapRotation ? 'active' : ''}\`} onClick={() => setSnapRotation(!snapRotation)} style={{flex: 1, fontSize: '0.7rem'}}>{snapRotation ? 'ROT_SNAP: ON' : 'ROT_SNAP: OFF'}</button>
              </div>`;

if (code.match(searchStrRegex)) {
    code = code.replace(searchStrRegex, replacementStr);
    console.log("Patched button layout in AdminPanel");
} else {
    console.log("Regex match failed");
}

fs.writeFileSync('src/App.tsx', code);
