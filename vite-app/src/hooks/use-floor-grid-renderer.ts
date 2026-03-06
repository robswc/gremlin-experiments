import { useEffect } from "react";
import {
  WORLD_HALF_EXTENT,
  applyZoomToNDC,
  projectFloorToNDC,
  ndcToPixel,
  type ViewMode,
} from "@/lib/projection";

const GRID_HALF_EXTENT = WORLD_HALF_EXTENT * 12;
const MAJOR_INTERVAL = 10;

function drawFloorGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  viewMode: ViewMode,
  zoom: number
) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);

  const min = -GRID_HALF_EXTENT;
  const max = GRID_HALF_EXTENT;

  const drawGridLine = (
    a: [number, number],
    b: [number, number],
    major: boolean
  ) => {
    const [azx, azy] = applyZoomToNDC(a[0], a[1], zoom);
    const [bzx, bzy] = applyZoomToNDC(b[0], b[1], zoom);
    const [ax, ay] = ndcToPixel(azx, azy, width, height);
    const [bx, by] = ndcToPixel(bzx, bzy, width, height);

    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.strokeStyle = major ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.1)";
    ctx.lineWidth = major ? 1.6 : 1;
    ctx.stroke();
  };

  // Grid lines parallel to Z axis (vary Z, fixed X)
  for (let x = min; x <= max; x++) {
    const a = projectFloorToNDC(x, min, viewMode);
    const b = projectFloorToNDC(x, max, viewMode);
    drawGridLine(a, b, x % MAJOR_INTERVAL === 0);
  }

  // Grid lines parallel to X axis (vary X, fixed Z)
  for (let z = min; z <= max; z++) {
    const a = projectFloorToNDC(min, z, viewMode);
    const b = projectFloorToNDC(max, z, viewMode);
    drawGridLine(a, b, z % MAJOR_INTERVAL === 0);
  }
}

export function useFloorGridRenderer(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  viewMode: ViewMode,
  zoom: number
) {
  useEffect(() => {
    let rafId = 0;

    const frame = () => {
      const canvas = canvasRef.current;
      if (!canvas) {
        rafId = requestAnimationFrame(frame);
        return;
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        rafId = requestAnimationFrame(frame);
        return;
      }

      const width = canvas.width;
      const height = canvas.height;
      if (width > 0 && height > 0) {
        drawFloorGrid(ctx, width, height, viewMode, zoom);
      }

      rafId = requestAnimationFrame(frame);
    };

    rafId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafId);
  }, [canvasRef, viewMode, zoom]);
}
