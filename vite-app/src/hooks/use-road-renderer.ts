import { useEffect } from "react";
import {
  applyViewTransformToNDC,
  ndcToPixel,
  projectToNDC,
  type CameraPan,
  type Vector3,
  type ViewMode,
} from "@/lib/projection";

interface Road {
  id: string;
  name: string;
  width: number;
  points: Vector3[];
}

function toPixel(
  point: Vector3,
  viewMode: ViewMode,
  zoom: number,
  cameraPan: CameraPan,
  width: number,
  height: number
): [number, number] {
  const [nx, ny] = projectToNDC(point, viewMode);
  const [zx, zy] = applyViewTransformToNDC(nx, ny, zoom, cameraPan);
  return ndcToPixel(zx, zy, width, height);
}

function worldRoadHalfWidthToPixels(
  point: Vector3,
  nextPoint: Vector3,
  worldWidth: number,
  viewMode: ViewMode,
  zoom: number,
  cameraPan: CameraPan,
  width: number,
  height: number
): number {
  const dx = nextPoint.x - point.x;
  const dz = nextPoint.z - point.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6 || worldWidth <= 0) {
    return 1;
  }

  const half = worldWidth / 2;
  const nx = -dz / len;
  const nz = dx / len;

  const offsetPoint: Vector3 = {
    x: point.x + nx * half,
    y: point.y,
    z: point.z + nz * half,
  };

  const [px, py] = toPixel(point, viewMode, zoom, cameraPan, width, height);
  const [ox, oy] = toPixel(offsetPoint, viewMode, zoom, cameraPan, width, height);
  return Math.max(1, Math.hypot(ox - px, oy - py));
}

function pointAlongRoad(points: Vector3[], t: number): Vector3 {
  if (points.length === 0) {
    return { x: 0, y: 0, z: 0 };
  }
  if (points.length === 1) {
    return points[0];
  }

  const target = Math.max(0, Math.min(1, t));
  let totalLength = 0;
  const lengths: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    const dz = points[i].z - points[i - 1].z;
    const segLen = Math.hypot(dx, dy, dz);
    lengths.push(segLen);
    totalLength += segLen;
  }

  if (totalLength < 1e-6) {
    return points[0];
  }

  const distance = target * totalLength;
  let walked = 0;
  for (let i = 0; i < lengths.length; i++) {
    const segLen = lengths[i];
    if (walked+segLen >= distance) {
      const localT = (distance - walked) / segLen;
      const a = points[i];
      const b = points[i + 1];
      return {
        x: a.x + (b.x - a.x) * localT,
        y: a.y + (b.y - a.y) * localT,
        z: a.z + (b.z - a.z) * localT,
      };
    }
    walked += segLen;
  }

  return points[points.length - 1];
}

export function useRoadRenderer(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  roads: Road[],
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
        ctx.clearRect(0, 0, width, height);

        const dpr = devicePixelRatio || 1;
        for (const road of roads) {
          if (!road.points || road.points.length < 2 || road.width <= 0) {
            continue;
          }

          const first = road.points[0];
          const second = road.points[1];
          const last = road.points[road.points.length - 1];
          const preLast = road.points[Math.max(0, road.points.length - 2)];

          const startThickness = worldRoadHalfWidthToPixels(
            first,
            second,
            road.width,
            viewMode,
            zoom,
            cameraPan,
            width,
            height
          );
          const endThickness = worldRoadHalfWidthToPixels(
            preLast,
            last,
            road.width,
            viewMode,
            zoom,
            cameraPan,
            width,
            height
          );

          ctx.beginPath();
          for (let i = 0; i < road.points.length; i++) {
            const [px, py] = toPixel(road.points[i], viewMode, zoom, cameraPan, width, height);
            if (i === 0) {
              ctx.moveTo(px, py);
            } else {
              ctx.lineTo(px, py);
            }
          }

          const strokeWidth = Math.max(2 * dpr, ((startThickness + endThickness) / 2) * 2);
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          ctx.strokeStyle = "rgba(196, 200, 206, 0.45)";
          ctx.lineWidth = strokeWidth;
          ctx.stroke();

          ctx.strokeStyle = "rgba(228, 232, 238, 0.4)";
          ctx.lineWidth = Math.max(1 * dpr, strokeWidth * 0.18);
          ctx.stroke();

          const labelPoint = pointAlongRoad(road.points, 0.22);
          let [lx, ly] = toPixel(labelPoint, viewMode, zoom, cameraPan, width, height);
          const pad = Math.max(18, 20 * dpr);
          lx = Math.max(pad, Math.min(width - pad, lx));
          ly = Math.max(pad, Math.min(height - pad, ly));

          ctx.fillStyle = "rgba(244, 246, 250, 0.95)";
          ctx.font = `${Math.max(11, Math.round(12 * dpr))}px ui-monospace, SFMono-Regular, Menlo, monospace`;
          ctx.textAlign = "center";
          ctx.textBaseline = "bottom";
          ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
          ctx.shadowBlur = Math.max(1, 2 * dpr);
          ctx.fillText(road.name, lx, ly - Math.max(8, strokeWidth * 0.6));
          ctx.shadowBlur = 0;
        }
      }

      rafId = requestAnimationFrame(frame);
    };

    rafId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafId);
  }, [canvasRef, roads, viewMode, zoom, cameraPan]);
}
