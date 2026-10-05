import { useEffect, useRef } from "preact/hooks";
import { getBorderRadius } from "../lib/hit-test";
import { hovered, highlightThreadId, picking, resolved, selection } from "../store";

const LERP = 0.95;
const FRAME_MS = 1000 / 60;
const ACCENT = (a: number) => `rgba(210, 57, 192, ${a})`;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
}

const lerp = (from: Box, to: Box, f: number): Box => ({
  x: from.x + (to.x - from.x) * f,
  y: from.y + (to.y - from.y) * f,
  w: from.w + (to.w - from.w) * f,
  h: from.h + (to.h - from.h) * f,
  r: from.r + (to.r - from.r) * f,
});

const boxOf = (el: Element): Box => {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height, r: getBorderRadius(el, r.width, r.height) };
};

/**
 * One full-viewport canvas for all element highlights (react-grab draws on a
 * canvas rather than moving DOM boxes): the hover/selection box glides toward
 * its target with a frame-rate-normalised lerp.
 */
export const Overlay = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let current: Box | null = null;
    let last = performance.now();
    let frame = 0;

    const resize = () => {
      const dpr = Math.max(window.devicePixelRatio || 1, 2);
      const w = document.documentElement.clientWidth;
      const h = document.documentElement.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const drawBox = (b: Box, stroke: number, fill: number, dashed = false) => {
      ctx.beginPath();
      ctx.roundRect(b.x + 0.5, b.y + 0.5, Math.max(0, b.w - 1), Math.max(0, b.h - 1), b.r);
      ctx.setLineDash(dashed ? [4, 3] : []);
      ctx.lineWidth = 1;
      ctx.strokeStyle = ACCENT(stroke);
      ctx.stroke();
      ctx.fillStyle = ACCENT(fill);
      ctx.fill();
    };

    const loop = (now: number) => {
      const dt = Math.max(1, now - last);
      last = now;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const sel = selection.value;
      const target = sel?.el ?? (picking.value ? hovered.value : null);
      if (target && target.isConnected) {
        const to = boxOf(target);
        current = current ? lerp(current, to, 1 - (1 - LERP) ** (dt / FRAME_MS)) : to;
        const done = sel?.phase === "done";
        drawBox(current, sel ? 0.8 : 0.5, done ? 0.16 : 0.08);
      } else {
        current = null;
      }

      const hlId = highlightThreadId.value;
      const hlEl = hlId ? resolved.value.get(hlId) : null;
      if (hlEl && hlEl !== target && hlEl.isConnected) drawBox(boxOf(hlEl), 0.6, 0.05, true);

      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={canvasRef} class="pointer-events-none fixed top-0 left-0 z-30" aria-hidden="true" />;
};
