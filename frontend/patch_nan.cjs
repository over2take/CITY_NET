const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

code = code.replace(/\r\n/g, '\n');

// 1. Fix CameraController destination target to guarantee numbers
const destTargetSearch = `              // 2. Compute exact mathematical framing distance
              const [tx, ty, tz] = target.pos;
              destTarget.current.set(tx, ty, tz);`;
const destTargetReplace = `              // 2. Compute exact mathematical framing distance
              const [tx, ty, tz] = target.pos;
              destTarget.current.set(Number(tx) || 0, Number(ty) || 0, Number(tz) || 0);`;
if (code.includes(destTargetSearch)) {
    code = code.replace(destTargetSearch, destTargetReplace);
    console.log("Patched CameraController Number cast");
}

// 2. Fix target.size check
const radiusSearch = `              // Radius of the object's bounding sphere
              const radius = Math.max(15, target.size * 1.5);`;
const radiusReplace = `              // Radius of the object's bounding sphere
              const safeSize = Number(target.size) || 10;
              const radius = Math.max(15, safeSize * 1.5);`;
if (code.includes(radiusSearch)) {
    code = code.replace(radiusSearch, radiusReplace);
    console.log("Patched CameraController safe size");
}

// 3. Fix QuickAccessMenu onZoom payload
const zoomSearch1 = `onZoom({ pos: [loc.x, loc.y + loc.height/2, loc.z], size: Math.max(loc.width, loc.height, loc.depth) });`;
const zoomReplace1 = `onZoom({ pos: [Number(loc.x)||0, (Number(loc.y)||0) + (Number(loc.height)||0)/2, Number(loc.z)||0], size: Math.max(Number(loc.width)||10, Number(loc.height)||10, Number(loc.depth)||10) });`;
code = code.split(zoomSearch1).join(zoomReplace1);

const zoomSearch2 = `onZoom({ pos: [loc.x, loc.y + loc.height/2, loc.z], size: Math.max(loc.width, loc.height, loc.depth) })}>ZOOM</button>`;
const zoomReplace2 = `onZoom({ pos: [Number(loc.x)||0, (Number(loc.y)||0) + (Number(loc.height)||0)/2, Number(loc.z)||0], size: Math.max(Number(loc.width)||10, Number(loc.height)||10, Number(loc.depth)||10) })}>ZOOM</button>`;
code = code.split(zoomSearch2).join(zoomReplace2);

// 4. Force setIsDragging(false) on submit just to be completely safe
const submitSearch = `if (res.ok) { setAdminAlert("LOCATION_UPLOADED"); targetObject.scale.set(1, 1, 1); targetObject.rotation.set(0, 0, 0); refreshLocations(); setView('list'); setEditorGenParts([]); setEditorGenType(''); }`;
const submitReplace = `if (res.ok) { setIsDragging(false); setAdminAlert("LOCATION_UPLOADED"); targetObject.scale.set(1, 1, 1); targetObject.rotation.set(0, 0, 0); refreshLocations(); setView('list'); setEditorGenParts([]); setEditorGenType(''); }`;
code = code.split(submitSearch).join(submitReplace);

const submitUpdateSearch = `if (res.ok) { setAdminAlert("LOCATION_UPDATED"); targetObject.scale.set(1, 1, 1); targetObject.rotation.set(0, 0, 0); refreshLocations(); setView('list'); setEditorGenParts([]); setEditorGenType(''); }`;
const submitUpdateReplace = `if (res.ok) { setIsDragging(false); setAdminAlert("LOCATION_UPDATED"); targetObject.scale.set(1, 1, 1); targetObject.rotation.set(0, 0, 0); refreshLocations(); setView('list'); setEditorGenParts([]); setEditorGenType(''); }`;
code = code.split(submitUpdateSearch).join(submitUpdateReplace);

code = code.replace(/\n/g, '\r\n');
fs.writeFileSync('src/App.tsx', code);
console.log('Math NaN fix complete');
