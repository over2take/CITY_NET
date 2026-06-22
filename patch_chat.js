const fs = require('fs');
let code = fs.readFileSync('backend/server.js', 'utf8');

// Fix global chat spoofing prevention to allow primary admin
const spoofOld = \    if (data.sender !== socket.userName && !elevatedUsers.has(socket.userName)) {\;
const spoofNew = \    if (data.sender !== socket.userName && !elevatedUsers.has(socket.userName) && socket.userName !== ADMIN_CREDENTIALS.split(':')[0]) {\;
if (code.includes(spoofOld)) {
    code = code.replace(spoofOld, spoofNew);
} else {
    console.log('Could not find global spoof logic');
}

// Fix private chat includes bug for activeNPCs
const npcOld = \const involvesNPC = activeNPCs.includes(data.sender) || activeNPCs.includes(data.recipient);\;
const npcNew = \const involvesNPC = activeNPCs.some(n => n.userName === data.sender || n.userName === data.recipient);\;
if (code.includes(npcOld)) {
    code = code.replace(npcOld, npcNew);
} else {
    console.log('Could not find involvesNPC logic');
}

fs.writeFileSync('backend/server.js', code);
console.log('Patched chat logic');
