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

interface Agent {
  id: string;
  friendly: boolean;
  enemy: boolean;
  position: Vector3;
  moveGoal?: Vector3;
  movePath?: Vector3[];
  pathIndex?: number;
}

function alphaColor(base: string, alpha: number): string {
  return `rgba(${base}, ${alpha})`;
}

function buildDisplayPath(agent: Agent): { full: Vector3[]; completed: Vector3[]; remaining: Vector3[] } {
  const path = agent.movePath ?? [];
  if (path.length === 0 && !agent.moveGoal) {
    return { full: [], completed: [], remaining: [] };
  }

  const full = path.length > 0 ? path : [agent.position, agent.moveGoal as Vector3];
  const nextIndex = Math.max(0, agent.pathIndex ?? 0);
  const completedHead = full.slice(0, Math.min(nextIndex, full.length));
  const completed = completedHead.length === 0 ? [] : [...completedHead, agent.position];
  const remainingTail = full.slice(Math.min(nextIndex, full.length));
  const remaining = [agent.position, ...remainingTail.filter((point, index) => {
    if (index > 0) {
      return true;
    }
    const dx = point.x - agent.position.x;
    const dy = point.y - agent.position.y;
    const dz = point.z - agent.position.z;
    return Math.hypot(dx, dy, dz) > 0.05;
  })];

  return { full, completed, remaining };
}

function projectWorldPoint(
  point: Vector3,
  viewMode: ViewMode,
  zoom: number,
  cameraPan: CameraPan,
  width: number,
  height: number
): [number, number] {
  const [ndcX, ndcY] = projectToNDC(point, viewMode);
  const [zx, zy] = applyViewTransformToNDC(ndcX, ndcY, zoom, cameraPan);
  return ndcToPixel(zx, zy, width, height);
}

function traceSmoothPath(ctx: CanvasRenderingContext2D, points: Array<[number, number]>) {
  if (points.length === 0) {
    return;
  }

  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);

  if (points.length === 1) {
    return;
  }

  if (points.length === 2) {
    ctx.lineTo(points[1][0], points[1][1]);
    return;
  }

  for (let i = 1; i < points.length - 1; i += 1) {
    const current = points[i];
    const next = points[i + 1];
    const midX = (current[0] + next[0]) / 2;
    const midY = (current[1] + next[1]) / 2;
    ctx.quadraticCurveTo(current[0], current[1], midX, midY);
  }

  const penultimate = points[points.length - 2];
  const last = points[points.length - 1];
  ctx.quadraticCurveTo(penultimate[0], penultimate[1], last[0], last[1]);
}

export function useMoveTargetRenderer(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  agents: Agent[],
  viewMode: ViewMode,
  zoom: number,
  cameraPan: CameraPan
) {
  useEffect(() => {
    let rafId = 0;

    const frame = (timestamp: number) => {
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
        const dashOffset = -(timestamp * 0.02 * dpr);

        for (const agent of agents) {
          if (!agent.moveGoal) continue;

          const { full, completed, remaining } = buildDisplayPath(agent);
          const [gxNdcX, gxNdcY] = projectToNDC(agent.moveGoal, viewMode);
          const [gFloorNdcX, gFloorNdcY] = projectToNDC(
            { x: agent.moveGoal.x, y: FLOOR_Y, z: agent.moveGoal.z },
            viewMode
          );
          const [zgx, zgy] = applyViewTransformToNDC(gxNdcX, gxNdcY, zoom, cameraPan);
          const [zgfx, zgfy] = applyViewTransformToNDC(gFloorNdcX, gFloorNdcY, zoom, cameraPan);
          const [gx, gy] = ndcToPixel(zgx, zgy, width, height);
          const [gfx, gfy] = ndcToPixel(zgfx, zgfy, width, height);

          const baseColor = agent.friendly ? "0, 255, 255" : agent.enemy ? "255, 96, 96" : "255, 255, 255";
          const color = alphaColor(baseColor, 0.92);
          const completedPathColor = alphaColor(baseColor, 0.1);
          const fullPathColor = alphaColor(baseColor, 0.2);
          const groundColor = alphaColor(baseColor, 0.34);
          const pointColor = alphaColor(baseColor, 0.44);
          const completedPointColor = alphaColor(baseColor, 0.18);
          const activePointColor = alphaColor(baseColor, 0.96);

          const fullPixels = full.map((point) => projectWorldPoint(point, viewMode, zoom, cameraPan, width, height));
          const completedPixels = completed.map((point) => projectWorldPoint(point, viewMode, zoom, cameraPan, width, height));
          const remainingPixels = remaining.map((point) => projectWorldPoint(point, viewMode, zoom, cameraPan, width, height));

          if (completedPixels.length >= 2) {
            ctx.save();
            ctx.strokeStyle = completedPathColor;
            ctx.lineWidth = Math.max(1, 1 * dpr);
            ctx.setLineDash([4 * dpr, 8 * dpr]);
            ctx.lineDashOffset = dashOffset * 0.25;
            traceSmoothPath(ctx, completedPixels);
            ctx.stroke();
            ctx.restore();
          }

          if (fullPixels.length >= 2) {
            ctx.save();
            ctx.strokeStyle = fullPathColor;
            ctx.lineWidth = Math.max(1, 1.2 * dpr);
            ctx.setLineDash([8 * dpr, 6 * dpr]);
            ctx.lineDashOffset = dashOffset * 0.5;
            traceSmoothPath(ctx, fullPixels);
            ctx.stroke();
            ctx.restore();
          }

          ctx.save();
          ctx.strokeStyle = color;
          ctx.lineWidth = Math.max(1.2, 1.8 * dpr);
          ctx.setLineDash([8 * dpr, 6 * dpr]);
          ctx.lineDashOffset = dashOffset;
          traceSmoothPath(ctx, remainingPixels);
          if (remainingPixels.length >= 2) {
            ctx.stroke();
          }
          ctx.restore();

          for (let index = 0; index < fullPixels.length; index += 1) {
            const [px, py] = fullPixels[index];
            const activeIndex = Math.max(0, agent.pathIndex ?? 0);
            const isActive = index >= activeIndex && index === Math.min(activeIndex, fullPixels.length - 1);
            const isCompleted = index < activeIndex;
            ctx.beginPath();
            ctx.strokeStyle = isActive ? activePointColor : isCompleted ? completedPointColor : pointColor;
            ctx.lineWidth = Math.max(1, isActive ? 1.4 * dpr : isCompleted ? 1 * dpr : 1.1 * dpr);
            ctx.arc(px, py, isActive ? 3.8 * dpr : isCompleted ? 1.8 * dpr : 2.3 * dpr, 0, Math.PI * 2);
            ctx.stroke();
          }

          // Faint ground vector from move target down to floor.
          ctx.save();
          ctx.strokeStyle = groundColor;
          ctx.lineWidth = Math.max(1, 1.2 * dpr);
          ctx.setLineDash([4 * dpr, 5 * dpr]);
          ctx.beginPath();
          ctx.moveTo(gx, gy);
          ctx.lineTo(gfx, gfy);
          ctx.stroke();
          ctx.restore();

          // Goal marker ring.
          ctx.beginPath();
          ctx.strokeStyle = color;
          ctx.lineWidth = Math.max(1, 1.2 * dpr);
          ctx.arc(gx, gy, 5 * dpr, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      rafId = requestAnimationFrame(frame);
    };

    rafId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafId);
  }, [canvasRef, agents, viewMode, zoom, cameraPan]);
}
