const fs = require('fs');
let code = fs.readFileSync('backend/server.js', 'utf8');

// 1. action_history
code = code.replace(
    'INSERT INTO action_history (type, payload) VALUES (?, ?, ?, ?)',
    'INSERT INTO action_history (type, payload) VALUES (?, ?)'
);

// 2. locations POST
const locPostOld = \INSERT INTO locations (name, description, npcs, x, y, z, width, height, depth, shape, color, district_name, district_color, parent_id, isFavorite, isDanger, owner, rotation) 
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\;
const locPostNew = \INSERT INTO locations (name, description, npcs, x, y, z, width, height, depth, shape, color, district_name, district_color, parent_id, isFavorite, isDanger, owner, rotation, rotation_x, rotation_z, classification, polyCount) 
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\;
code = code.replace(locPostOld, locPostNew);

// Also fix the params array for locations POST
code = code.replace(
    'loc.rotation || 0',
    'loc.rotation || 0,\\n        loc.rotation_x || 0,\\n        loc.rotation_z || 0,\\n        loc.classification || null,\\n        loc.polyCount || 5'
);

// 3. PUT /api/locations/:id
const putOld = \const sql = \\\UPDATE locations SET name=?, description=?, npcs=?, x=?, y=?, z=?, width=?, height=?, depth=?, shape=?, color=?, district_name=?, district_color=?, parent_id=?, isFavorite=?, isDanger=?, owner=?, rotation=? WHERE id=?\\\;
    const params = [name, description, npcs, x, y, z, width, height, depth, shape || 'box', color, district_name || null, district_color || null, parent_id || null, isFavorite ? 1 : 0, isDanger ? 1 : 0, owner || null, rotation || 0, req.params.id];\;

const putNew = \const sql = \\\UPDATE locations SET name=?, description=?, npcs=?, x=?, y=?, z=?, width=?, height=?, depth=?, shape=?, color=?, district_name=?, district_color=?, parent_id=?, isFavorite=?, isDanger=?, owner=?, rotation=?, rotation_x=?, rotation_z=?, classification=?, polyCount=? WHERE id=?\\\;
    const params = [name, description, npcs, x, y, z, width, height, depth, shape || 'box', color, district_name || null, district_color || null, parent_id || null, isFavorite ? 1 : 0, isDanger ? 1 : 0, owner || null, rotation || 0, rotation_x || 0, rotation_z || 0, classification || null, polyCount || 5, req.params.id];\;
code = code.replace(putOld, putNew);

const putBodyOld = \const { name, description, npcs, x, y, z, width, height, depth, shape, color, district_name, district_color, parent_id, isFavorite, isDanger, owner, rotation } = req.body;\;
const putBodyNew = \const { name, description, npcs, x, y, z, width, height, depth, shape, color, district_name, district_color, parent_id, isFavorite, isDanger, owner, rotation, rotation_x, rotation_z, classification, polyCount } = req.body;\;
code = code.replace(putBodyOld, putBodyNew);

// 4. structure_prefabs
code = code.replace(
    'INSERT INTO structure_prefabs (classification, data) VALUES (?, ?, ?, ?)',
    'INSERT INTO structure_prefabs (classification, data) VALUES (?, ?)'
);

// 5. districts POST
code = code.replace(
    'INSERT INTO districts (name, color) VALUES (?, ?, ?, ?)',
    'INSERT INTO districts (name, color) VALUES (?, ?)'
);

// 6. undo location_delete
const undoLocDelOld = \const stmt = db.prepare(\\\INSERT INTO locations (id, name, description, npcs, x, y, z, width, height, depth, shape, color, district_name, district_color, parent_id, isFavorite, isDanger, owner) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\\\);
        payload.data.forEach(loc => {
          stmt.run([loc.id, loc.name, loc.description, loc.npcs, loc.x, loc.y, loc.z, loc.width, loc.height, loc.depth, loc.shape, loc.color, loc.district_name, loc.district_color, loc.parent_id, loc.isFavorite, loc.isDanger, loc.owner]);\;

const undoLocDelNew = \const stmt = db.prepare(\\\INSERT INTO locations (id, name, description, npcs, x, y, z, width, height, depth, shape, color, district_name, district_color, parent_id, isFavorite, isDanger, owner, notifications_enabled, rotation, rotation_x, rotation_z, classification, polyCount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\\\);
        payload.data.forEach(loc => {
          stmt.run([loc.id, loc.name, loc.description, loc.npcs, loc.x, loc.y, loc.z, loc.width, loc.height, loc.depth, loc.shape, loc.color, loc.district_name, loc.district_color, loc.parent_id, loc.isFavorite, loc.isDanger, loc.owner, loc.notifications_enabled, loc.rotation, loc.rotation_x, loc.rotation_z, loc.classification, loc.polyCount]);\;
code = code.replace(undoLocDelOld, undoLocDelNew);

// 7. undo location_update
const undoLocUpdOld = \const sql = \\\UPDATE locations SET name=?, description=?, npcs=?, x=?, y=?, z=?, width=?, height=?, depth=?, shape=?, color=?, district_name=?, district_color=?, parent_id=?, isFavorite=?, isDanger=?, owner=? WHERE id=?\\\;
        db.run(sql, [d.name, d.description, d.npcs, d.x, d.y, d.z, d.width, d.height, d.depth, d.shape, d.color, d.district_name, d.district_color, d.parent_id, d.isFavorite, d.isDanger, d.owner, payload.id], finishUndo);\;

const undoLocUpdNew = \const sql = \\\UPDATE locations SET name=?, description=?, npcs=?, x=?, y=?, z=?, width=?, height=?, depth=?, shape=?, color=?, district_name=?, district_color=?, parent_id=?, isFavorite=?, isDanger=?, owner=?, notifications_enabled=?, rotation=?, rotation_x=?, rotation_z=?, classification=?, polyCount=? WHERE id=?\\\;
        db.run(sql, [d.name, d.description, d.npcs, d.x, d.y, d.z, d.width, d.height, d.depth, d.shape, d.color, d.district_name, d.district_color, d.parent_id, d.isFavorite, d.isDanger, d.owner, d.notifications_enabled, d.rotation, d.rotation_x, d.rotation_z, d.classification, d.polyCount, payload.id], finishUndo);\;
code = code.replace(undoLocUpdOld, undoLocUpdNew);

// 8. undo road_delete_all
code = code.replace(
    'INSERT INTO roads (id, x1, z1, x2, z2, width) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    'INSERT INTO roads (id, x1, z1, x2, z2, width) VALUES (?, ?, ?, ?, ?, ?)'
);

// 9. roads POST
code = code.replace(
    'INSERT INTO roads (x1, z1, x2, z2, width) VALUES (?, ?, ?, ?, ?, ?, ?)',
    'INSERT INTO roads (x1, z1, x2, z2, width) VALUES (?, ?, ?, ?, ?)'
);

// 10. saved_maps POST
const mapsPostOld = \const sql = \\\INSERT INTO saved_maps (name, locations_data, districts_data, roads_data) 
                       VALUES (?, ?, ?, ?, ?, ?) 
                       ON CONFLICT(name) DO UPDATE SET \;
const mapsPostNew = \const sql = \\\INSERT INTO saved_maps (name, locations_data, districts_data, roads_data) 
                       VALUES (?, ?, ?, ?) 
                       ON CONFLICT(name) DO UPDATE SET \;
code = code.replace(mapsPostOld, mapsPostNew);

// 11. maps load locations
const mapsLoadLocOld = \const stmtL = db.prepare(\\\INSERT INTO locations (id, name, description, npcs, x, y, z, width, height, depth, shape, color, district_name, district_color, parent_id, is_target, isFavorite, isDanger, owner, notifications_enabled, rotation, classification, polyCount) 
                                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\\\);
          locations.forEach(l => {
            stmtL.run([l.id, l.name, l.description, l.npcs, l.x, l.y, l.z, l.width, l.height, l.depth, l.shape, l.color, l.district_name, l.district_color, l.parent_id, l.is_target, l.isFavorite, l.isDanger, l.owner, l.notifications_enabled, l.rotation, l.classification, l.polyCount]);\;

const mapsLoadLocNew = \const stmtL = db.prepare(\\\INSERT INTO locations (id, name, description, npcs, x, y, z, width, height, depth, shape, color, district_name, district_color, parent_id, is_target, isFavorite, isDanger, owner, notifications_enabled, rotation, rotation_x, rotation_z, classification, polyCount) 
                                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\\\);
          locations.forEach(l => {
            stmtL.run([l.id, l.name, l.description, l.npcs, l.x, l.y, l.z, l.width, l.height, l.depth, l.shape, l.color, l.district_name, l.district_color, l.parent_id, l.is_target, l.isFavorite, l.isDanger, l.owner, l.notifications_enabled, l.rotation, l.rotation_x, l.rotation_z, l.classification, l.polyCount]);\;
code = code.replace(mapsLoadLocOld, mapsLoadLocNew);

// 12. maps load districts
code = code.replace(
    'INSERT INTO districts (id, name, color) VALUES (?, ?, ?, ?, ?)',
    'INSERT INTO districts (id, name, color) VALUES (?, ?, ?)'
);

// 13. maps load roads
code = code.replace(
    'INSERT INTO roads (id, x1, z1, x2, z2, width) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    'INSERT INTO roads (id, x1, z1, x2, z2, width) VALUES (?, ?, ?, ?, ?, ?)'
);

// 14. maps load activeRhombuses
const mapsLoadRhomOld = \const stmtR = db.prepare(\\\INSERT INTO locations (name, description, npcs, x, y, z, width, height, depth, shape, color, district_name, district_color, parent_id, is_target, isFavorite, isDanger, owner, notifications_enabled, rotation, classification, polyCount) 
                                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\\\);
          activeRhombuses.forEach(r => {
            stmtR.run([r.name, r.description, r.npcs, r.x, r.y, r.z, r.width, r.height, r.depth, r.shape, r.color, r.district_name, r.district_color, r.parent_id, r.is_target, r.isFavorite, r.isDanger, r.owner, r.notifications_enabled, r.rotation, r.classification, r.polyCount]);\;

const mapsLoadRhomNew = \const stmtR = db.prepare(\\\INSERT INTO locations (name, description, npcs, x, y, z, width, height, depth, shape, color, district_name, district_color, parent_id, is_target, isFavorite, isDanger, owner, notifications_enabled, rotation, rotation_x, rotation_z, classification, polyCount) 
                                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\\\);
          activeRhombuses.forEach(r => {
            stmtR.run([r.name, r.description, r.npcs, r.x, r.y, r.z, r.width, r.height, r.depth, r.shape, r.color, r.district_name, r.district_color, r.parent_id, r.is_target, r.isFavorite, r.isDanger, r.owner, r.notifications_enabled, r.rotation, r.rotation_x, r.rotation_z, r.classification, r.polyCount]);\;
code = code.replace(mapsLoadRhomOld, mapsLoadRhomNew);

// 15. clear activeRhombuses
const clearRhomOld = \const stmtR = db.prepare(\\\INSERT INTO locations (name, description, npcs, x, y, z, width, height, depth, shape, color, district_name, district_color, parent_id, is_target, isFavorite, isDanger, owner, notifications_enabled, rotation, classification, polyCount) 
                                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\\\);
        activeRhombuses.forEach(r => {
          stmtR.run([r.name, r.description, r.npcs, r.x, r.y, r.z, r.width, r.height, r.depth, r.shape, r.color, r.district_name, r.district_color, r.parent_id, r.is_target, r.isFavorite, r.isDanger, r.owner, r.notifications_enabled, r.rotation, r.classification, r.polyCount]);\;

const clearRhomNew = \const stmtR = db.prepare(\\\INSERT INTO locations (name, description, npcs, x, y, z, width, height, depth, shape, color, district_name, district_color, parent_id, is_target, isFavorite, isDanger, owner, notifications_enabled, rotation, rotation_x, rotation_z, classification, polyCount) 
                                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\\\);
        activeRhombuses.forEach(r => {
          stmtR.run([r.name, r.description, r.npcs, r.x, r.y, r.z, r.width, r.height, r.depth, r.shape, r.color, r.district_name, r.district_color, r.parent_id, r.is_target, r.isFavorite, r.isDanger, r.owner, r.notifications_enabled, r.rotation, r.rotation_x, r.rotation_z, r.classification, r.polyCount]);\;
code = code.replace(clearRhomOld, clearRhomNew);

// 16. chat_logs
code = code.replace(
    'INSERT INTO chat_logs (sender, text, timestamp) VALUES (?, ?, ?, ?, ?)',
    'INSERT INTO chat_logs (sender, text, timestamp) VALUES (?, ?, ?)'
);

// 17. private_messages
code = code.replace(
    'INSERT INTO private_messages (sender, recipient, text) VALUES (?, ?, ?, ?, ?)',
    'INSERT INTO private_messages (sender, recipient, text) VALUES (?, ?, ?)'
);

fs.writeFileSync('backend/server.js', code);
console.log('Fixed everything');

