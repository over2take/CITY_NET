import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

interface HealthBarProps {
  hpCurrent: number;
  hpMax: number;
  hpTemp?: number;
  position?: [number, number, number];
  isBattleMap?: boolean;
}

export const HealthBar: React.FC<HealthBarProps> = ({ hpCurrent, hpMax, hpTemp = 0, position = [0, 2.0, 0], isBattleMap = false }) => {
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const tempMaterialRef = useRef<THREE.ShaderMaterial>(null);
  
  const safeHpMax = hpMax && hpMax > 0 ? hpMax : 1;
  const hpPercent = Math.max(0, Math.min(1, hpCurrent / safeHpMax));
  const color = new THREE.Color().setHSL(0.33 * hpPercent, 1.0, 0.5);
  
  const uniforms = useMemo(() => ({
    fillPercentage: { value: hpPercent },
    fillColor: { value: color },
    bgColor: { value: new THREE.Color(0.2, 0.2, 0.2) },
    innerRadius: { value: isBattleMap ? 0.32 : 0.35 },
    outerRadius: { value: isBattleMap ? 0.4 : 0.45 },
    startT: { value: isBattleMap ? 0.05 : 0.2 },
    endT: { value: isBattleMap ? 0.95 : 0.8 }
  }), [hpPercent, color, isBattleMap]);

  const tempUniforms = useMemo(() => ({
    fillPercentage: { value: Math.max(0, Math.min(1, hpTemp / 100)) },
    fillColor: { value: new THREE.Color('#00ccff') },
    bgColor: { value: new THREE.Color(0.1, 0.1, 0.15) },
    innerRadius: { value: isBattleMap ? 0.25 : 0.25 },
    outerRadius: { value: isBattleMap ? 0.3 : 0.32 },
    startT: { value: isBattleMap ? 0.05 : 0.2 },
    endT: { value: isBattleMap ? 0.95 : 0.8 }
  }), [hpTemp, isBattleMap]);

  useFrame(() => {
    if (materialRef.current) {
      materialRef.current.uniforms.fillPercentage.value = Math.max(0, Math.min(1, hpCurrent / safeHpMax));
      materialRef.current.uniforms.fillColor.value.setHSL(0.33 * Math.max(0, Math.min(1, hpCurrent / safeHpMax)), 1.0, 0.5);
    }
    if (tempMaterialRef.current) {
      tempMaterialRef.current.uniforms.fillPercentage.value = Math.max(0, Math.min(1, hpTemp / 100));
    }
  });

  if (hpMax <= 0 || hpMax === null || hpMax === undefined) return null;

  const vertexShader = `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      // Billboard the mesh to always face camera
      vec4 mvPosition = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      mvPosition.xy += position.xy * ${isBattleMap ? '5.0' : '1.0'};
      mvPosition.x += ${isBattleMap ? '0.0' : '2.2'}; // Center on Battle Map, offset on City Map
      gl_Position = projectionMatrix * mvPosition;
    }
  `;

  const fragmentShader = `
    varying vec2 vUv;
    uniform float fillPercentage;
    uniform vec3 fillColor;
    uniform vec3 bgColor;
    uniform float innerRadius;
    uniform float outerRadius;
    uniform float startT;
    uniform float endT;

    void main() {
        vec2 pos = vUv - vec2(0.5);
        float dist = length(pos);
        
        float fw = fwidth(dist);
        if (fw == 0.0) fw = 0.01;
        float alpha = smoothstep(outerRadius, outerRadius - fw, dist) * smoothstep(innerRadius - fw, innerRadius, dist);
        
        if (alpha < 0.01) discard;
        if (pos.x < 0.0) discard; // Keep right half )
        
        float angle = atan(pos.x, pos.y);
        float t = 1.0 - (angle / 3.14159265);
        
        if (t < startT || t > endT) discard;
        
        float mappedT = (t - startT) / (endT - startT);
        
        vec3 finalColor = bgColor;
        if (mappedT <= fillPercentage) {
            finalColor = fillColor;
        }
        
        gl_FragColor = vec4(finalColor, alpha);
    }
  `;

  return (
    <group position={position}>
      <mesh raycast={() => null}>
        <planeGeometry args={[5, 5]} />
        <shaderMaterial 
          ref={materialRef}
          vertexShader={vertexShader}
          fragmentShader={fragmentShader}
          uniforms={uniforms}
          transparent={true}
          depthTest={true}
          depthWrite={false}
        />
      </mesh>

      {hpTemp > 0 && (
        <mesh raycast={() => null}>
          <planeGeometry args={[5, 5]} />
          <shaderMaterial 
            ref={tempMaterialRef}
            vertexShader={vertexShader}
            fragmentShader={fragmentShader}
            uniforms={tempUniforms}
            transparent={true}
            depthTest={true}
            depthWrite={false}
          />
        </mesh>
      )}
    </group>
  );
};
