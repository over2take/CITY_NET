const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const regexRaceCondition = /    useEffect\(\(\) => \{\s*const handleGlobalUp = \(\) => \{\s*if \(isLocalDragging\) \{\s*if \(controls\) \(controls as any\)\.enabled = true;\s*setIsLocalDragging\(false\);\s*setIsDragging\(false\);\s*\}\s*\};\s*window\.addEventListener\('pointerup', handleGlobalUp\);\s*return \(\) => window\.removeEventListener\('pointerup', handleGlobalUp\);\s*\}, \[isLocalDragging, controls, setIsDragging\]\);/g;

const robustFailsafe = `    useEffect(() => {
        const handleGlobalUp = () => {
            setIsLocalDragging((prev) => {
                if (prev) {
                    if (controls) (controls as any).enabled = true;
                    setIsDragging(false);
                }
                return false;
            });
        };
        window.addEventListener('pointerup', handleGlobalUp);
        return () => window.removeEventListener('pointerup', handleGlobalUp);
    }, [controls, setIsDragging]);`;

code = code.replace(regexRaceCondition, robustFailsafe);

fs.writeFileSync('src/App.tsx', code);
console.log("Fixed race condition");
