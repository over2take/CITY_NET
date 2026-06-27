const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const target1 = '    const parts = [location, ...(children || [])];';
const replace1 = \    const flattenChildren = (childrenArray) => {
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

code = code.replace(target1, replace1);

const target2 = '      } else if (view === \\'join\\') {\\n        setJoinSelection(prev => {\\n          const next = prev.includes(loc.id) ? prev.filter(i => i !== loc.id) : [...prev, loc.id];\\n          if (next.length === 1 && !prev.includes(loc.id)) {\\n            setSelectedClassification(loc.classification || \\'\\');\\n          } else if (next.length === 0) {\\n            setSelectedClassification(\\'\\');\\n          }\\n          return next;\\n        });';

const replace2 = \      } else if (view === 'join') {
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

code = code.replace(target2, replace2);

fs.writeFileSync('src/App.tsx', code);
console.log('patched');

