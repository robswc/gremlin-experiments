import { useEffect } from "react";
import {
  applyZoomToNDC,
  ndcToPixel,
  projectFloorToNDC,
  projectToNDC,
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
            const [zx1, zy1] = applyZoomToNDC(nx1, ny1, zoom);
            const [zx2, zy2] = applyZoomToNDC(nx2, ny2, zoom);
            const [x1, y1] = ndcToPixel(zx1, zy1, width, height);
            const [x2, y2] = ndcToPixel(zx2, zy2, width, height);

            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
          }
        }
      }

      rafId = requestAnimationFrame(frame);
    };

    rafId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafId);
  }, [canvasRef, agents, viewMode, enabled, zoom]);
}
