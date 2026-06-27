const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

// 1. Add snapRotation state
if (!code.includes('const [snapRotation, setSnapRotation]')) {
    code = code.replace(
        'const [snapToGrid, setSnapToGrid] = useState(false);',
        'const [snapToGrid, setSnapToGrid] = useState(false);\n    const [snapRotation, setSnapRotation] = useState(false);'
    );
}

// 2. Add snapRotation UI button
if (!code.includes('SNAP_ROTATION')) {
    code = code.replace(
        '<button className="utility-btn" style={{flex: 1, borderColor: snapToGrid ? \'#00ff00\' : \'#555\', color: snapToGrid ? \'#00ff00\' : \'#aaa\'}} onClick={() => setSnapToGrid(!snapToGrid)}>',
        `<button className="utility-btn" style={{flex: 1, borderColor: snapRotation ? '#00ff00' : '#555', color: snapRotation ? '#00ff00' : '#aaa'}} onClick={() => setSnapRotation(!snapRotation)}>
                  {snapRotation ? '[*] SNAP_ROTATION' : '[ ] SNAP_ROTATION'}
                </button>
                <button className="utility-btn" style={{flex: 1, borderColor: snapToGrid ? '#00ff00' : '#555', color: snapToGrid ? '#00ff00' : '#aaa'}} onClick={() => setSnapToGrid(!snapToGrid)}>`
    );
}

// 3. Add UI controls for Pitch and Roll in Edit Modal
if (!code.includes('PITCH (X)')) {
    code = code.replace(
        '<div className="editor-controls">\n              <label style={{fontSize: \'0.7rem\'}}>ROTATION (Y)</label>\n              <input type="range" min="-3.14" max="3.14" step="0.01"',
        `<div className="editor-controls">
              <label style={{fontSize: '0.7rem'}}>PITCH (X)</label>
              <input type="range" min="-3.14" max="3.14" step="0.01" value={activeEditLocation.rotation_x || 0} onChange={(e) => updateDataPoint('rotation_x', parseFloat(e.target.value))} style={{width: '100%'}} />
              <label style={{fontSize: '0.7rem'}}>ROTATION (Y)</label>
              <input type="range" min="-3.14" max="3.14" step="0.01" value={activeEditLocation.rotation || 0} onChange={(e) => updateDataPoint('rotation', parseFloat(e.target.value))} style={{width: '100%'}} />
              <label style={{fontSize: '0.7rem'}}>ROLL (Z)</label>
              <input type="range" min="-3.14" max="3.14" step="0.01" value={activeEditLocation.rotation_z || 0} onChange={(e) => updateDataPoint('rotation_z', parseFloat(e.target.value))} style={{width: '100%'}} />
              {/* hidden old rotation input to replace */}
              <input type="hidden"`
    );
}

// 4. In Building, fix child rotation logic and deep flatten
code = code.replace(
    'const Building = React.memo(({ location, children, onClick, isSelected, isBatchSelected, isOverlapped, setTargetObject, editMeshRef, token, userName, refreshLocations, setIsDragging, isDragging, socket, activeUsers }: any) => {\n    const meshRef = useRef<THREE.Mesh>(null);\n    \n    const parts = [location, ...(children || [])];\n    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity;\n    parts.forEach(p => {\n      minX = Math.min(minX, p.x - p.width / 2); maxX = Math.max(maxX, p.x + p.width / 2);\n      minZ = Math.min(minZ, p.z - p.depth / 2); maxZ = Math.max(maxZ, p.z + p.depth / 2);\n      minY = Math.min(minY, p.y);\n    });\n    \n    const currentX = (minX + maxX) / 2;\n    const currentZ = (minZ + maxZ) / 2;\n    const groupPos: [number, number, number] = [currentX, minY, currentZ];',
    `const Building = React.memo(({ location, children, onClick, isSelected, isBatchSelected, isOverlapped, setTargetObject, editMeshRef, token, userName, refreshLocations, setIsDragging, isDragging, socket, activeUsers }: any) => {
    const meshRef = useRef<THREE.Mesh>(null);
    
    const flattenChildren = (childrenArray) => {
      let flat = [];
      childrenArray.forEach(c => {
        flat.push(c);
        if (c.children && c.children.length > 0) {
          flat = flat.concat(flattenChildren(c.children));
        }
      });
      return flat;
    };
    const parts = [location, ...flattenChildren(children || [])];
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity;
    parts.forEach(p => {
      minX = Math.min(minX, p.x - p.width / 2); maxX = Math.max(maxX, p.x + p.width / 2);
      minZ = Math.min(minZ, p.z - p.depth / 2); maxZ = Math.max(maxZ, p.z + p.depth / 2);
      minY = Math.min(minY, p.y);
    });
    
    const currentX = (minX + maxX) / 2;
    const currentZ = (minZ + maxZ) / 2;
    const groupPos = [currentX, minY, currentZ];
    const groupPosVec = new THREE.Vector3(currentX, minY, currentZ);
    const rootQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(location.rotation_x || 0, location.rotation || 0, location.rotation_z || 0, 'XYZ'));
    const invRootQuat = rootQuat.clone().invert();`
);

// Fix the mesh render for children to use invRootQuat
code = code.replace(
    'const childPos: [number, number, number] = [p.x - currentX, p.y - minY + (p.height / 2), p.z - currentZ];',
    `const worldPos = new THREE.Vector3(p.x, p.y + (p.height / 2), p.z);
          const localPos = worldPos.clone().sub(groupPosVec).applyQuaternion(invRootQuat);
          const childPos = [localPos.x, localPos.y, localPos.z];`
);

// Building group rotation
code = code.replace(
    '<group \n        position={groupPos} \n        ref={(group) => { if (isSelected && group) { setTargetObject(group); if (editMeshRef) editMeshRef.current = group; } }} \n    >',
    `<group 
        position={groupPos} 
        rotation={[location.rotation_x || 0, location.rotation || 0, location.rotation_z || 0]}
        ref={(group) => { if (isSelected && group) { setTargetObject(group); if (editMeshRef) editMeshRef.current = group; } }} 
    >`
);

code = code.replace(
    'rotation={[0, p.rotation || 0, 0]}',
    'rotation={isRoot ? [0,0,0] : [p.rotation_x || 0, p.rotation || 0, p.rotation_z || 0]}'
);

// 5. Update JOIN click handler
code = code.replace(
    /\} else if \(view === 'join'\) \{[\s\S]*?return next;\s*\}\);\s*\} else \{/g, 
    `} else if (view === 'join') {
        const getAllDescendants = (id) => {
          let ids = [id];
          const childrenList = locations.filter(l => l.parent_id === id);
          childrenList.forEach(c => {
            ids = ids.concat(getAllDescendants(c.id));
          });
          return ids;
        };
        const locIds = getAllDescendants(loc.id);

        setJoinSelection(prev => {
          const isSelected = prev.includes(loc.id);
          const next = isSelected 
             ? prev.filter(i => !locIds.includes(i))
             : Array.from(new Set([...prev, ...locIds]));

          if (next.length === locIds.length && !isSelected) {
            setSelectedClassification(loc.classification || '');
          } else if (next.length === 0) {
            setSelectedClassification('');
          }
          return next;
        });
      } else {`
);

// Snap rotation logic
if (!code.includes('if (snapRotation && (field === \'rotation\' || field === \'rotation_x\' || field === \'rotation_z\'))')) {
    code = code.replace(
        'const updateDataPoint = (field: string, value: any) => {',
        `const updateDataPoint = (field: string, value: any) => {
      if (snapRotation && (field === 'rotation' || field === 'rotation_x' || field === 'rotation_z')) {
          const step = Math.PI / 18; // 10 degrees
          value = Math.round(value / step) * step;
      }`
    );
}

fs.writeFileSync('src/App.tsx', code);
console.log('Restored and patched App.tsx');
