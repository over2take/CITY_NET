const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const targetBuildingOld = \  const Building = React.memo(({ location, children, onClick, isSelected, isBatchSelected, isOverlapped, setTargetObject, editMeshRef, token, userName, refreshLocations, setIsDragging, isDragging, socket, activeUsers }: any) => {
    const meshRef = useRef<THREE.Mesh>(null);
    
    const parts = [location, ...(children || [])];\;

const targetBuildingNew = \  const Building = React.memo(({ location, children, onClick, isSelected, isBatchSelected, isOverlapped, setTargetObject, editMeshRef, token, userName, refreshLocations, setIsDragging, isDragging, socket, activeUsers }: any) => {
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
    const parts = [location, ...flattenChildren(children || [])];\;

code = code.replace(targetBuildingOld, targetBuildingNew);

const targetJoinOld = \      } else if (view === 'join') {
        setJoinSelection(prev => {
          const next = prev.includes(loc.id) ? prev.filter(i => i !== loc.id) : [...prev, loc.id];
          if (next.length === 1 && !prev.includes(loc.id)) {
            setSelectedClassification(loc.classification || '');
          } else if (next.length === 0) {
            setSelectedClassification('');
          }
          return next;
        });\;

const targetJoinNew = \      } else if (view === 'join') {
        const getAllDescendants = (id) => {
          let ids = [id];
          const children = locations.filter(l => l.parent_id === id);
          children.forEach(c => {
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
        });\;

code = code.replace(targetJoinOld, targetJoinNew);

fs.writeFileSync('src/App.tsx', code);
console.log('Patched App.tsx');

