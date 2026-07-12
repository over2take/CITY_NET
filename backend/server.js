require('dotenv').config();

// Validate required environment variables
const requiredEnvVars = ['JWT_SECRET', 'ADMIN_USER', 'ADMIN_PASS'];
const missingVars = requiredEnvVars.filter(v => !process.env[v]);
if (missingVars.length > 0) {
  console.warn(`⚠️  Missing required environment variables: ${missingVars.join(', ')}`);
  console.warn('   See backend/.env.example for defaults or run: docker cp citynet-backend:/app/.env.example ./backend/.env.example.new');
}

const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const db = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const PORT = process.env.PORT || 5000;

const emitUpdate = (payload = {}) => io.emit('dataUpdated', payload);
const recordAction = (type, payload) => {
  db.run('INSERT INTO action_history (type, payload) VALUES (?, ?)', [type, JSON.stringify(payload)]);
};

const { elevatedUsers } = require('./middleware/auth');
const helpers = { emitUpdate, recordAction };

// Middleware
app.use(cors());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/uploads/music', express.static(path.join(__dirname, 'uploads/music')));
app.use(express.json({ limit: '2mb' }));

// Routes
app.use('/api/locations', require('./routes/locations')(db, io, helpers));
app.use('/api/locations/:id/battle_maps', require('./routes/battle_maps')(db, io, helpers));
app.use('/api/battle_maps', require('./routes/battle_maps')(db, io, helpers));
app.use('/api/maps', require('./routes/maps')(db, io, helpers));
app.use('/api/roads', require('./routes/roads')(db, io, helpers));
app.use('/api/overpasses', require('./routes/overpasses')(db, io, helpers));
app.use('/api/signs', require('./routes/signs')(db, io, helpers));
app.use('/api/fonts', require('./routes/fonts')(db, io));
app.use('/uploads/fonts', express.static(path.join(__dirname, 'uploads/fonts')));
app.use('/api/player', require('./routes/player')(db, io));
app.use('/api', require('./routes/admin')(db, io, helpers));
app.use('/api/music', require('./routes/music')(db, io));
app.use('/api/sheets', require('./routes/sheets')(db, io));

// Frontend static serving
const frontendDist = path.join(__dirname, '../frontend/dist');
app.use(express.static(frontendDist));
app.use((req, res) => res.sendFile(path.join(frontendDist, 'index.html')));

// Sockets
require('./sockets')(io, db, { elevatedUsers, ...helpers });

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  if (process.env.ADMIN_PASS === 'cyberpunk_password' || !process.env.ADMIN_PASS) {
    console.warn('\x1b[33m⚠️  WARNING: Default admin password in use. Set ADMIN_PASS in your .env file.\x1b[0m');
  }
  require('./startup/sanity_checks')();
});
