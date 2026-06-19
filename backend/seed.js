const db = require('./db');
const bcrypt = require('bcrypt');

const username = 'admin';
const password = 'cyberpunk_password';

async function seed() {
  const hashedPassword = await bcrypt.hash(password, 10);
  db.run(`INSERT OR REPLACE INTO admin (username, password) VALUES (?, ?)`, [username, hashedPassword], (err) => {
    if (err) console.error(err.message);
    else console.log(`Admin user created: ${username} / ${password}`);
    db.close();
  });
}

seed();
