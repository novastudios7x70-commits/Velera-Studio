"use client";

/**
 * Adapted from KokonutUI's "Beams Background" (kokonut-labs/kokonutui,
 * components/kokonutui/beams-background.tsx, MIT licensed) — same canvas
 * beam-field technique, but hued to Velora's teal/amber brand pair instead
 * of the original's blue/cyan, and contained to fill its parent (absolute
 * inset-0) rather than taking over the full viewport with its own heading,
 * since here it sits behind the real hero content.
 */
import { useEffect, useRef } from "react";

interface Beam {
  x: number;
  y: number;
  width: number;
  length: number;
  angle: number;
  speed: number;
  opacity: number;
  hue: number;
  pulse: number;
  pulseSpeed: number;
}

const MAGENTA_HUE = 330; // matches --violet (#D6127A)
const LIME_HUE = 85; // matches --coral (#65A30D)

function randomHue() {
  return (Math.random() < 0.5 ? MAGENTA_HUE : LIME_HUE) + (Math.random() * 10 - 5);
}

function createBeam(width: number, height: number): Beam {
  return {
    x: Math.random() * width * 1.5 - width * 0.25,
    y: Math.random() * height * 1.5 - height * 0.25,
    width: 50 + Math.random() * 90,
    length: height * 2.5,
    angle: -35 + Math.random() * 10,
    speed: 0.5 + Math.random() * 0.9,
    opacity: 0.38 + Math.random() * 0.26,
    hue: randomHue(),
    pulse: Math.random() * Math.PI * 2,
    pulseSpeed: 0.02 + Math.random() * 0.03,
  };
}

export function AmbientBeams({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const beamsRef = useRef<Beam[]>([]);
  const frameRef = useRef<number>(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !parent || !ctx) return;

    const updateSize = () => {
      const dpr = window.devicePixelRatio || 1;
      const { width, height } = parent.getBoundingClientRect();
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.scale(dpr, dpr);
      beamsRef.current = Array.from({ length: 22 }, () => createBeam(canvas.width, canvas.height));
    };
    updateSize();

    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(parent);

    function resetBeam(beam: Beam) {
      if (!canvas) return;
      beam.y = canvas.height + 100;
      beam.x = Math.random() * canvas.width;
      beam.width = 90 + Math.random() * 110;
      beam.speed = 0.4 + Math.random() * 0.4;
      beam.hue = randomHue();
      beam.opacity = 0.4 + Math.random() * 0.26;
    }

    function drawBeam(beam: Beam) {
      if (!ctx) return;
      ctx.save();
      ctx.translate(beam.x, beam.y);
      ctx.rotate((beam.angle * Math.PI) / 180);

      const pulsingOpacity = beam.opacity * (0.8 + Math.sin(beam.pulse) * 0.2);
      const gradient = ctx.createLinearGradient(0, 0, 0, beam.length);
      gradient.addColorStop(0, `hsla(${beam.hue}, 95%, 45%, 0)`);
      gradient.addColorStop(0.15, `hsla(${beam.hue}, 95%, 45%, ${pulsingOpacity * 0.8})`);
      gradient.addColorStop(0.45, `hsla(${beam.hue}, 95%, 45%, ${pulsingOpacity})`);
      gradient.addColorStop(0.7, `hsla(${beam.hue}, 95%, 45%, ${pulsingOpacity * 0.8})`);
      gradient.addColorStop(1, `hsla(${beam.hue}, 95%, 45%, 0)`);

      ctx.fillStyle = gradient;
      ctx.fillRect(-beam.width / 2, 0, beam.width, beam.length);
      ctx.restore();
    }

    function animate() {
      if (!ctx || !canvas) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.filter = "blur(14px)";
      for (const beam of beamsRef.current) {
        beam.y -= beam.speed;
        beam.pulse += beam.pulseSpeed;
        if (beam.y + beam.length < -100) resetBeam(beam);
        drawBeam(beam);
      }
      frameRef.current = requestAnimationFrame(animate);
    }
    animate();

    return () => {
      resizeObserver.disconnect();
      cancelAnimationFrame(frameRef.current);
    };
  }, []);

  return <canvas ref={canvasRef} className={className} style={{ position: "absolute", inset: 0 }} />;
}
