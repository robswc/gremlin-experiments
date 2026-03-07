import { useEffect } from "react";
import {
  FLOOR_Y,
  applyViewTransformToNDC,
  ndcToPixel,
  projectToNDC,
  type CameraPan,
  type Vector3,
  type ViewMode,
} from "@/lib/projection";

interface PhysicalObject {
  id: string;
  kind: string;
  position: Vector3;
  size: number;
  height: number;
  radius?: number;
}

function squareCorners(center: Vector3, size: number, y: number): Vector3[] {
  const half = size / 2;
  return [
    { x: center.x - half, y, z: center.z - half },
    { x: center.x + half, y, z: center.z - half },
    { x: center.x + half, y, z: center.z + half },
    { x: center.x - half, y, z: center.z + half },
  ];
}

function toPixel(point: Vector3, viewMode: ViewMode, zoom: number, cameraPan: CameraPan, width: number, height: number): [number, number] {
  const [nx, ny] = projectToNDC(point, viewMode);
  const [zx, zy] = applyViewTransformToNDC(nx, ny, zoom, cameraPan);
  return ndcToPixel(zx, zy, width, height);
}

function convexHull(points: [number, number][]): [number, number][] {
  if (points.length <= 3) return points;
  const sorted = [...points].sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]));
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

  const lower: [number, number][] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper: [number, number][] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function drawClippedRing(
  ctx: CanvasRenderingContext2D,
  points: Vector3[],
  viewMode: ViewMode,
  zoom: number,
  cameraPan: CameraPan,
  width: number,
  height: number
) {
  if (points.length < 2) return;
  const wrapped = [...points, points[0]];
  let drawing = false;

  for (let i = 0; i < wrapped.length; i++) {
    const p = wrapped[i];
    if (p.y < FLOOR_Y) {
      drawing = false;
      continue;
    }
    const [px, py] = toPixel(p, viewMode, zoom, cameraPan, width, height);
    if (!drawing) {
      ctx.moveTo(px, py);
      drawing = true;
    } else {
      ctx.lineTo(px, py);
    }
  }
}

export function usePhysicalObjectRenderer(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  objects: PhysicalObject[],
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
        for (const obj of objects) {
          if (obj.kind === "sphere_no_go") {
            const radius = obj.radius ?? 0;
            if (radius <= 0) continue;

            const center = obj.position;
            const yMin = Math.max(FLOOR_Y, center.y - radius);
            const yMax = center.y + radius;
            if (yMax <= FLOOR_Y) continue;

            // Sample visible sphere cap points (y >= floor), then fill projected hull.
            const surfacePoints: [number, number][] = [];
            const latSteps = 18;
            const lonSteps = 48;
            for (let i = 0; i <= latSteps; i++) {
              const y = yMin + ((yMax - yMin) * i) / latSteps;
              const dy = y - center.y;
              const ringR = Math.sqrt(Math.max(0, radius * radius - dy * dy));
              for (let j = 0; j < lonSteps; j++) {
                const t = (j / lonSteps) * Math.PI * 2;
                const point: Vector3 = {
                  x: center.x + Math.cos(t) * ringR,
                  y,
                  z: center.z + Math.sin(t) * ringR,
                };
                surfacePoints.push(toPixel(point, viewMode, zoom, cameraPan, width, height));
              }
            }

            const hull = convexHull(surfacePoints);
            if (hull.length >= 3) {
              const topPoint: Vector3 = { x: center.x, y: center.y + radius, z: center.z };
              const bottomPoint: Vector3 = { x: center.x, y: yMin, z: center.z };
              const topPx = toPixel(topPoint, viewMode, zoom, cameraPan, width, height);
              const bottomPx = toPixel(bottomPoint, viewMode, zoom, cameraPan, width, height);

              ctx.beginPath();
              ctx.moveTo(hull[0][0], hull[0][1]);
              for (let i = 1; i < hull.length; i++) {
                ctx.lineTo(hull[i][0], hull[i][1]);
              }
              ctx.closePath();

              // Use a strict vertical shading cue: lightest at top, darkest at bottom.
              const gradient = ctx.createLinearGradient(topPx[0], topPx[1], bottomPx[0], bottomPx[1]);
              gradient.addColorStop(0, "rgba(255, 220, 220, 0.36)");
              gradient.addColorStop(0.3, "rgba(255, 145, 145, 0.28)");
              gradient.addColorStop(0.7, "rgba(205, 70, 70, 0.23)");
              gradient.addColorStop(1, "rgba(115, 25, 25, 0.30)");
              ctx.fillStyle = gradient;
              ctx.fill();

              ctx.strokeStyle = "rgba(255, 120, 120, 0.74)";
              ctx.lineWidth = Math.max(1, 1.2 * dpr);
              ctx.stroke();
            }

            const segments = 120;
            ctx.save();
            ctx.setLineDash([Math.max(4, 8 * dpr), Math.max(3, 6 * dpr)]);
            ctx.strokeStyle = "rgba(255, 175, 175, 0.95)";
            ctx.lineWidth = Math.max(1, 1.1 * dpr);

            const peak = { x: center.x, y: center.y + radius, z: center.z };
            const floorPoint = { x: center.x, y: FLOOR_Y, z: center.z };
            if (peak.y > FLOOR_Y) {
              const [x1, y1] = toPixel(peak, viewMode, zoom, cameraPan, width, height);
              const [x2, y2] = toPixel(floorPoint, viewMode, zoom, cameraPan, width, height);
              ctx.beginPath();
              ctx.moveTo(x1, y1);
              ctx.lineTo(x2, y2);
              ctx.stroke();
            }

            // X-axis perimeter ring: circle in YZ plane (x fixed at center.x).
            ctx.beginPath();
            const xAxisRing: Vector3[] = [];
            for (let i = 0; i < segments; i++) {
              const t = (i / segments) * Math.PI * 2;
              xAxisRing.push({
                x: center.x,
                y: center.y + Math.cos(t) * radius,
                z: center.z + Math.sin(t) * radius,
              });
            }
            drawClippedRing(ctx, xAxisRing, viewMode, zoom, cameraPan, width, height);

            // Z-axis perimeter ring: circle in XY plane (z fixed at center.z).
            const zAxisRing: Vector3[] = [];
            for (let i = 0; i < segments; i++) {
              const t = (i / segments) * Math.PI * 2;
              zAxisRing.push({
                x: center.x + Math.cos(t) * radius,
                y: center.y + Math.sin(t) * radius,
                z: center.z,
              });
            }
            drawClippedRing(ctx, zAxisRing, viewMode, zoom, cameraPan, width, height);

            // Floor intersection ring: circle where the sphere crosses y=0.
            const floorDy = FLOOR_Y - center.y;
            const floorRingRadius = Math.sqrt(Math.max(0, radius * radius - floorDy * floorDy));
            if (floorRingRadius > 0.001) {
              const floorRing: Vector3[] = [];
              for (let i = 0; i < segments; i++) {
                const t = (i / segments) * Math.PI * 2;
                floorRing.push({
                  x: center.x + Math.cos(t) * floorRingRadius,
                  y: FLOOR_Y,
                  z: center.z + Math.sin(t) * floorRingRadius,
                });
              }
              drawClippedRing(ctx, floorRing, viewMode, zoom, cameraPan, width, height);
            }

            ctx.stroke();
            ctx.restore();
            continue;
          }

          if (obj.kind !== "square" || obj.size <= 0 || obj.height <= 0) continue;

          const halfH = obj.height / 2;
          const bottomCorners = squareCorners(obj.position, obj.size, obj.position.y - halfH);
          const topCorners = squareCorners(obj.position, obj.size, obj.position.y + halfH);

          const bottomPoints = bottomCorners.map((corner) => {
            const [nx, ny] = projectToNDC(corner, viewMode);
            const [zx, zy] = applyViewTransformToNDC(nx, ny, zoom, cameraPan);
            return ndcToPixel(zx, zy, width, height);
          });

          const topPoints = topCorners.map((corner) => {
            const [nx, ny] = projectToNDC(corner, viewMode);
            const [zx, zy] = applyViewTransformToNDC(nx, ny, zoom, cameraPan);
            return ndcToPixel(zx, zy, width, height);
          });

          const drawLoop = (points: [number, number][]) => {
            ctx.beginPath();
            ctx.moveTo(points[0][0], points[0][1]);
            for (let i = 1; i < points.length; i++) {
              ctx.lineTo(points[i][0], points[i][1]);
            }
            ctx.closePath();
          };

          // Fill projected top face for quick visibility.
          drawLoop(topPoints);
          ctx.fillStyle = "rgba(255, 180, 80, 0.18)";
          ctx.fill();

          ctx.strokeStyle = "rgba(255, 200, 120, 0.9)";
          ctx.lineWidth = Math.max(1, 1.4 * dpr);

          drawLoop(bottomPoints);
          ctx.stroke();

          drawLoop(topPoints);
          ctx.stroke();

          // Vertical edges.
          for (let i = 0; i < 4; i++) {
            ctx.beginPath();
            ctx.moveTo(bottomPoints[i][0], bottomPoints[i][1]);
            ctx.lineTo(topPoints[i][0], topPoints[i][1]);
            ctx.stroke();
          }
        }
      }

      rafId = requestAnimationFrame(frame);
    };

    rafId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafId);
  }, [canvasRef, objects, viewMode, zoom, cameraPan]);
}
