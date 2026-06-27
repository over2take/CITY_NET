import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Billboard } from '@react-three/drei';
import * as THREE from 'three';

interface PingEffectProps {
    position: [number, number, number];
    color: string;
    size: number;
}

const PingEffect: React.FC<PingEffectProps> = ({ position, color, size }) => {
    const groupRef = useRef<THREE.Group>(null);

    // Baseline scale to ensure it fits nicely around the target
    const baseScale = Math.max(2, size * 0.8);

    useFrame((state) => {
        if (!groupRef.current) return;
        
        // Bounce animation using sine wave
        const time = state.clock.getElapsedTime();
        const bounce = Math.sin(time * 8) * 0.2;
        
        // Scale pulse
        const scale = baseScale + bounce;
        groupRef.current.scale.set(scale, scale, scale);

        // Fade out slightly over time
        const newOpacity = 0.5 + Math.sin(time * 6) * 0.3;
        const shadowOpacity = 0.3 + Math.sin(time * 6) * 0.2;
        groupRef.current.traverse((child: any) => {
            if (child.isMesh && child.material) {
                child.material.opacity = child.userData.isShadow ? shadowOpacity : newOpacity;
            }
        });
    });

    // Create a simple arrow shape using a 3-sided cone flattened
    const Arrow = ({ rotation, isShadow = false }: { rotation: number, isShadow?: boolean }) => (
        <mesh position={[Math.cos(rotation) * 1.5, Math.sin(rotation) * 1.5, isShadow ? -0.1 : 0]} rotation={[0, 0, rotation - Math.PI / 2]} userData={{ isShadow }}>
            <coneGeometry args={isShadow ? [0.4, 0.9, 3] : [0.3, 0.8, 3]} />
            <meshBasicMaterial color={isShadow ? '#000000' : color} transparent opacity={isShadow ? 0.4 : 0.8} depthTest={false} />
        </mesh>
    );

    const Ring = ({ isShadow = false }: { isShadow?: boolean }) => (
        <mesh position={[0, 0, isShadow ? -0.1 : 0]} userData={{ isShadow }}>
            <ringGeometry args={isShadow ? [0.7, 1.1, 32] : [0.8, 1.0, 32]} />
            <meshBasicMaterial color={isShadow ? '#000000' : color} transparent opacity={isShadow ? 0.4 : 0.6} depthTest={false} />
        </mesh>
    );

    return (
        <group position={position}>
            <Billboard follow={true} lockX={false} lockY={false} lockZ={false}>
                <group ref={groupRef}>
                    {/* Shadow Layer */}
                    <Arrow rotation={0} isShadow={true} />
                    <Arrow rotation={Math.PI / 2} isShadow={true} />
                    <Arrow rotation={Math.PI} isShadow={true} />
                    <Arrow rotation={(3 * Math.PI) / 2} isShadow={true} />
                    <Ring isShadow={true} />

                    {/* Main Layer */}
                    <Arrow rotation={0} />
                    <Arrow rotation={Math.PI / 2} />
                    <Arrow rotation={Math.PI} />
                    <Arrow rotation={(3 * Math.PI) / 2} />
                    <Ring />
                </group>
            </Billboard>
        </group>
    );
};

export default PingEffect;
