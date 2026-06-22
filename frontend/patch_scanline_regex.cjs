const fs = require('fs');
let code = fs.readFileSync('src/App.css', 'utf8');

code = code.replace(
    /\.scanlines::before \{\s*content: "";\s*display: block;\s*position: absolute;\s*top: 0;\s*left: 0;\s*right: 0;\s*bottom: 0;\s*background: linear-gradient\([\s\S]*?\);\s*background-size: 100% 800px;\s*animation: scanline 10s linear infinite;\s*pointer-events: none;\s*\}\s*@keyframes scanline \{\s*0% \{ transform: translateY\(-800px\); \}\s*100% \{ transform: translateY\(800px\); \}\s*\}/,
    `.scanlines::before {
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
  }`
);

fs.writeFileSync('src/App.css', code);
console.log('Regex patch complete');
