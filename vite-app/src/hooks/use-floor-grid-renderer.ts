import { useEffect } from "react";
import {
  WORLD_HALF_EXTENT,
  applyViewTransformToNDC,
  projectFloorToNDC,
  ndcToPixel,
  type CameraPan,
  type ViewMode,
} from "@/lib/projection";

const GRID_HALF_EXTENT = WORLD_HALF_EXTENT * 2;
const MAJOR_INTERVAL = 10;

const BASE_GRID_HALF_EXTENT = GRID_HALF_EXTENT * 5;
const GRID_PADDING_UNITS = 24;
const MAX_LINES_PER_AXIS = 900;

function unprojectFloorFromNDC(
  nx: number,
  ny: number,
  viewMode: ViewMode
): [number, number] | null {
  switch (viewMode) {
    case "top":
      return [nx * WORLD_HALF_EXTENT, ny * WORLD_HALF_EXTENT];
    case "iso": {
      const scale = WORLD_HALF_EXTENT * 1.4;
      const sum = (ny * scale) / 0.35;
      const diff = nx * scale;
      const x = (sum + diff) * 0.5;
      const z = (sum - diff) * 0.5;
      return [x, z];
    }
    // Front/side floor projection collapses one floor axis, so a complete inverse is undefined.
    default:
      return null;
  }
}

function getDynamicGridBounds(
  viewMode: ViewMode,
  zoom: number,
  cameraPan: CameraPan
): { minX: number; maxX: number; minZ: number; maxZ: number; step: number } {
  const safeZoom = Math.max(0.0001, zoom);
  const minNX = (-1 - cameraPan.x) / safeZoom;
  const maxNX = (1 - cameraPan.x) / safeZoom;
  const minNY = (-1 - cameraPan.y) / safeZoom;
  const maxNY = (1 - cameraPan.y) / safeZoom;

  const corners: Array<[number, number]> = [
    [minNX, minNY],
    [minNX, maxNY],
    [maxNX, minNY],
    [maxNX, maxNY],
  ];

  const worldPoints = corners
    .map(([nx, ny]) => unprojectFloorFromNDC(nx, ny, viewMode))
    .filter((point): point is [number, number] => point !== null);

  let minX = -BASE_GRID_HALF_EXTENT;
  let maxX = BASE_GRID_HALF_EXTENT;
  let minZ = -BASE_GRID_HALF_EXTENT;
  let maxZ = BASE_GRID_HALF_EXTENT;

  if (worldPoints.length > 0) {
    const xs = worldPoints.map(([x]) => x);
    const zs = worldPoints.map(([, z]) => z);
    minX = Math.min(minX, Math.floor(Math.min(...xs) - GRID_PADDING_UNITS));
    maxX = Math.max(maxX, Math.ceil(Math.max(...xs) + GRID_PADDING_UNITS));
    minZ = Math.min(minZ, Math.floor(Math.min(...zs) - GRID_PADDING_UNITS));
    maxZ = Math.max(maxZ, Math.ceil(Math.max(...zs) + GRID_PADDING_UNITS));
  }

  const xRange = maxX - minX;
  const zRange = maxZ - minZ;
  const step = Math.max(1, Math.ceil(Math.max(xRange, zRange) / MAX_LINES_PER_AXIS));

  return { minX, maxX, minZ, maxZ, step };
}

function drawFloorGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  viewMode: ViewMode,
  zoom: number,
  cameraPan: CameraPan
) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);

  const { minX, maxX, minZ, maxZ, step } = getDynamicGridBounds(
    viewMode,
    zoom,
    cameraPan
  );

  const drawGridLine = (
    a: [number, number],
    b: [number, number],
    major: boolean
  ) => {
    const [azx, azy] = applyViewTransformToNDC(a[0], a[1], zoom, cameraPan);
    const [bzx, bzy] = applyViewTransformToNDC(b[0], b[1], zoom, cameraPan);
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
  for (let x = minX; x <= maxX; x += step) {
    const a = projectFloorToNDC(x, minZ, viewMode);
    const b = projectFloorToNDC(x, maxZ, viewMode);
    drawGridLine(a, b, x % MAJOR_INTERVAL === 0);
  }

  // Grid lines parallel to X axis (vary X, fixed Z)
  for (let z = minZ; z <= maxZ; z += step) {
    const a = projectFloorToNDC(minX, z, viewMode);
    const b = projectFloorToNDC(maxX, z, viewMode);
    drawGridLine(a, b, z % MAJOR_INTERVAL === 0);
  }
}

export function useFloorGridRenderer(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  viewMode: ViewMode,
  zoom: number,
  cameraPan: CameraPan
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
        drawFloorGrid(ctx, width, height, viewMode, zoom, cameraPan);
      }

      rafId = requestAnimationFrame(frame);
    };

    rafId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafId);
  }, [canvasRef, viewMode, zoom, cameraPan]);
}
