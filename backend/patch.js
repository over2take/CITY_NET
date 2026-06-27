const fs = require('fs');
let content = fs.readFileSync('server.js', 'utf8');

// Replace standard location insert query
content = content.replace(
  /owner, rotation\)/g,
  'owner, rotation, rotation_x, rotation_z)'
).replace(
  /1 : 0,\s*loc.owner \|\| null,\s*loc.rotation \|\| 0\s*\]/g,
  '1 : 0,\n        loc.owner || null,\n        loc.rotation || 0,\n        loc.rotation_x || 0,\n        loc.rotation_z || 0\n      ]'
).replace(
  /\?\)/g,
  '?, ?, ?)'
).replace(
  /owner=\?, rotation=\? WHERE id=\?/g,
  'owner=?, rotation=?, rotation_x=?, rotation_z=? WHERE id=?'
).replace(
  /owner \|\| null, rotation \|\| 0, req.params.id/g,
  'owner || null, rotation || 0, rotation_x || 0, rotation_z || 0, req.params.id'
);

// Replace sync queries
content = content.replace(
  /rotation, classification, polyCount\)/g,
  'rotation, rotation_x, rotation_z, classification, polyCount)'
).replace(
  /l.rotation, l.classification, l.polyCount\]/g,
  'l.rotation, l.rotation_x, l.rotation_z, l.classification, l.polyCount]'
).replace(
  /r.rotation, r.classification, r.polyCount\]/g,
  'r.rotation, r.rotation_x, r.rotation_z, r.classification, r.polyCount]'
);

// Replace the undo blocks which completely omit classification, polyCount, etc.
content = content.replace(
  /owner\)/g,
  'owner, notifications_enabled, rotation, rotation_x, rotation_z, classification, polyCount)'
).replace(
  /loc.owner\]/g,
  'loc.owner, loc.notifications_enabled, loc.rotation, loc.rotation_x, loc.rotation_z, loc.classification, loc.polyCount]'
).replace(
  /owner=\? WHERE id=\?/g,
  'owner=?, notifications_enabled=?, rotation=?, rotation_x=?, rotation_z=?, classification=?, polyCount=? WHERE id=?'
).replace(
  /d.owner, payload.id\]/g,
  'd.owner, d.notifications_enabled, d.rotation, d.rotation_x, d.rotation_z, d.classification, d.polyCount, payload.id]'
);

// Add the destructured variables to the PUT request
content = content.replace(
  /owner, rotation } = req.body;/g,
  'owner, rotation, rotation_x, rotation_z } = req.body;'
);

fs.writeFileSync('server.js', content);
console.log('patched');

