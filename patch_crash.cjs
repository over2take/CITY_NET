const fs = require('fs');
let code = fs.readFileSync('backend/server.js', 'utf8');

const spoofOld = `    const actualUserName = userSockets.get(socket.id)?.userName;
    if (data.sender !== actualUserName && !elevatedUsers.has(actualUserName) && actualUserName !== ADMIN_CREDENTIALS.split(':')[0]) {
      data.sender = actualUserName || 'Unknown'; // Prevent spoofing
    }`;

const spoofNew = `    const actualInfo = userSockets.get(socket.id);
    const actualUserName = actualInfo?.userName;
    const isPrimaryAdmin = actualInfo?.isAdmin;
    if (data.sender !== actualUserName && !elevatedUsers.has(actualUserName) && !isPrimaryAdmin) {
      data.sender = actualUserName || 'Unknown'; // Prevent spoofing
    }`;

if (code.includes(spoofOld)) {
    code = code.replace(spoofOld, spoofNew);
} else {
    console.log('Could not find spoofOld string');
}

fs.writeFileSync('backend/server.js', code);
console.log('Patched crash in server.js');
