const db = require('./db');

const initialLocations = [
  { name: 'NEON_SPIRE', description: 'A massive skyscraper serving as the corporate HQ for Arasaka.', npcs: 'Adam Smasher (Security), Hanako Arasaka (CEO)', x: 0, y: 0, z: 0, width: 2, height: 10, depth: 2 },
  { name: 'THE_AFTERLIFE', description: 'The premier merc bar in Night City.', npcs: 'Rogue Amendiares (Fixer), Claire (Bartender)', x: 5, y: 0, z: -3, width: 3, height: 1.5, depth: 3 },
  { name: 'LIZZIES_BAR', description: 'Mox territory. Best braindances in the city.', npcs: 'Judy Alvarez (Tech), Susie Q (Leader)', x: -4, y: 0, z: 4, width: 2, height: 2, depth: 2 }
];

db.serialize(() => {
  initialLocations.forEach(loc => {
    db.run(`INSERT INTO locations (name, description, npcs, x, y, z, width, height, depth) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
      [loc.name, loc.description, loc.npcs, loc.x, loc.y, loc.z, loc.width, loc.height, loc.depth]);
  });
  console.log("Initial city data seeded.");
  db.close();
});
