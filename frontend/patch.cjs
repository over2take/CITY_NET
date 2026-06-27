const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

code = code.replace(
    '  const parts = [location, ...(children || [])];',
    \  const flattenChildren = (childrenArray) => {
    let flat = [];
    childrenArray.forEach(c => {
      flat.push(c);
      if (c.children && c.children.length > 0) {
        flat = flat.concat(flattenChildren(c.children));
      }
    });
    return flat;
  };
  const parts = [location, ...flattenChildren(children || [])];\
);

code = code.replace(
    /\\} else if \\(view === 'join'\\) \\{[\\s\\S]*?return next;\\s*\\}\\);\\s*\\} else \\{/,
    \} else if (view === 'join') {
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
      } else {\
);

fs.writeFileSync('src/App.tsx', code);
console.log('Done');

