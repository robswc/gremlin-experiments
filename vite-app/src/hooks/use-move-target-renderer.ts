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

          const [axNdcX, axNdcY] = projectToNDC(agent.position, viewMode);
          const [gxNdcX, gxNdcY] = projectToNDC(agent.moveGoal, viewMode);
          const [gFloorNdcX, gFloorNdcY] = projectToNDC(
            { x: agent.moveGoal.x, y: FLOOR_Y, z: agent.moveGoal.z },
            viewMode
          );
          const [zax, zay] = applyViewTransformToNDC(axNdcX, axNdcY, zoom, cameraPan);
          const [zgx, zgy] = applyViewTransformToNDC(gxNdcX, gxNdcY, zoom, cameraPan);
          const [zgfx, zgfy] = applyViewTransformToNDC(gFloorNdcX, gFloorNdcY, zoom, cameraPan);
          const [ax, ay] = ndcToPixel(zax, zay, width, height);
          const [gx, gy] = ndcToPixel(zgx, zgy, width, height);
          const [gfx, gfy] = ndcToPixel(zgfx, zgfy, width, height);

          const color = agent.friendly
            ? "rgba(0, 255, 255, 0.92)"
            : agent.enemy
              ? "rgba(255, 96, 96, 0.92)"
              : "rgba(255, 255, 255, 0.86)";
          const groundColor = agent.friendly
            ? "rgba(0, 255, 255, 0.34)"
            : agent.enemy
              ? "rgba(255, 96, 96, 0.34)"
              : "rgba(255, 255, 255, 0.3)";

          ctx.save();
          ctx.strokeStyle = color;
          ctx.lineWidth = Math.max(1.2, 1.8 * dpr);
          ctx.setLineDash([8 * dpr, 6 * dpr]);
          ctx.lineDashOffset = dashOffset;
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(gx, gy);
          ctx.stroke();
          ctx.restore();

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
