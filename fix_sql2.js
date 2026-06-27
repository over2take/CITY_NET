const fs = require('fs');
let code = fs.readFileSync('backend/server.js', 'utf8');

code = code.replace('INSERT INTO action_history (type, payload) VALUES (?, ?, ?, ?)', 'INSERT INTO action_history (type, payload) VALUES (?, ?)');
code = code.replace('INSERT INTO structure_prefabs (classification, data) VALUES (?, ?, ?, ?)', 'INSERT INTO structure_prefabs (classification, data) VALUES (?, ?)');
code = code.replace('INSERT INTO districts (name, color) VALUES (?, ?, ?, ?)', 'INSERT INTO districts (name, color) VALUES (?, ?)');
code = code.replace('INSERT INTO locations (id, name, description, npcs, x, y, z, width, height, depth, shape, color, district_name, district_color, parent_id, isFavorite, isDanger, owner, notifications_enabled, rotation, rotation_x, rotation_z, classification, polyCount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', 'INSERT INTO locations (id, name, description, npcs, x, y, z, width, height, depth, shape, color, district_name, district_color, parent_id, isFavorite, isDanger, owner, notifications_enabled, rotation, rotation_x, rotation_z, classification, polyCount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
code = code.replace('INSERT INTO roads (id, x1, z1, x2, z2, width) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', 'INSERT INTO roads (id, x1, z1, x2, z2, width) VALUES (?, ?, ?, ?, ?, ?)');
code = code.replace('INSERT INTO roads (x1, z1, x2, z2, width) VALUES (?, ?, ?, ?, ?, ?, ?)', 'INSERT INTO roads (x1, z1, x2, z2, width) VALUES (?, ?, ?, ?, ?)');
code = code.replace('INSERT INTO districts (id, name, color) VALUES (?, ?, ?, ?, ?)', 'INSERT INTO districts (id, name, color) VALUES (?, ?, ?)');
code = code.replace('INSERT INTO chat_logs (sender, text, timestamp) VALUES (?, ?, ?, ?, ?)', 'INSERT INTO chat_logs (sender, text, timestamp) VALUES (?, ?, ?)');
code = code.replace('INSERT INTO private_messages (sender, recipient, text) VALUES (?, ?, ?, ?, ?)', 'INSERT INTO private_messages (sender, recipient, text) VALUES (?, ?, ?)');

fs.writeFileSync('backend/server.js', code);
console.log('Fixed DB Inserts');

