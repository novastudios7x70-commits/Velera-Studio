"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { MeshDistortMaterial, Sphere } from "@react-three/drei";
import type { Mesh } from "three";

/**
 * Real WebGL 3D (Three.js via react-three-fiber), not a CSS fake — per
 * feedback that the flat blob decoration read as too 2D against
 * reference sites (k95.it's chrome sculpture in particular). A cluster
 * of slowly-rotating liquid-metal spheres at different sizes: organic
 * like the CSS blobs, but genuinely three-dimensional, tinted with the
 * app's own accent colors instead of a neutral studio chrome look.
 */
interface BlobConfig {
  position: [number, number, number];
  scale: number;
  color: string;
  distort: number;
  speed: number;
  rotSpeed: number;
}

// Spread wide across the full canvas width — this renders full-bleed
// behind the page now, not in a boxed side panel, so the form's opaque
// card covers the center and the blobs read as flanking it left/right.
const BLOBS: BlobConfig[] = [
  { position: [-3.4, 0.6, -1], scale: 0.95, color: "#A855F7", distort: 0.45, speed: 1.6, rotSpeed: 1 },
  { position: [3.6, 1.3, -1.5], scale: 0.65, color: "#D4AF37", distort: 0.35, speed: 1.1, rotSpeed: 1.4 },
  { position: [-4.2, -1.6, -2], scale: 0.5, color: "#E63946", distort: 0.4, speed: 1.9, rotSpeed: 0.7 },
  { position: [4.3, -1, -1.8], scale: 0.4, color: "#c084fc", distort: 0.5, speed: 2.2, rotSpeed: 1.8 },
  { position: [2.9, 2.4, -2.5], scale: 0.32, color: "#D4AF37", distort: 0.3, speed: 1.4, rotSpeed: 1.2 },
  { position: [-4.8, 2.4, -2], scale: 0.34, color: "#E63946", distort: 0.38, speed: 1.7, rotSpeed: 0.9 },
];

function DistortedSphere({ position, scale, color, distort, speed, rotSpeed }: BlobConfig) {
  const meshRef = useRef<Mesh>(null);

  useFrame((state) => {
    if (!meshRef.current) return;
    meshRef.current.rotation.x = state.clock.elapsedTime * 0.08 * rotSpeed;
    meshRef.current.rotation.y = state.clock.elapsedTime * 0.12 * rotSpeed;
  });

  return (
    <Sphere ref={meshRef} args={[1, 128, 128]} position={position} scale={scale}>
      <MeshDistortMaterial color={color} attach="material" distort={distort} speed={speed} roughness={0.28} metalness={0.55} />
    </Sphere>
  );
}

export function ChromeBlob3D({ className }: { className?: string }) {
  // Don't stand up a WebGL context that just renders hidden frames behind
  // a `hidden lg:block` wrapper — actually skip mounting it on small
  // viewports instead of only hiding it visually.
  const [canRender, setCanRender] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    setCanRender(mq.matches);
    const onChange = () => setCanRender(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  if (!canRender) return null;

  return (
    <div className={className}>
      <Canvas camera={{ position: [0, 0, 7], fov: 50 }} dpr={[1, 1.5]} gl={{ alpha: true, antialias: true }}>
        <Suspense fallback={null}>
          <ambientLight intensity={1.1} />
          <hemisphereLight args={["#e9d5ff", "#1a1024", 1.2]} />
          <pointLight position={[3, 2, 4]} intensity={70} color="#D4AF37" />
          <pointLight position={[-3, -2, 2]} intensity={60} color="#E63946" />
          <pointLight position={[0, 3, -2]} intensity={45} color="#A855F7" />
          <pointLight position={[-2, 3, 3]} intensity={35} color="#ffffff" />
          {BLOBS.map((blob, i) => (
            <DistortedSphere key={i} {...blob} />
          ))}
        </Suspense>
      </Canvas>
    </div>
  );
}
