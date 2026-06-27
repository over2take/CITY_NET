const fs = require('fs');
let code = fs.readFileSync('backend/server.js', 'utf8');

const spoofOld = `    if (data.sender !== socket.userName && !elevatedUsers.has(socket.userName) && socket.userName !== ADMIN_CREDENTIALS.split(':')[0]) {
      data.sender = socket.userName; // Prevent spoofing
    }`;

const spoofNew = `    const actualUserName = userSockets.get(socket.id)?.userName;
    if (data.sender !== actualUserName && !elevatedUsers.has(actualUserName) && actualUserName !== ADMIN_CREDENTIALS.split(':')[0]) {
      data.sender = actualUserName || 'Unknown'; // Prevent spoofing
    }`;

if (code.includes(spoofOld)) {
    code = code.replace(spoofOld, spoofNew);
} else {
    // maybe we didn't match perfectly, let's try regex
    code = code.replace(
        /if \(data\.sender !== socket\.userName && !elevatedUsers\.has\(socket\.userName\) && socket\.userName !== ADMIN_CREDENTIALS\.split\(':'\)\[0\]\) \{\s*data\.sender = socket\.userName; \/\/ Prevent spoofing\s*\}/g,
        `const actualUserName = userSockets.get(socket.id)?.userName;
    if (data.sender !== actualUserName && !elevatedUsers.has(actualUserName) && actualUserName !== ADMIN_CREDENTIALS.split(':')[0]) {
      data.sender = actualUserName || 'Unknown'; // Prevent spoofing
    }`
    );
}

fs.writeFileSync('backend/server.js', code);
console.log('Patched global chat socket.userName');
