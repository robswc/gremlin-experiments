import { useEffect } from "react";
import {
  FLOOR_Y,
  applyViewTransformToNDC,
  ndcToPixel,
  projectFloorToNDC,
  projectToNDC,
  projectToNDCClampedToFloor,
  type CameraPan,
  type Vector3,
  type ViewMode,
} from "@/lib/projection";

interface Agent {
  id: string;
  friendly: boolean;
  enemy: boolean;
  position: Vector3;
}

export function useGroundVectorRenderer(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  agents: Agent[],
  viewMode: ViewMode,
  enabled: boolean,
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
        // Keep overlay transparent when disabled.
        ctx.clearRect(0, 0, width, height);

        if (enabled) {
          ctx.lineWidth = Math.max(1, 1.4 * devicePixelRatio);

          for (const agent of agents) {
            const color = agent.friendly
              ? "rgba(0, 255, 255, 0.6)"
              : agent.enemy
                ? "rgba(255, 64, 64, 0.6)"
                : "rgba(255, 255, 255, 0.42)";
            ctx.strokeStyle = color;
            const [nx1, ny1] = projectToNDC(agent.position, viewMode);
            const [nx2, ny2] = projectFloorToNDC(agent.position.x, agent.position.z, viewMode);

            // If point projection collapses to floor in some camera/view combinations,
            // keep a fallback using floor-clamped projection to avoid disappearing lines.
            const [fx1, fy1] = projectToNDCClampedToFloor(agent.position, viewMode);
            const startNx = Number.isFinite(nx1) ? nx1 : fx1;
            const startNy = Number.isFinite(ny1) ? ny1 : fy1;
            const [zx1, zy1] = applyViewTransformToNDC(startNx, startNy, zoom, cameraPan);
            const [zx2, zy2] = applyViewTransformToNDC(nx2, ny2, zoom, cameraPan);
            const [x1, y1] = ndcToPixel(zx1, zy1, width, height);
            const [x2, y2] = ndcToPixel(zx2, zy2, width, height);
            const pixelDistance = Math.hypot(x2 - x1, y2 - y1);
            const worldHeight = Math.max(0, agent.position.y - FLOOR_Y);

            if (pixelDistance < Math.max(1, 1.2 * devicePixelRatio)) {
              const r = Math.max(1.5, 2.4 * devicePixelRatio);
              const stub = Math.max(8 * devicePixelRatio, Math.min(22 * devicePixelRatio, 8 * devicePixelRatio + worldHeight * 2.2));

              ctx.beginPath();
              ctx.moveTo(x2, y2);
              ctx.lineTo(x2, y2 + stub);
              ctx.stroke();

              ctx.beginPath();
              ctx.arc(x2, y2, r, 0, Math.PI * 2);
              ctx.stroke();
            } else {
              ctx.beginPath();
              ctx.moveTo(x1, y1);
              ctx.lineTo(x2, y2);
              ctx.stroke();
            }
          }
        }
      }

      rafId = requestAnimationFrame(frame);
    };

    rafId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafId);
  }, [canvasRef, agents, viewMode, enabled, zoom, cameraPan]);
}
