import { useEffect } from "react";
import {
  applyZoomToNDC,
  ndcToPixel,
  projectToNDC,
  type Vector3,
  type ViewMode,
} from "@/lib/projection";

interface Agent {
  id: string;
  behavior: string;
  followId?: string;
  position: Vector3;
}

export function useTailLinkRenderer(
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
        ctx.clearRect(0, 0, width, height);

        if (enabled) {
          const byId = new Map(agents.map((a) => [a.id, a]));
          ctx.strokeStyle = "rgba(255, 255, 255, 0.66)";
          ctx.lineWidth = Math.max(1, 1.6 * devicePixelRatio);

          for (const a of agents) {
            if (a.behavior !== "tail" || !a.followId) continue;
            const target = byId.get(a.followId);
            if (!target) continue;

            const [axNdcX, axNdcY] = projectToNDC(a.position, viewMode);
            const [txNdcX, txNdcY] = projectToNDC(target.position, viewMode);
            const [zax, zay] = applyZoomToNDC(axNdcX, axNdcY, zoom);
            const [ztx, zty] = applyZoomToNDC(txNdcX, txNdcY, zoom);
            const [ax, ay] = ndcToPixel(zax, zay, width, height);
            const [tx, ty] = ndcToPixel(ztx, zty, width, height);

            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.lineTo(tx, ty);
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
