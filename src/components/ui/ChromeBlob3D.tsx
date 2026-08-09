"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { MeshDistortMaterial, Sphere } from "@react-three/drei";
import type { Mesh } from "three";

/**
 * Real WebGL 3D (Three.js via react-three-fiber), not a CSS fake — per
 * feedback that the flat blob decoration read as too 2D against
 * reference sites (k95.it's chrome sculpture in particular). A single
 * slowly-rotating liquid-metal sphere: organic like the CSS blobs, but
 * genuinely three-dimensional, tinted with the app's own accent colors
 * instead of a neutral studio chrome look.
 */
function DistortedSphere() {
  const meshRef = useRef<Mesh>(null);

  useFrame((state) => {
    if (!meshRef.current) return;
    meshRef.current.rotation.x = state.clock.elapsedTime * 0.08;
    meshRef.current.rotation.y = state.clock.elapsedTime * 0.12;
  });

  return (
    <Sphere ref={meshRef} args={[1, 128, 128]}>
      <MeshDistortMaterial
        color="#A855F7"
        attach="material"
        distort={0.45}
        speed={1.6}
        roughness={0.28}
        metalness={0.55}
      />
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
      <Canvas camera={{ position: [0, 0, 3.2], fov: 40 }} dpr={[1, 1.5]} gl={{ alpha: true, antialias: true }}>
        <Suspense fallback={null}>
          <ambientLight intensity={1.1} />
          <hemisphereLight args={["#e9d5ff", "#1a1024", 1.2]} />
          <pointLight position={[3, 2, 4]} intensity={70} color="#D4AF37" />
          <pointLight position={[-3, -2, 2]} intensity={60} color="#E63946" />
          <pointLight position={[0, 3, -2]} intensity={45} color="#A855F7" />
          <pointLight position={[-2, 3, 3]} intensity={35} color="#ffffff" />
          <DistortedSphere />
        </Suspense>
      </Canvas>
    </div>
  );
}
