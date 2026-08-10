"use client";

import { Suspense, useEffect, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { MeshDistortMaterial, Sphere } from "@react-three/drei";
import { PerspectiveCamera as PerspectiveCameraImpl, type Mesh } from "three";

/**
 * A single bold chrome/liquid-metal 3D object for the hero — the decorative
 * ChromeBlob3D cluster (used on signup) reads as small background texture,
 * but a hero needs one confident focal render (see: dribbble's FANCY /
 * Nickel-style landing shots — one large glowing 3D subject with a neon rim
 * light, not scattered accents) rather than more of the same small blobs.
 */
const INITIAL_CAMERA = { position: [0, 0, 6] as [number, number, number], fov: 45 };

function ResponsiveCamera() {
  const { camera, size } = useThree();
  useEffect(() => {
    if (!(camera instanceof PerspectiveCameraImpl) || size.height === 0) return;
    const aspect = size.width / size.height;
    const targetHalfWidth = 2.6;
    const vFovRad = (camera.fov * Math.PI) / 180;
    const distance = targetHalfWidth / (Math.tan(vFovRad / 2) * aspect);
    camera.position.z = Math.min(Math.max(distance, 5), 9);
    camera.updateProjectionMatrix();
  }, [camera, size]);
  return null;
}

function MainOrb() {
  const meshRef = useRef<Mesh>(null);
  useFrame((state) => {
    if (!meshRef.current) return;
    const t = state.clock.elapsedTime;
    meshRef.current.rotation.x = t * 0.1;
    meshRef.current.rotation.y = t * 0.14;
    meshRef.current.position.y = Math.sin(t * 0.4) * 0.18;
    meshRef.current.position.x = Math.cos(t * 0.3) * 0.14;
  });
  return (
    <Sphere ref={meshRef} args={[1, 128, 128]} scale={1.55}>
      <MeshDistortMaterial color="#C9A227" attach="material" distort={0.38} speed={1.4} roughness={0.15} metalness={0.85} />
    </Sphere>
  );
}

function SatelliteOrb() {
  const meshRef = useRef<Mesh>(null);
  useFrame((state) => {
    if (!meshRef.current) return;
    const t = state.clock.elapsedTime;
    meshRef.current.rotation.x = t * 0.16;
    meshRef.current.position.x = 1.05 + Math.sin(t * 0.5) * 0.12;
    meshRef.current.position.y = -0.75 + Math.cos(t * 0.45) * 0.12;
  });
  return (
    <Sphere ref={meshRef} args={[1, 64, 64]} scale={0.55} position={[1.05, -0.75, 0.6]}>
      <MeshDistortMaterial color="#6E5A9E" attach="material" distort={0.42} speed={1.8} roughness={0.2} metalness={0.8} />
    </Sphere>
  );
}

export function HeroChrome3D({ className }: { className?: string }) {
  return (
    <div className={className}>
      <Canvas camera={INITIAL_CAMERA} dpr={[1, 1.5]} gl={{ alpha: true, antialias: true }} frameloop="always">
        <Suspense fallback={null}>
          <ResponsiveCamera />
          <ambientLight intensity={0.9} />
          <hemisphereLight args={["#f5e6c8", "#18181b", 1.1]} />
          <pointLight position={[2.5, 1.5, 3]} intensity={90} color="#dbb44a" />
          <pointLight position={[-2, -1.5, 2]} intensity={55} color="#6E5A9E" />
          <pointLight position={[0, 2.5, 1.5]} intensity={40} color="#f5e6c8" />
          <pointLight position={[-1.5, 2, 2.5]} intensity={30} color="#ffffff" />
          <MainOrb />
          <SatelliteOrb />
        </Suspense>
      </Canvas>
    </div>
  );
}
