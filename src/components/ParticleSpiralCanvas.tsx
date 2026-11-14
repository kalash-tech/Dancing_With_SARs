import { useEffect, useRef } from 'react';

interface ParticleSpiralCanvasProps {
  className?: string;
}

interface Particle {
  angle: number;
  radius: number;
  speed: number;
  size: number;
  paletteIndex: number;
  alpha: number;
  flickerPhase: number;
  flickerSpeed: number;
}

interface PaletteColor {
  r: number;
  g: number;
  b: number;
}

const DARK_PALETTE: PaletteColor[] = [
  { r: 56, g: 189, b: 248 }, // cyan
  { r: 0, g: 102, b: 255 }, // accent blue
  { r: 167, g: 139, b: 250 }, // violet
  { r: 255, g: 255, b: 255 }, // white sparks
];

const LIGHT_PALETTE: PaletteColor[] = [
  { r: 0, g: 102, b: 255 },
  { r: 79, g: 70, b: 229 },
  { r: 8, g: 145, b: 178 },
  { r: 30, g: 41, b: 59 },
];

const PARTICLE_COUNT = 1100;
const SPIRAL_TURNS = 4.4;
const ARM_SPREAD = 0.055;
const TWO_PI = Math.PI * 2;

export function ParticleSpiralCanvas({ className }: ParticleSpiralCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;

    let width = 0;
    let height = 0;
    let dpr = 1;
    let running = true;
    let rafId = 0;
    let lastDrawAt = 0;
    let animationTime = Math.random() * 1000;

    const particles: Particle[] = Array.from({ length: PARTICLE_COUNT }, () => {
      const radius = Math.pow(Math.random(), 0.55);
      const arm = Math.random() < 0.5 ? 0 : Math.PI;
      const spread =
        (Math.random() + Math.random() + Math.random() - 1.5) * ARM_SPREAD;
      return {
        angle: arm + radius * SPIRAL_TURNS * TWO_PI + spread,
        radius,
        speed: (0.06 + Math.random() * 0.12) * (Math.random() < 0.5 ? 1 : -1),
        size: 0.4 + Math.random() * 1.5,
        paletteIndex: Math.floor(Math.random() * 4),
        alpha: 0.25 + Math.random() * 0.6,
        flickerPhase: Math.random() * TWO_PI,
        flickerSpeed: 0.5 + Math.random() * 2,
      };
    });

    let palette = document.documentElement.classList.contains('dark')
      ? DARK_PALETTE
      : LIGHT_PALETTE;
    let isDark = document.documentElement.classList.contains('dark');

    const onThemeClassChange = () => {
      isDark = document.documentElement.classList.contains('dark');
      palette = isDark ? DARK_PALETTE : LIGHT_PALETTE;
    };
    const themeObserver = new MutationObserver(onThemeClassChange);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      width = Math.max(1, Math.round(rect.width * dpr));
      height = Math.max(1, Math.round(rect.height * dpr));
      canvas.width = width;
      canvas.height = height;
    };
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);

    const draw = () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.globalCompositeOperation = isDark ? 'lighter' : 'source-over';

      const cx = width / 2;
      const cy = height / 2;
      const maxRadius =
        (Math.min(width, height) / 2) * (width > 640 ? 1.0 : 1.12);

      // Central core glow
      const coreGradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxRadius * 0.3);
      const coreColor = palette[0];
      coreGradient.addColorStop(
        0,
        `rgba(${coreColor.r}, ${coreColor.g}, ${coreColor.b}, ${isDark ? 0.2 : 0.1})`
      );
      coreGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = coreGradient;
      ctx.fillRect(cx - maxRadius, cy - maxRadius, maxRadius * 2, maxRadius * 2);

      const rotation = reducedMotion ? 0 : animationTime * 0.00018;

      for (const p of particles) {
        const angle = p.angle + rotation * p.speed;
        const r = p.radius * maxRadius;
        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r;

        if (x < -20 || x > width + 20 || y < -20 || y > height + 20) continue;

        const twinkle = reducedMotion
          ? 1
          : 0.7 + 0.3 * Math.sin(animationTime * 0.002 * p.flickerSpeed + p.flickerPhase);
        const fadeNearEdge = Math.max(0, 1 - p.radius * 0.55);
        const color = palette[p.paletteIndex];
        const alpha =
          p.alpha * twinkle * fadeNearEdge * (isDark ? 1 : 0.55);

        const size = p.size * dpr * (0.8 + p.radius * 0.9);
        ctx.beginPath();
        ctx.arc(x, y, size, 0, TWO_PI);
        ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
        ctx.fill();

        // Halo for the brightest particles
        if (p.size > 1.2) {
          ctx.beginPath();
          ctx.arc(x, y, size * 2.6, 0, TWO_PI);
          ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha * 0.12})`;
          ctx.fill();
        }
      }

      ctx.globalCompositeOperation = 'source-over';
    };

    const frame = (now: number) => {
      if (!running) return;
      rafId = window.requestAnimationFrame(frame);

      const dt = Math.min(64, now - (lastDrawAt || now));
      animationTime += dt;

      if (reducedMotion) {
        draw();
        return;
      }
      if (now - lastDrawAt < 33) return;
      lastDrawAt = now;
      draw();
    };

    draw();
    if (!reducedMotion) {
      rafId = window.requestAnimationFrame(frame);
    }

    const visibilityObserver = new IntersectionObserver(
      ([entry]) => {
        running = entry.isIntersecting;
        if (running && !reducedMotion) {
          lastDrawAt = 0;
          rafId = window.requestAnimationFrame(frame);
        }
      },
      { threshold: 0 }
    );
    visibilityObserver.observe(canvas);

    const onVisibilityChange = () => {
      running = !document.hidden;
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.cancelAnimationFrame(rafId);
      themeObserver.disconnect();
      resizeObserver.disconnect();
      visibilityObserver.disconnect();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 h-full w-full ${className ?? ''}`}
    />
  );
}
