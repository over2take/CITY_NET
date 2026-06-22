const fs = require('fs');
const path = require('path');

let code = fs.readFileSync('server.js', 'utf8');

// 1. Add multer and file system requirements
if (!code.includes("const multer = require('multer');")) {
    const requiresReplacement = `const cors = require('cors');\nconst multer = require('multer');\nconst fs = require('fs');`;
    code = code.replace("const cors = require('cors');", requiresReplacement);
}

// 2. Setup multer and serve /uploads
if (!code.includes("const storage = multer.diskStorage")) {
    const appUseCors = `app.use(cors());`;
    const multerSetup = `app.use(cors());

// --- BATTLE MAPS UPLOAD SETUP ---
const uploadsDir = path.join(__dirname, 'uploads', 'battle_maps');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + ext);
  }
});
const upload = multer({ storage });
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
// --------------------------------`;
    code = code.replace(appUseCors, multerSetup);
}

// 3. Add Battle Map API Routes
if (!code.includes("/api/locations/:id/battle_maps")) {
    const targetRouteStr = "app.post('/api/locations'";
    const battleMapRoutes = `
// --- BATTLE MAPS ROUTES ---
app.post('/api/locations/:id/battle_maps', authenticate, upload.single('image'), (req, res) => {
  if (!req.user.isAdmin || req.user.isTemporary) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(403).json({ error: 'Only main admin can manage battle maps' });
  }

  const { designation } = req.body;
  if (!req.file || !designation) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'Image and designation are required' });
  }

  const locationId = req.params.id;
  const imageUrl = '/uploads/battle_maps/' + req.file.filename;
  
  // Calculate order index based on designation
  let orderIndex = 0;
  if (designation === 'Lobby') {
    orderIndex = 0;
  } else if (designation === 'Penthouse') {
    orderIndex = 999;
  } else if (designation.startsWith('Level ')) {
    const levelNum = parseInt(designation.split(' ')[1], 10);
    orderIndex = isNaN(levelNum) ? 1 : levelNum;
  }

  // Check if designation already exists for this location
  db.get('SELECT id, image_url FROM battle_maps WHERE location_id = ? AND designation = ?', [locationId, designation], (err, existing) => {
    if (err) {
      fs.unlinkSync(req.file.path);
      return res.status(500).json({ error: err.message });
    }

    if (existing) {
      // Overwrite existing
      const oldPath = path.join(__dirname, '..', existing.image_url);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);

      db.run('UPDATE battle_maps SET image_url = ?, order_index = ? WHERE id = ?', [imageUrl, orderIndex, existing.id], (err2) => {
        if (err2) return res.status(500).json({ error: err2.message });
        emitUpdate();
        res.json({ message: 'Battle map updated', id: existing.id, imageUrl });
      });
    } else {
      // Insert new
      db.run('INSERT INTO battle_maps (location_id, designation, image_url, order_index) VALUES (?, ?, ?, ?)', [locationId, designation, imageUrl, orderIndex], function(err2) {
        if (err2) return res.status(500).json({ error: err2.message });
        emitUpdate();
        res.json({ message: 'Battle map created', id: this.lastID, imageUrl });
      });
    }
  });
});

app.get('/api/locations/:id/battle_maps', (req, res) => {
  db.all('SELECT * FROM battle_maps WHERE location_id = ? ORDER BY order_index ASC', [req.params.id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.delete('/api/locations/:id/battle_maps/:mapId', authenticate, (req, res) => {
  if (!req.user.isAdmin || req.user.isTemporary) {
    return res.status(403).json({ error: 'Only main admin can manage battle maps' });
  }

  db.get('SELECT image_url FROM battle_maps WHERE id = ?', [req.params.mapId], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Map not found' });

    const filePath = path.join(__dirname, '..', row.image_url);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    db.run('DELETE FROM battle_maps WHERE id = ?', [req.params.mapId], (err2) => {
      if (err2) return res.status(500).json({ error: err2.message });
      emitUpdate();
      res.json({ message: 'Battle map deleted' });
    });
  });
});
// ----------------------------

app.post('/api/locations'`;
    code = code.replace(targetRouteStr, battleMapRoutes);
}

// 4. Update Socket Events
if (!code.includes("battle_map_enter")) {
    const targetSocket = `socket.on('disconnect', () => {`;
    const battleMapSockets = `
  socket.on('battle_map_enter', (data) => {
    // data: { locationId, floorIndex }
    const info = userSockets.get(socket.id);
    if (info) {
      info.currentBattleMapId = data.locationId;
      info.currentFloorIndex = data.floorIndex;
      broadcastActiveUsers();
    }
  });

  socket.on('battle_map_leave', () => {
    const info = userSockets.get(socket.id);
    if (info) {
      info.currentBattleMapId = null;
      info.currentFloorIndex = null;
      broadcastActiveUsers();
    }
  });

  socket.on('admin_force_floor_change', (data) => {
    // data: { locationId, floorIndex }
    const info = userSockets.get(socket.id);
    if (info && info.isAdmin) {
      io.emit('force_floor_change', data);
    }
  });

  socket.on('battle_map_move', (data) => {
    // data: { userName, x, z }
    const info = userSockets.get(socket.id);
    if (info && info.currentBattleMapId) {
      // Broadcast to all users in this specific battle map and floor? 
      // Or just broadcast to everyone in battle_map.
      io.emit('battle_map_moved', { userName: info.userName, x: data.x, z: data.z, locationId: info.currentBattleMapId, floorIndex: info.currentFloorIndex });
    }
  });

  socket.on('disconnect', () => {`;
    code = code.replace(targetSocket, battleMapSockets);
}

fs.writeFileSync('server.js', code);
console.log('Successfully patched server.js for Battle Maps API and Sockets.');
