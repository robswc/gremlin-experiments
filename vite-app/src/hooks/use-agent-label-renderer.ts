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
  position: Vector3;
}

export function useAgentLabelRenderer(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  agents: Agent[],
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
        ctx.clearRect(0, 0, width, height);

        const dpr = devicePixelRatio || 1;
        const margin = 12 * dpr;
        const rowHeight = 20 * dpr;
        const fontSize = 12 * dpr;
        const boxPaddingX = 8 * dpr;

        ctx.font = `${fontSize}px monospace`;
        ctx.textBaseline = "middle";

        // Stable order keeps labels from jumping vertically.
        const orderedAgents = [...agents].sort((a, b) => a.id.localeCompare(b.id));

        for (let i = 0; i < orderedAgents.length; i++) {
          const agent = orderedAgents[i];
          const text = agent.id;
          const textWidth = ctx.measureText(text).width;
          const boxWidth = textWidth + boxPaddingX * 2;
          const boxHeight = rowHeight;

          const boxX = width - margin - boxWidth;
          const boxY = margin + i * (rowHeight + 6 * dpr);
          const boxMidY = boxY + boxHeight / 2;

          const [axNdcX, axNdcY] = projectToNDC(agent.position, viewMode);
          const [zax, zay] = applyZoomToNDC(axNdcX, axNdcY, zoom);
          const [ax, ay] = ndcToPixel(zax, zay, width, height);

          // 33% white connector to label anchor.
          ctx.strokeStyle = "rgba(255, 255, 255, 0.33)";
          ctx.lineWidth = Math.max(1, 1.25 * dpr);
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(boxX, boxMidY);
          ctx.stroke();

          // Label container.
          ctx.fillStyle = "rgba(0, 0, 0, 0.62)";
          ctx.fillRect(boxX, boxY, boxWidth, boxHeight);
          ctx.strokeStyle = "rgba(255, 255, 255, 0.45)";
          ctx.lineWidth = Math.max(1, 1 * dpr);
          ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);

          // Label text.
          ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
          ctx.fillText(text, boxX + boxPaddingX, boxMidY);
        }
      }

      rafId = requestAnimationFrame(frame);
    };

    rafId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafId);
  }, [canvasRef, agents, viewMode, zoom]);
}
