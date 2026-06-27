const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

// 1. Remove CanvasDebugOverlay component definition
const canvasDebugStr1 = `const CanvasDebugOverlay = ({ isDragging, targetObject, view, editId }: any) => {`;
const canvasDebugIndex1 = code.indexOf(canvasDebugStr1);
if (canvasDebugIndex1 !== -1) {
    const canvasDebugIndex2 = code.indexOf(`};`, canvasDebugIndex1) + 2;
    code = code.slice(0, canvasDebugIndex1) + code.slice(canvasDebugIndex2);
}

// 2. Remove CanvasDebugOverlay usage
code = code.replace(`<CanvasDebugOverlay isDragging={isDragging} targetObject={targetObject} view={view} editId={editId} />`, '');

// 3. Update the existing SYSTEM DEBUG_STATE in AdminPanel
const oldDebugStr = `{TARGET_OBJECT_ACTIVE: \${!!targetObject}
  EDIT_ID_LOCKED: \${editId || 'NONE'}}`;
const newDebugStr = `{TARGET_OBJECT_ACTIVE: \${!!targetObject}
  EDIT_ID_LOCKED: \${editId || 'NONE'}
  IS_DRAGGING: \${isDragging}
  CURRENT_VIEW: \${view}}`;
code = code.replace('`TARGET_OBJECT_ACTIVE: ${!!targetObject}\n  EDIT_ID_LOCKED: ${editId || \'NONE\'}`', '`TARGET_OBJECT_ACTIVE: ${!!targetObject}\\n  EDIT_ID_LOCKED: ${editId || \'NONE\'}\\n  IS_DRAGGING: ${isDragging}\\n  CURRENT_VIEW: ${view}`');

// 4. Add isDragging to AdminPanel props
code = code.replace(
    `transformMode, setTransformMode, targetObject, blockBuildings, setBlockBuildings, selectedLocation,`,
    `transformMode, setTransformMode, targetObject, blockBuildings, setBlockBuildings, selectedLocation, isDragging,`
);

// 5. Release pointer capture
const playerPointerUpSearch = `const handlePointerUp = async (e: any) => {
      if (controls) (controls as any).enabled = true;
      setIsLocalDragging(false);
      setIsDragging(false);`;
      
const playerPointerUpReplace = `const handlePointerUp = async (e: any) => {
      try { e.target.releasePointerCapture(e.pointerId); } catch (err) {}
      if (controls) (controls as any).enabled = true;
      setIsLocalDragging(false);
      setIsDragging(false);`;

code = code.split(playerPointerUpSearch).join(playerPointerUpReplace);

fs.writeFileSync('src/App.tsx', code);
console.log('Patch complete!');
