const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

code = code.replace(/\r\n/g, '\n');

// 1. Add to AdminPanel signature
code = code.replace(
    /roadDrawMode, setRoadDrawMode, snapToGrid, setSnapToGrid,/g,
    "roadDrawMode, setRoadDrawMode, snapToGrid, setSnapToGrid, snapRotation, setSnapRotation,"
);

// 2. Add to AdminPanel props
code = code.replace(
    /snapToGrid={snapToGrid}\s*setSnapToGrid={setSnapToGrid}/g,
    "snapToGrid={snapToGrid} \n                  setSnapToGrid={setSnapToGrid}\n                  snapRotation={snapRotation}\n                  setSnapRotation={setSnapRotation}"
);

// 3. Add to TransformControls
code = code.replace(
    /translationSnap={snapToGrid \? 1 : null} onDraggingChanged/g,
    "translationSnap={snapToGrid ? 1 : null} rotationSnap={snapRotation ? Math.PI / 18 : null} onDraggingChanged"
);

// 4. Add the button in AdminPanel
// Let's find the SNAP_TO_GRID button
const snapToGridBtnStr = `<button type="button" className={\`utility-btn \${snapToGrid ? 'active' : ''}\`} onClick={() => setSnapToGrid(!snapToGrid)} style={{flex: 1, fontSize: '0.7rem'}}>{snapToGrid ? 'GRID_SNAP: ON' : 'GRID_SNAP: OFF'}</button>`;
const newBtnsStr = `<button type="button" className={\`utility-btn \${snapToGrid ? 'active' : ''}\`} onClick={() => setSnapToGrid(!snapToGrid)} style={{flex: 1, fontSize: '0.7rem'}}>{snapToGrid ? 'GRID: ON' : 'GRID: OFF'}</button>\n                <button type="button" className={\`utility-btn \${snapRotation ? 'active' : ''}\`} onClick={() => setSnapRotation(!snapRotation)} style={{flex: 1, fontSize: '0.7rem'}}>{snapRotation ? 'ROT: ON' : 'ROT: OFF'}</button>`;

if (code.includes(snapToGridBtnStr)) {
    code = code.replace(snapToGridBtnStr, newBtnsStr);
    console.log("Patched button in AdminPanel");
} else {
    // There are actually multiple SNAP_TO_GRID buttons, one for 'draw_roads' and one for 'editor'.
    // The user wants it when they "edit a structure and rotate it", which is in the 'editor' panel section.
    // Let's do a more robust replacement.
    code = code.replace(
        /<button type="button" className={`utility-btn \${snapToGrid \? 'active' : ''}`} onClick=\{\(\) => setSnapToGrid\(!snapToGrid\)\} style=\{\{flex: 1, fontSize: '0\.7rem'\}\}>\{snapToGrid \? 'GRID_SNAP: ON' : 'GRID_SNAP: OFF'\}<\/button>/g,
        `<button type="button" className={\`utility-btn \${snapToGrid ? 'active' : ''}\`} onClick={() => setSnapToGrid(!snapToGrid)} style={{flex: 1, fontSize: '0.7rem'}}>{snapToGrid ? 'GRID: ON' : 'GRID: OFF'}</button>
                <button type="button" className={\`utility-btn \${snapRotation ? 'active' : ''}\`} onClick={() => setSnapRotation(!snapRotation)} style={{flex: 1, fontSize: '0.7rem'}}>{snapRotation ? 'ROT: ON' : 'ROT: OFF'}</button>`
    );
    console.log("Used Regex to patch AdminPanel button");
}

code = code.replace(/\n/g, '\r\n');
fs.writeFileSync('src/App.tsx', code);
