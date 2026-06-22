const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

code = code.replace(
    `selectedLocation={selectedLocation} \n                  setSelectedLocation={setSelectedLocation}`,
    `selectedLocation={selectedLocation} \n                  isDragging={isDragging} \n                  setSelectedLocation={setSelectedLocation}`
);

fs.writeFileSync('src/App.tsx', code);
console.log('Patch complete!');
