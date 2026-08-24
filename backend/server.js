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

// Every request arrives through the frontend's nginx, so without this `req.ip` is the
// proxy's address for all of them — and anything counting per caller would really be
// counting everyone together. One hop, because the backend port is not published: nginx
// is the only thing that can reach it, so the address it forwards is the client's.
app.set('trust proxy', 1);

// Middleware
app.use(cors());

// Everything under /uploads is served with no auth and all of it came from outside.
// See middleware/uploadHeaders.js for what these headers stop and why the upload
// allowlists can stay as wide as the file pickers because of them.
const uploadHeaders = require('./middleware/uploadHeaders').setUploadHeaders;

app.use('/uploads', express.static(path.join(__dirname, 'uploads'), { setHeaders: uploadHeaders }));
app.use('/uploads/music', express.static(path.join(__dirname, 'uploads/music'), { setHeaders: uploadHeaders }));
app.use(express.json({ limit: '2mb' }));

// Routes
app.use('/api/locations', require('./routes/locations')(db, io, helpers));
app.use('/api/locations/:id/battle_maps', require('./routes/battle_maps')(db, io, helpers));
app.use('/api/battle_maps', require('./routes/battle_maps')(db, io, helpers));
app.use('/api/maps', require('./routes/maps')(db, io, helpers));
app.use('/api/roads', require('./routes/roads')(db, io, helpers));
app.use('/api/overpasses', require('./routes/overpasses')(db, io, helpers));
app.use('/api/signs', require('./routes/signs')(db, io, helpers));
app.use('/api/custom_dice', require('./routes/custom_dice')(db, io, helpers));
app.use('/api/system_dice', require('./routes/system_dice')());
app.use('/api/fonts', require('./routes/fonts')(db, io));
app.use('/uploads/fonts', express.static(path.join(__dirname, 'uploads/fonts'), { setHeaders: uploadHeaders }));
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
