import React from 'react';

export const renderBaseGeometry = (shape: string, polyCount: number = 5) => {
  switch (shape) {
    case 'none': return <boxGeometry args={[0.001, 0.001, 0.001]} />;
    case 'cylinder': return <cylinderGeometry args={[0.5, 0.5, 1, Math.max(3, polyCount)]} />;
    case 'sphere': return <sphereGeometry args={[0.5, Math.max(3, polyCount), Math.max(3, polyCount)]} />;
    case 'rhombus': return <octahedronGeometry args={[0.5]} />;
    case 'pyramid': return <coneGeometry args={[0.5, 1, Math.max(3, polyCount)]} />;
    default: return <boxGeometry args={[1, 1, 1]} />;
  }
};
