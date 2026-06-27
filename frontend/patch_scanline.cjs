const fs = require('fs');
let code = fs.readFileSync('src/App.css', 'utf8');

code = code.replace(/\r\n/g, '\n');

const searchStr = `.scanlines::before {
    content: "";
    display: block;
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: linear-gradient(rgba(18, 16, 16, 0) 0%, rgba(32, 255, 32, 0.1) 50%, rgba(18, 16, 16, 0) 100%);
    background-size: 100% 800px;
    animation: scanline 10s linear infinite;
    pointer-events: none;
  }
  
@keyframes scanline {
    0% { transform: translateY(-800px); }
    100% { transform: translateY(800px); }
  }`;

const replacementStr = `.scanlines::before {
    content: "";
    display: block;
    position: absolute;
    top: -800px;
    left: 0;
    right: 0;
    height: calc(100% + 800px);
    background: linear-gradient(to bottom, rgba(18, 16, 16, 0) 0%, rgba(32, 255, 32, 0.05) 50%, rgba(18, 16, 16, 0) 100%);
    background-size: 100% 800px;
    animation: scanline 8s linear infinite;
    pointer-events: none;
  }
  
@keyframes scanline {
    0% { transform: translateY(0); }
    100% { transform: translateY(800px); }
  }`;

if (code.includes(searchStr)) {
    code = code.replace(searchStr, replacementStr);
    console.log("Patched CSS animation");
} else {
    console.log("Regex match failed");
}

code = code.replace(/\n/g, '\r\n');
fs.writeFileSync('src/App.css', code);
