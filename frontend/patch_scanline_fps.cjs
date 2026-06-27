const fs = require('fs');
let code = fs.readFileSync('src/App.css', 'utf8');

code = code.replace(
    /\.scanlines::before \{\s*content: "";\s*display: block;\s*position: absolute;\s*top: -800px;\s*left: 0;\s*right: 0;\s*height: calc\(100% \+ 800px\);\s*background: linear-gradient\([\s\S]*?\);\s*background-size: 100% 800px;\s*animation: scanline 8s linear infinite;\s*pointer-events: none;\s*\}\s*@keyframes scanline \{\s*0% \{ transform: translateY\(0\); \}\s*100% \{ transform: translateY\(800px\); \}\s*\}/,
    `.scanlines::before {
    content: "";
    display: block;
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 800px;
    background: linear-gradient(rgba(18, 16, 16, 0) 0%, rgba(32, 255, 32, 0.05) 50%, rgba(18, 16, 16, 0) 100%);
    animation: scanline 10s linear infinite;
    pointer-events: none;
    transform: translateZ(0);
  }
  
@keyframes scanline {
    0% { transform: translateY(-800px); }
    100% { transform: translateY(100vh); }
  }`
);

fs.writeFileSync('src/App.css', code);
console.log('Regex patch complete');
