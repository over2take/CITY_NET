const fs = require('fs');

let code = fs.readFileSync('src/App.tsx', 'utf8');

// 1. Imports
code = code.replace(
  `import { OrbitControls, CameraControls, PerspectiveCamera, Grid, TransformControls, Bvh } from '@react-three/drei';`,
  `import { OrbitControls, CameraControls, PerspectiveCamera, Grid, TransformControls, Bvh, Html, OrthographicCamera } from '@react-three/drei';\nimport { BattleMapManager } from './BattleMapManager';\nimport { BattleMapScene } from './BattleMapScene';`
);

// 2. State
code = code.replace(
  `const [selectedLocation, setSelectedLocation] = useState<any | null>(null);`,
  `const [selectedLocation, setSelectedLocation] = useState<any | null>(null);\n  const [showBattleMapManager, setShowBattleMapManager] = useState(false);\n  const [activeBattleMapData, setActiveBattleMapData] = useState<any>(null);\n  const [battleMapPositions, setBattleMapPositions] = useState<Record<string, {x: number, z: number}>>({});\n  const [currentLocBattleMaps, setCurrentLocBattleMaps] = useState<any[]>([]);`
);

// 3. View state
code = code.replace(
  `const [view, setView] = useState<'list' | 'editor' | 'generator' | 'district' | 'join' | 'draw_roads' | 'city_gen'>('list');`,
  `const [view, setView] = useState<'list' | 'editor' | 'generator' | 'district' | 'join' | 'draw_roads' | 'city_gen' | 'battle_map'>('list');`
);

// 4. Info window effect and enter/exit logic
code = code.replace(
  `const handleBuildingClick = (loc: any) => {`,
  `useEffect(() => {
    if (selectedLocation && selectedLocation.shape !== 'rhombus' && selectedLocation.shape !== 'enemy_rhombus') {
      fetch(\`/api/locations/\${selectedLocation.id}/battle_maps\`)
        .then(res => res.json())
        .then(data => setCurrentLocBattleMaps(Array.isArray(data) ? data : []))
        .catch(() => setCurrentLocBattleMaps([]));
    } else {
      setCurrentLocBattleMaps([]);
    }
  }, [selectedLocation?.id]);

  const enterBattleMap = (locId: number) => {
    if (currentLocBattleMaps.length === 0) return;
    
    let targetFloor = 0;
    const adminInMap = activeUsers.find((u: any) => u.isAdmin && u.currentBattleMapId === locId);
    if (adminInMap && adminInMap.currentFloorIndex !== undefined) {
      targetFloor = adminInMap.currentFloorIndex;
    }

    setActiveBattleMapData({ locationId: locId, maps: currentLocBattleMaps, currentFloorIndex: targetFloor });
    setView('battle_map');
    setSelectedLocation(null);
    if (socketRef.current) socketRef.current.emit('battle_map_enter', { locationId: locId, floorIndex: targetFloor });
  };

  const exitBattleMap = () => {
    setActiveBattleMapData(null);
    setView('list'); // or previous view
    setBattleMapPositions({});
    if (socketRef.current) socketRef.current.emit('battle_map_leave');
  };

  const handleBuildingClick = (loc: any) => {`
);

// 5. Socket events
code = code.replace(
  `newSocket.on('editingRequested', (data: any) => {`,
  `newSocket.on('force_floor_change', (data: any) => {
        setActiveBattleMapData((prev: any) => {
          if (prev && prev.locationId === data.locationId) {
             return { ...prev, currentFloorIndex: data.floorIndex };
          }
          return prev;
        });
      });
      newSocket.on('battle_map_moved', (data: any) => {
        setBattleMapPositions(prev => ({ ...prev, [data.userName]: { x: data.x, z: data.z } }));
      });
      newSocket.on('editingRequested', (data: any) => {`
);

// 6. PlayerRhombus
code = code.replace(
  `const PlayerRhombus = React.memo(({ location, onClick, isSelected, setTargetObject, token, userName, refreshLocations, setIsDragging, socket, activeUsers, roads }: any) => {`,
  `const PlayerRhombus = React.memo(({ location, onClick, isSelected, setTargetObject, token, userName, refreshLocations, setIsDragging, socket, activeUsers, roads, isBattleMap, battleMapPos }: any) => {`
);

code = code.replace(
  `const localPos = useRef({ x: location.x, z: location.z });`,
  `const localPos = useRef({ x: isBattleMap && battleMapPos ? battleMapPos.x : location.x, z: isBattleMap && battleMapPos ? battleMapPos.z : location.z });`
);

code = code.replace(
  `const visualPos = useRef(new THREE.Vector3(location.x, location.y + (location.height / 2), location.z));`,
  `const visualPos = useRef(new THREE.Vector3(
    isBattleMap && battleMapPos ? battleMapPos.x : location.x, 
    isBattleMap ? 0.1 : location.y + (location.height / 2), 
    isBattleMap && battleMapPos ? battleMapPos.z : location.z
  ));`
);

// Need to specifically match the localPos update in PlayerRhombus only
code = code.replace(
  `useEffect(() => {
    localPos.current = { x: location.x, z: location.z };
  }, [location.x, location.z]);`,
  `useEffect(() => {
    if (isBattleMap && battleMapPos) {
      localPos.current = { x: battleMapPos.x, z: battleMapPos.z };
    } else if (!isBattleMap) {
      localPos.current = { x: location.x, z: location.z };
    }
  }, [location.x, location.z, isBattleMap, battleMapPos]);`
);

code = code.replace(
  `} else if (canManage) {
        // Only owners/admins can actually SAVE the new position after a drag
        socket.emit('moveRhombus', { id: location.id, x: localPos.current.x, z: localPos.current.z });
    }`,
  `} else if (canManage) {
        if (isBattleMap) {
          socket.emit('battle_map_move', { userName: location.owner, x: localPos.current.x, z: localPos.current.z });
        } else {
          socket.emit('moveRhombus', { id: location.id, x: localPos.current.x, z: localPos.current.z });
        }
    }`
);

// 7. Info Window UI
code = code.replace(
  `{!token && !isRhombus && <button className="upload-btn" onClick={() => { if (isSomeoneEditing)`,
  `{isAdmin && isPrimaryAdmin && !isRhombus && (
      <button className="upload-btn" onClick={() => setShowBattleMapManager(true)}>BATTLE MAPS</button>
  )}
  {currentLocBattleMaps.length > 0 && (
      <button className="upload-btn" style={{backgroundColor: '#ff00ff', color: 'white'}} onClick={() => enterBattleMap(selectedLocation.id)}>ENTER BATTLE MAP</button>
  )}
  {!token && !isRhombus && <button className="upload-btn" onClick={() => { if (isSomeoneEditing)`
);

// 8. View Overlay UI
code = code.replace(
  `<div className="ui-overlay">`,
  `<div className="ui-overlay">
      {showBattleMapManager && selectedLocation && (
        <BattleMapManager locationId={selectedLocation.id} token={token} onClose={() => setShowBattleMapManager(false)} />
      )}
      {view === 'battle_map' && activeBattleMapData && (
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'none', zIndex: 100 }}>
          <div style={{ position: 'absolute', top: '20px', left: '50%', transform: 'translateX(-50%)', textAlign: 'center', pointerEvents: 'auto' }}>
            <h2 style={{ margin: 0, textShadow: '0 0 10px #00ff00', fontSize: '2em' }}>{activeBattleMapData.maps[activeBattleMapData.currentFloorIndex]?.designation?.toUpperCase() || 'UNKNOWN FLOOR'}</h2>
            <button onClick={exitBattleMap} style={{ padding: '10px 30px', marginTop: '10px', backgroundColor: '#ff0000', color: 'white', border: '1px solid #ff0000', cursor: 'pointer', fontWeight: 'bold' }}>EXIT</button>
          </div>
          {isAdmin && isPrimaryAdmin && (
            <div style={{ position: 'absolute', right: '20px', top: '50%', transform: 'translateY(-50%)', display: 'flex', flexDirection: 'column', gap: '10px', pointerEvents: 'auto' }}>
              {activeBattleMapData.maps.map((m: any, idx: number) => {
                let lbl = m.designation;
                if (lbl === 'Lobby') lbl = 'Lby';
                else if (lbl === 'Penthouse') lbl = 'PH';
                else if (lbl.startsWith('Level ')) lbl = 'L' + lbl.split(' ')[1];
                
                return (
                  <button key={m.id} 
                    style={{ padding: '15px', backgroundColor: activeBattleMapData.currentFloorIndex === idx ? '#00ff00' : '#222', color: activeBattleMapData.currentFloorIndex === idx ? '#000' : '#00ff00', border: '1px solid #00ff00', cursor: 'pointer', fontWeight: 'bold' }}
                    onClick={() => {
                      setActiveBattleMapData((p: any) => ({ ...p, currentFloorIndex: idx }));
                      if (socketRef.current) socketRef.current.emit('admin_force_floor_change', { locationId: activeBattleMapData.locationId, floorIndex: idx });
                    }}>
                    {lbl}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}`
);

// 9. Hide elements
code = code.replace(
  `<button className="menu-btn" onClick={() => setActiveSidebarMenu(activeSidebarMenu === 'quick' ? 'none' : 'quick')}>QUICK_ACCESS</button>`,
  `{view !== 'battle_map' && <button className="menu-btn" onClick={() => setActiveSidebarMenu(activeSidebarMenu === 'quick' ? 'none' : 'quick')}>QUICK_ACCESS</button>}`
);
code = code.replace(
  `<button className="menu-btn" onClick={() => setView(view === 'list' ? 'generator' : 'list')}>CITY_DATABASE</button>`,
  `{view !== 'battle_map' && <button className="menu-btn" onClick={() => setView(view === 'list' ? 'generator' : 'list')}>CITY_DATABASE</button>}`
);

// 10. Canvas switch + RenderLists map replacement
const renderListsOriginal = `{renderLists.interactive.map(({ loc, children, isSelected, isBatchSelected, isOverlapped }: any) => (
              <Building key={loc.id} location={loc} children={children} onClick={() => handleBuildingClick(loc)} isSelected={isSelected} isBatchSelected={isBatchSelected} isOverlapped={isOverlapped} setTargetObject={setTargetObject} editMeshRef={editMeshRef} token={token} userName={userName} refreshLocations={fetchLocations} setIsDragging={setIsDragging} isDragging={isDragging} socket={socket} activeUsers={activeUsers} />
            ))}`;

const renderListsNew = `{renderLists.interactive.map(({ loc, children, isSelected, isBatchSelected, isOverlapped }: any) => {
              const activeOperatorsInLoc = activeUsers.filter((u: any) => u.currentBattleMapId === loc.id);
              return (
                <React.Fragment key={loc.id}>
                  {isAdmin && !isTemporaryAdmin && activeOperatorsInLoc.length > 0 && view !== 'battle_map' && (
                    <Html position={[loc.x, loc.y + loc.height + 15, loc.z]} center>
                      <div style={{ backgroundColor: 'rgba(0,0,0,0.8)', border: '1px solid #ff00ff', padding: '10px', color: '#ff00ff', whiteSpace: 'nowrap', pointerEvents: 'none', textShadow: '0 0 5px #ff00ff' }}>
                        <div style={{ fontWeight: 'bold', borderBottom: '1px solid #ff00ff', marginBottom: '5px' }}>ACTIVE OPERATORS: {activeOperatorsInLoc.length}</div>
                        {activeOperatorsInLoc.map((u: any) => <div key={u.userName}>- {u.userName}</div>)}
                      </div>
                    </Html>
                  )}
                  <Building location={loc} children={children} onClick={() => handleBuildingClick(loc)} isSelected={isSelected} isBatchSelected={isBatchSelected} isOverlapped={isOverlapped} setTargetObject={setTargetObject} editMeshRef={editMeshRef} token={token} userName={userName} refreshLocations={fetchLocations} setIsDragging={setIsDragging} isDragging={isDragging} socket={socket} activeUsers={activeUsers} />
                </React.Fragment>
              );
            })}`;

code = code.replace(renderListsOriginal, renderListsNew);

const cameraOriginal = `<PerspectiveCamera makeDefault position={[0, 200, 250]} />`;
const cameraNew = `{view === 'battle_map' ? (
              activeBattleMapData && activeBattleMapData.maps[activeBattleMapData.currentFloorIndex] && (
                <BattleMapScene 
                  mapUrl={activeBattleMapData.maps[activeBattleMapData.currentFloorIndex].image_url} 
                />
              )
            ) : (
              <>
                <PerspectiveCamera makeDefault position={[0, 200, 250]} />`;

code = code.replace(cameraOriginal, cameraNew);

// We need to close the ternary for view === 'battle_map' right before PlayerRhombus Rendering
const playerRhombusTitle = `{/* Dedicated Player Rhombus Rendering */}`;
code = code.replace(
  playerRhombusTitle,
  `</>\n            )}\n            ${playerRhombusTitle}`
);

// Player Rhombus update
const playerRhombusOriginal = `{locations.filter(l => l.shape === 'rhombus').map(loc => (
              <PlayerRhombus key={loc.id} location={loc} onClick={() => handleBuildingClick(loc)} isSelected={selectedLocation?.id === loc.id} setTargetObject={setTargetObject} token={token} userName={userName} refreshLocations={fetchLocations} setIsDragging={setIsDragging} socket={socket} activeUsers={activeUsers} roads={roads} />
            ))}`;

const playerRhombusNew = `{locations.filter(l => l.shape === 'rhombus').map(loc => (
              <PlayerRhombus key={loc.id} location={loc} onClick={() => handleBuildingClick(loc)} isSelected={selectedLocation?.id === loc.id} setTargetObject={setTargetObject} token={token} userName={userName} refreshLocations={fetchLocations} setIsDragging={setIsDragging} socket={socket} activeUsers={activeUsers} roads={roads} isBattleMap={view === 'battle_map'} battleMapPos={battleMapPositions ? battleMapPositions[loc.owner] : null} />
            ))}`;

code = code.replace(playerRhombusOriginal, playerRhombusNew);

fs.writeFileSync('src/App.tsx', code);
console.log("App.tsx repatched successfully.");
