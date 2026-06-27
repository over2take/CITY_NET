const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const regexEnemy = /const EnemyRhombus = React\.memo\(\(\{ location, onClick, isSelected, setTargetObject, token, refreshLocations, setIsDragging, socket, roads \}: any\) => \{[\s\S]*?const \[isLocalDragging, setIsLocalDragging\] = useState\(false\);/;

const injectEnemy = `$&
    useEffect(() => {
        const handleGlobalUp = () => {
            if (isLocalDragging) {
                if (controls) (controls as any).enabled = true;
                setIsLocalDragging(false);
                setIsDragging(false);
            }
        };
        window.addEventListener('pointerup', handleGlobalUp);
        return () => window.removeEventListener('pointerup', handleGlobalUp);
    }, [isLocalDragging, controls, setIsDragging]);`;

code = code.replace(regexEnemy, injectEnemy);

const regexPlayer = /const PlayerRhombus = React\.memo\(\(\{ location, onClick, isSelected, setTargetObject, token, userName, refreshLocations, setIsDragging, socket, activeUsers, roads \}: any\) => \{[\s\S]*?const \[isLocalDragging, setIsLocalDragging\] = useState\(false\);/;

const injectPlayer = `$&
    useEffect(() => {
        const handleGlobalUp = () => {
            if (isLocalDragging) {
                if (controls) (controls as any).enabled = true;
                setIsLocalDragging(false);
                setIsDragging(false);
            }
        };
        window.addEventListener('pointerup', handleGlobalUp);
        return () => window.removeEventListener('pointerup', handleGlobalUp);
    }, [isLocalDragging, controls, setIsDragging]);`;

code = code.replace(regexPlayer, injectPlayer);

fs.writeFileSync('src/App.tsx', code);
console.log("Patched local dragging failsafes");
