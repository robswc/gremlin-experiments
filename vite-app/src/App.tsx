import { useRef, useEffect, useState } from "react";
import { useSimulation } from "./hooks/use-simulation";
import { useWebGPURenderer } from "./hooks/use-webgpu-renderer";
import { useFloorGridRenderer } from "./hooks/use-floor-grid-renderer";
import { useGroundVectorRenderer } from "./hooks/use-ground-vector-renderer";
import { useTailLinkRenderer } from "./hooks/use-tail-link-renderer";
import { useAgentLabelRenderer } from "./hooks/use-agent-label-renderer";
import type { ViewMode } from "@/lib/projection";

export function App() {
	const gridCanvasRef = useRef<HTMLCanvasElement>(null);
	const vectorCanvasRef = useRef<HTMLCanvasElement>(null);
	const tailLinkCanvasRef = useRef<HTMLCanvasElement>(null);
	const labelCanvasRef = useRef<HTMLCanvasElement>(null);
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const viewportRef = useRef<HTMLDivElement>(null);
	const [viewMode, setViewMode] = useState<ViewMode>("iso");
	const [zoom, setZoom] = useState(1);
	const [showGroundVectors, setShowGroundVectors] = useState(true);
	const [showTailLinks, setShowTailLinks] = useState(true);
	const [smoothMotion, setSmoothMotion] = useState(true);
	const [resetting, setResetting] = useState(false);
	const { state, connected } = useSimulation("/api/events", { smooth: smoothMotion });

	const handleReset = async () => {
		setResetting(true);
		try {
			await fetch("/api/reset", { method: "POST" });
		} finally {
			setResetting(false);
		}
	};

	// Keep canvas pixel buffer matched to viewport size.
	useEffect(() => {
		const gridCanvas = gridCanvasRef.current;
		const vectorCanvas = vectorCanvasRef.current;
		const tailLinkCanvas = tailLinkCanvasRef.current;
		const labelCanvas = labelCanvasRef.current;
		const canvas = canvasRef.current;
		const viewport = viewportRef.current;
		if (!gridCanvas || !vectorCanvas || !tailLinkCanvas || !labelCanvas || !canvas || !viewport) return;

		const resize = () => {
			const width = Math.max(1, Math.floor(viewport.clientWidth));
			const height = Math.max(1, Math.floor(viewport.clientHeight));
			gridCanvas.width = Math.floor(width * devicePixelRatio);
			gridCanvas.height = Math.floor(height * devicePixelRatio);
			vectorCanvas.width = Math.floor(width * devicePixelRatio);
			vectorCanvas.height = Math.floor(height * devicePixelRatio);
			tailLinkCanvas.width = Math.floor(width * devicePixelRatio);
			tailLinkCanvas.height = Math.floor(height * devicePixelRatio);
			labelCanvas.width = Math.floor(width * devicePixelRatio);
			labelCanvas.height = Math.floor(height * devicePixelRatio);
			canvas.width = Math.floor(width * devicePixelRatio);
			canvas.height = Math.floor(height * devicePixelRatio);
		};

		resize();

		const observer = new ResizeObserver(([entry]) => {
			const { width, height } = entry.contentRect;
			gridCanvas.width = Math.floor(Math.max(1, width) * devicePixelRatio);
			gridCanvas.height = Math.floor(Math.max(1, height) * devicePixelRatio);
			vectorCanvas.width = Math.floor(Math.max(1, width) * devicePixelRatio);
			vectorCanvas.height = Math.floor(Math.max(1, height) * devicePixelRatio);
			tailLinkCanvas.width = Math.floor(Math.max(1, width) * devicePixelRatio);
			tailLinkCanvas.height = Math.floor(Math.max(1, height) * devicePixelRatio);
			labelCanvas.width = Math.floor(Math.max(1, width) * devicePixelRatio);
			labelCanvas.height = Math.floor(Math.max(1, height) * devicePixelRatio);
			canvas.width = Math.floor(Math.max(1, width) * devicePixelRatio);
			canvas.height = Math.floor(Math.max(1, height) * devicePixelRatio);
		});
		observer.observe(viewport);
		return () => observer.disconnect();
	}, []);

	useFloorGridRenderer(gridCanvasRef, viewMode, zoom);
	useGroundVectorRenderer(vectorCanvasRef, state?.agents ?? [], viewMode, showGroundVectors, zoom);
	useTailLinkRenderer(tailLinkCanvasRef, state?.agents ?? [], viewMode, showTailLinks, zoom);
	useWebGPURenderer(canvasRef, state?.agents ?? [], viewMode, zoom);
	useAgentLabelRenderer(labelCanvasRef, state?.agents ?? [], viewMode, zoom);

	return (
		<div className="min-h-screen bg-background text-foreground">
			<div className="mx-auto grid min-h-screen grid-cols-1 gap-4 p-4 md:grid-cols-[1fr_320px] md:gap-6 md:p-6">
				<main className="flex flex-col rounded-lg border border-border bg-card p-6">
					<div className="mb-4 flex items-center justify-between">
						<h1 className="text-2xl font-semibold tracking-tight">Simulation</h1>
						<span className={`inline-flex items-center gap-1.5 text-xs ${connected ? "text-green-400" : "text-red-400"}`}>
							<span className={`h-2 w-2 rounded-full ${connected ? "bg-green-400" : "bg-red-400"}`} />
							{connected ? "Connected" : "Disconnected"}
						</span>
					</div>
					<div ref={viewportRef} className="relative min-h-[420px] flex-1 overflow-hidden rounded-md bg-black">
						<canvas ref={gridCanvasRef} className="absolute inset-0 z-0 block h-full w-full" />
						<canvas ref={vectorCanvasRef} className="absolute inset-0 z-10 block h-full w-full" />
						<canvas ref={tailLinkCanvasRef} className="absolute inset-0 z-20 block h-full w-full" />
						<canvas ref={canvasRef} className="relative z-30 block h-full w-full rounded-md bg-transparent" />
						<canvas ref={labelCanvasRef} className="pointer-events-none absolute inset-0 z-40 block h-full w-full" />
					</div>
				</main>

				<aside className="rounded-lg border border-border bg-card p-6">
					<h2 className="text-lg font-semibold tracking-tight">Parameters</h2>
					<button
						type="button"
						onClick={handleReset}
						disabled={resetting}
						className="mt-4 w-full rounded border border-border bg-background px-3 py-2 text-sm font-medium disabled:opacity-60"
					>
						{resetting ? "Resetting..." : "Reset Simulation"}
					</button>
					<div className="mt-4 space-y-2">
						<label htmlFor="view-mode" className="text-xs uppercase tracking-wide text-muted-foreground">
							View
						</label>
						<select
							id="view-mode"
							value={viewMode}
							onChange={(e) => setViewMode(e.target.value as ViewMode)}
							className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
						>
							<option value="top">Top (X / Z)</option>
							<option value="front">Front (X / Y)</option>
							<option value="side">Side (Z / Y)</option>
							<option value="iso">Isometric</option>
						</select>
						<div className="mt-2 flex items-center gap-2">
							<button
								type="button"
								onClick={() => setZoom((z) => Math.max(0.4, Number((z - 0.2).toFixed(2))))}
								className="rounded border border-border bg-background px-2 py-1 text-xs"
							>
								Zoom Out
							</button>
							<button
								type="button"
								onClick={() => setZoom(1)}
								className="rounded border border-border bg-background px-2 py-1 text-xs"
							>
								Reset
							</button>
							<button
								type="button"
								onClick={() => setZoom((z) => Math.min(3, Number((z + 0.2).toFixed(2))))}
								className="rounded border border-border bg-background px-2 py-1 text-xs"
							>
								Zoom In
							</button>
							<span className="ml-1 text-xs text-muted-foreground">{zoom.toFixed(1)}x</span>
						</div>
						<label className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
							<input
								type="checkbox"
								checked={showGroundVectors}
								onChange={(e) => setShowGroundVectors(e.target.checked)}
							/>
							Ground Vectors
						</label>
						<label className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
							<input
								type="checkbox"
								checked={showTailLinks}
								onChange={(e) => setShowTailLinks(e.target.checked)}
							/>
							Tail Links
						</label>
						<label className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
							<input
								type="checkbox"
								checked={smoothMotion}
								onChange={(e) => setSmoothMotion(e.target.checked)}
							/>
							Smooth Motion
						</label>
					</div>
					{state && (
						<div className="mt-4 space-y-2 text-sm text-muted-foreground">
							<p>Tick: {state.tick}</p>
							{state.agents.map((a) => (
								<div key={a.id} className="rounded border border-border p-2 font-mono text-xs">
									<p>{a.id}</p>
									<p>friendly: {a.friendly ? "true" : "false"}</p>
									<p>enemy: {a.enemy ? "true" : "false"}</p>
									<p>behavior: {a.behavior}</p>
									{a.followId && <p>followId: {a.followId}</p>}
									<p>x: {a.position.x.toFixed(2)}</p>
									<p>y: {a.position.y.toFixed(2)}</p>
									<p>z: {a.position.z.toFixed(2)}</p>
									<p>pitch: {a.orientation.pitch.toFixed(2)}</p>
									<p>yaw: {a.orientation.yaw.toFixed(2)}</p>
									<p>roll: {a.orientation.roll.toFixed(2)}</p>
								</div>
							))}
						</div>
					)}
				</aside>
			</div>
		</div>
	);
}

export default App;