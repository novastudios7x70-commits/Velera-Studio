"use client";

import { Suspense, useEffect, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { MeshDistortMaterial, Sphere } from "@react-three/drei";
import { PerspectiveCamera as PerspectiveCameraImpl, type Mesh } from "three";

/**
 * Real WebGL 3D (Three.js via react-three-fiber), not a CSS fake — per
 * feedback that the flat blob decoration read as too 2D against
 * reference sites (k95.it's chrome sculpture in particular). A cluster
 * of slowly-drifting liquid-metal spheres at different sizes: organic
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

// A fixed camera distance only shows the wide blob spread correctly on a
// wide (desktop) aspect ratio — horizontal FOV shrinks with the container's
// aspect ratio, so on a narrow phone-portrait canvas every blob fell
// outside frame. Pull the camera back as the container gets narrower so
// the same world-space half-width stays visible regardless of shape.
const TARGET_HALF_WIDTH = 5.4;

function ResponsiveCamera() {
  const { camera, size } = useThree();

  useEffect(() => {
    if (!(camera instanceof PerspectiveCameraImpl) || size.height === 0) return;
    const aspect = size.width / size.height;
    const vFovRad = (camera.fov * Math.PI) / 180;
    const distance = TARGET_HALF_WIDTH / (Math.tan(vFovRad / 2) * aspect);
    camera.position.z = Math.min(Math.max(distance, 7), 26);
    camera.updateProjectionMatrix();
  }, [camera, size]);

  return null;
}

function DistortedSphere({ position, scale, color, distort, speed, rotSpeed }: BlobConfig) {
  const meshRef = useRef<Mesh>(null);
  // Random per-instance phase so the blobs don't bob in lockstep.
  const phase = useRef(Math.random() * Math.PI * 2).current;

  useFrame((state) => {
    if (!meshRef.current) return;
    const t = state.clock.elapsedTime;
    meshRef.current.rotation.x = t * 0.08 * rotSpeed;
    meshRef.current.rotation.y = t * 0.12 * rotSpeed;
    // Gentle floating drift — a rotating sphere alone barely reads as
    // moving (rotational symmetry hides it), so position is what actually
    // sells "alive" here.
    meshRef.current.position.x = position[0] + Math.sin(t * 0.35 * rotSpeed + phase) * 0.35;
    meshRef.current.position.y = position[1] + Math.cos(t * 0.28 * rotSpeed + phase) * 0.3;
  });

  return (
    <Sphere ref={meshRef} args={[1, 64, 64]} position={position} scale={scale}>
      <MeshDistortMaterial color={color} attach="material" distort={distort} speed={speed} roughness={0.28} metalness={0.55} />
    </Sphere>
  );
}

// A fresh object literal here on every render makes react-three-fiber
// keep re-applying these initial values, fighting ResponsiveCamera's
// imperative position updates — this must stay a stable reference.
const INITIAL_CAMERA = { position: [0, 0, 7] as [number, number, number], fov: 50 };

export function ChromeBlob3D({ className }: { className?: string }) {
  return (
    <div className={className}>
      <Canvas camera={INITIAL_CAMERA} dpr={[1, 1.5]} gl={{ alpha: true, antialias: true }} frameloop="always">
        <Suspense fallback={null}>
          <ResponsiveCamera />
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
