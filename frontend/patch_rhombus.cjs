const fs = require('fs');

let code = fs.readFileSync('src/App.tsx', 'utf8');

// Update PlayerRhombus signature and logic
if (!code.includes("isBattleMap")) {
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

  // Update where PlayerRhombus is rendered
  code = code.replace(
    `<PlayerRhombus key={loc.id} location={loc} onClick={() => handleBuildingClick(loc)} isSelected={selectedLocation?.id === loc.id} setTargetObject={setTargetObject} token={token} userName={userName} refreshLocations={fetchLocations} setIsDragging={setIsDragging} socket={socket} activeUsers={activeUsers} roads={roads} />`,
    `<PlayerRhombus key={loc.id} location={loc} onClick={() => handleBuildingClick(loc)} isSelected={selectedLocation?.id === loc.id} setTargetObject={setTargetObject} token={token} userName={userName} refreshLocations={fetchLocations} setIsDragging={setIsDragging} socket={socket} activeUsers={activeUsers} roads={roads} isBattleMap={view === 'battle_map'} battleMapPos={battleMapPositions ? battleMapPositions[loc.owner] : null} />`
  );
}

fs.writeFileSync('src/App.tsx', code);
console.log('PlayerRhombus patched for Battle Maps');
