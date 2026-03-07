import { useRef, useEffect, useState } from "react";
import { useSimulation } from "./hooks/use-simulation";
import { useWebGPURenderer } from "./hooks/use-webgpu-renderer";
import { useFloorGridRenderer } from "./hooks/use-floor-grid-renderer";
import { useGroundVectorRenderer } from "./hooks/use-ground-vector-renderer";
import { useTailLinkRenderer } from "./hooks/use-tail-link-renderer";
import { useAgentLabelRenderer } from "./hooks/use-agent-label-renderer";
import { useMoveTargetRenderer } from "./hooks/use-move-target-renderer";
import { usePhysicalObjectRenderer } from "./hooks/use-physical-object-renderer";
import type { CameraPan, ViewMode } from "@/lib/projection";

type SidebarTab = "parameters" | "agents";

export function App() {
	const gridCanvasRef = useRef<HTMLCanvasElement>(null);
	const vectorCanvasRef = useRef<HTMLCanvasElement>(null);
	const objectCanvasRef = useRef<HTMLCanvasElement>(null);
	const tailLinkCanvasRef = useRef<HTMLCanvasElement>(null);
	const moveTargetCanvasRef = useRef<HTMLCanvasElement>(null);
	const labelCanvasRef = useRef<HTMLCanvasElement>(null);
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const viewportRef = useRef<HTMLDivElement>(null);
	const dragRef = useRef<{ active: boolean; x: number; y: number }>({ active: false, x: 0, y: 0 });
	const [viewMode, setViewMode] = useState<ViewMode>("iso");
	const [zoom, setZoom] = useState(1);
	const [cameraPan, setCameraPan] = useState<CameraPan>({ x: 0, y: 0 });
	const [isPanning, setIsPanning] = useState(false);
	const [showGroundVectors, setShowGroundVectors] = useState(true);
	const [showTailLinks, setShowTailLinks] = useState(true);
	const [showCoordinateLabels, setShowCoordinateLabels] = useState(true);
	const [smoothMotion, setSmoothMotion] = useState(true);
	const [resetting, setResetting] = useState(false);
	const [sidebarTab, setSidebarTab] = useState<SidebarTab>("parameters");
	const [agentCommands, setAgentCommands] = useState<Record<string, string>>({});
	const [agentBusy, setAgentBusy] = useState<Record<string, boolean>>({});
	const [agentStatus, setAgentStatus] = useState<Record<string, string>>({});
	const { state, connected } = useSimulation("/api/events", { smooth: smoothMotion });

	const handleReset = async () => {
		setResetting(true);
		try {
			await fetch("/api/reset", { method: "POST" });
		} finally {
			setResetting(false);
		}
	};

	const nudgePan = (dx: number, dy: number) => {
		setCameraPan((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
	};

	const resetCamera = () => {
		setZoom(1);
		setCameraPan({ x: 0, y: 0 });
	};

	const setBusy = (agentID: string, busy: boolean) => {
		setAgentBusy((prev) => ({ ...prev, [agentID]: busy }));
	};

	const setStatus = (agentID: string, message: string) => {
		setAgentStatus((prev) => ({ ...prev, [agentID]: message }));
	};

	const handleBehaviorChange = async (agentID: string, behavior: "stationary" | "orbit") => {
		setBusy(agentID, true);
		try {
			const response = await fetch("/api/agent-behavior", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ id: agentID, behavior }),
			});
			if (!response.ok) {
				const text = await response.text();
				throw new Error(text || "Behavior update failed");
			}
			setStatus(agentID, `behavior set to ${behavior}`);
		} catch (error) {
			setStatus(agentID, error instanceof Error ? error.message : "Behavior update failed");
		} finally {
			setBusy(agentID, false);
		}
	};

	const parseMoveTo = (command: string) => {
		const match = command.trim().match(
			/^move_to\(\s*([-+]?\d*\.?\d+)\s*,\s*([-+]?\d*\.?\d+)\s*,\s*([-+]?\d*\.?\d+)\s*\)$/i,
		);
		if (!match) return null;
		return {
			x: Number(match[1]),
			y: Number(match[2]),
			z: Number(match[3]),
		};
	};

	const handleRunCommand = async (agentID: string) => {
		const command = (agentCommands[agentID] ?? "").trim();
		const destination = parseMoveTo(command);
		if (!destination) {
			setStatus(agentID, "Use format: move_to(x,y,z)");
			return;
		}

		setBusy(agentID, true);
		try {
			const response = await fetch("/api/move-to", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ id: agentID, coords: destination }),
			});
			if (!response.ok) {
				const text = await response.text();
				throw new Error(text || "Command failed");
			}
			setStatus(agentID, `move_to(${destination.x},${destination.y},${destination.z}) sent`);
		} catch (error) {
			setStatus(agentID, error instanceof Error ? error.message : "Command failed");
		} finally {
			setBusy(agentID, false);
		}
	};

	// Keep canvas pixel buffer matched to viewport size.
	useEffect(() => {
		const gridCanvas = gridCanvasRef.current;
		const vectorCanvas = vectorCanvasRef.current;
		const objectCanvas = objectCanvasRef.current;
		const tailLinkCanvas = tailLinkCanvasRef.current;
		const moveTargetCanvas = moveTargetCanvasRef.current;
		const labelCanvas = labelCanvasRef.current;
		const canvas = canvasRef.current;
		const viewport = viewportRef.current;
		if (!gridCanvas || !vectorCanvas || !objectCanvas || !tailLinkCanvas || !moveTargetCanvas || !labelCanvas || !canvas || !viewport) return;

		const resize = () => {
			const width = Math.max(1, Math.floor(viewport.clientWidth));
			const height = Math.max(1, Math.floor(viewport.clientHeight));
			gridCanvas.width = Math.floor(width * devicePixelRatio);
			gridCanvas.height = Math.floor(height * devicePixelRatio);
			vectorCanvas.width = Math.floor(width * devicePixelRatio);
			vectorCanvas.height = Math.floor(height * devicePixelRatio);
			objectCanvas.width = Math.floor(width * devicePixelRatio);
			objectCanvas.height = Math.floor(height * devicePixelRatio);
			tailLinkCanvas.width = Math.floor(width * devicePixelRatio);
			tailLinkCanvas.height = Math.floor(height * devicePixelRatio);
			moveTargetCanvas.width = Math.floor(width * devicePixelRatio);
			moveTargetCanvas.height = Math.floor(height * devicePixelRatio);
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
			objectCanvas.width = Math.floor(Math.max(1, width) * devicePixelRatio);
			objectCanvas.height = Math.floor(Math.max(1, height) * devicePixelRatio);
			tailLinkCanvas.width = Math.floor(Math.max(1, width) * devicePixelRatio);
			tailLinkCanvas.height = Math.floor(Math.max(1, height) * devicePixelRatio);
			moveTargetCanvas.width = Math.floor(Math.max(1, width) * devicePixelRatio);
			moveTargetCanvas.height = Math.floor(Math.max(1, height) * devicePixelRatio);
			labelCanvas.width = Math.floor(Math.max(1, width) * devicePixelRatio);
			labelCanvas.height = Math.floor(Math.max(1, height) * devicePixelRatio);
			canvas.width = Math.floor(Math.max(1, width) * devicePixelRatio);
			canvas.height = Math.floor(Math.max(1, height) * devicePixelRatio);
		});
		observer.observe(viewport);
		return () => observer.disconnect();
	}, []);

	useFloorGridRenderer(gridCanvasRef, viewMode, zoom, cameraPan);
	useGroundVectorRenderer(vectorCanvasRef, state?.agents ?? [], viewMode, showGroundVectors, zoom, cameraPan);
	usePhysicalObjectRenderer(objectCanvasRef, state?.objects ?? [], viewMode, zoom, cameraPan);
	useTailLinkRenderer(tailLinkCanvasRef, state?.agents ?? [], viewMode, showTailLinks, zoom, cameraPan);
	useMoveTargetRenderer(moveTargetCanvasRef, state?.agents ?? [], viewMode, zoom, cameraPan);
	useWebGPURenderer(canvasRef, state?.agents ?? [], viewMode, zoom, cameraPan);
	useAgentLabelRenderer(labelCanvasRef, state?.agents ?? [], viewMode, zoom, cameraPan, showCoordinateLabels);

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
					<div
						ref={viewportRef}
						tabIndex={0}
						onPointerDown={(e) => {
							dragRef.current = { active: true, x: e.clientX, y: e.clientY };
							setIsPanning(true);
							e.currentTarget.setPointerCapture(e.pointerId);
						}}
						onPointerMove={(e) => {
							if (!dragRef.current.active) return;
							const width = Math.max(1, e.currentTarget.clientWidth);
							const height = Math.max(1, e.currentTarget.clientHeight);
							const dxPx = e.clientX - dragRef.current.x;
							const dyPx = e.clientY - dragRef.current.y;
							dragRef.current.x = e.clientX;
							dragRef.current.y = e.clientY;
							const dxNdc = (dxPx / width) * 2;
							const dyNdc = (-dyPx / height) * 2;
							nudgePan(dxNdc, dyNdc);
						}}
						onPointerUp={(e) => {
							dragRef.current.active = false;
							setIsPanning(false);
							e.currentTarget.releasePointerCapture(e.pointerId);
						}}
						onPointerLeave={() => {
							dragRef.current.active = false;
							setIsPanning(false);
						}}
						onKeyDown={(e) => {
							const step = 0.05;
							if (e.key === "ArrowLeft") {
								e.preventDefault();
								nudgePan(-step, 0);
							}
							if (e.key === "ArrowRight") {
								e.preventDefault();
								nudgePan(step, 0);
							}
							if (e.key === "ArrowUp") {
								e.preventDefault();
								nudgePan(0, step);
							}
							if (e.key === "ArrowDown") {
								e.preventDefault();
								nudgePan(0, -step);
							}
						}}
						className="relative min-h-[420px] flex-1 overflow-hidden rounded-md bg-black outline-none"
						style={{ cursor: isPanning ? "grabbing" : "grab", touchAction: "none" }}
					>
						<canvas ref={gridCanvasRef} className="absolute inset-0 z-0 block h-full w-full" />
						<canvas ref={vectorCanvasRef} className="absolute inset-0 z-10 block h-full w-full" />
						<canvas ref={objectCanvasRef} className="absolute inset-0 z-[15] block h-full w-full" />
						<canvas ref={tailLinkCanvasRef} className="absolute inset-0 z-20 block h-full w-full" />
						<canvas ref={moveTargetCanvasRef} className="pointer-events-none absolute inset-0 z-[25] block h-full w-full" />
						<canvas ref={canvasRef} className="relative z-30 block h-full w-full rounded-md bg-transparent" />
						<canvas ref={labelCanvasRef} className="pointer-events-none absolute inset-0 z-40 block h-full w-full" />
					</div>
				</main>

				<aside className="rounded-lg border border-border bg-card p-6">
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={() => setSidebarTab("parameters")}
							className={`rounded px-3 py-1.5 text-sm ${
								sidebarTab === "parameters"
									? "border border-border bg-background text-foreground"
									: "border border-transparent bg-muted/30 text-muted-foreground"
							}`}
						>
							Parameters
						</button>
						<button
							type="button"
							onClick={() => setSidebarTab("agents")}
							className={`rounded px-3 py-1.5 text-sm ${
								sidebarTab === "agents"
									? "border border-border bg-background text-foreground"
									: "border border-transparent bg-muted/30 text-muted-foreground"
							}`}
						>
							Agents
						</button>
					</div>

					{sidebarTab === "parameters" && (
						<>
							<h2 className="mt-4 text-lg font-semibold tracking-tight">Parameters</h2>
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
										onClick={resetCamera}
										className="rounded border border-border bg-background px-2 py-1 text-xs"
									>
										Reset Cam
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
								<div className="mt-2 flex items-center gap-2">
									<button
										type="button"
										onClick={() => nudgePan(-0.08, 0)}
										className="rounded border border-border bg-background px-2 py-1 text-xs"
									>
										Left
									</button>
									<button
										type="button"
										onClick={() => nudgePan(0.08, 0)}
										className="rounded border border-border bg-background px-2 py-1 text-xs"
									>
										Right
									</button>
									<button
										type="button"
										onClick={() => nudgePan(0, 0.08)}
										className="rounded border border-border bg-background px-2 py-1 text-xs"
									>
										Up
									</button>
									<button
										type="button"
										onClick={() => nudgePan(0, -0.08)}
										className="rounded border border-border bg-background px-2 py-1 text-xs"
									>
										Down
									</button>
									<span className="ml-1 text-xs text-muted-foreground">
										pan ({cameraPan.x.toFixed(2)}, {cameraPan.y.toFixed(2)})
									</span>
								</div>
								<p className="text-xs text-muted-foreground">Drag the simulation view or use arrow keys while focused.</p>
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
										checked={showCoordinateLabels}
										onChange={(e) => setShowCoordinateLabels(e.target.checked)}
									/>
									Coordinate Labels
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
						</>
					)}

					{sidebarTab === "agents" && (
						<>
							<h2 className="mt-4 text-lg font-semibold tracking-tight">Agents</h2>
							<p className="mt-2 text-sm text-muted-foreground">Active: {state?.agents.length ?? 0}</p>
							{state && <p className="text-xs text-muted-foreground">Tick: {state.tick}</p>}
							<div className="mt-3 space-y-2 text-sm text-muted-foreground">
								{state?.agents.map((a) => {
									const behaviorValue = a.behavior === "orbit" ? "orbit" : a.behavior === "move_to" ? "move_to" : "stationary";
									const nextObjective = a.objectives && a.objectives.length > 0 ? a.objectives[0] : undefined;
									const objectiveLabel = (kind: string) =>
										kind === "self_preservation"
											? "self preservation"
											: kind === "follow_instruction"
												? "follow instruction"
												: kind;
									return (
										<div key={a.id} className="rounded border border-border p-2 font-mono text-xs">
											<div className="mb-2 flex items-center justify-between gap-2">
												<p>{a.id}</p>
												<span className="text-[10px] text-muted-foreground">{a.behavior || "stationary"}</span>
											</div>
											<p>friendly: {a.friendly ? "true" : "false"}</p>
											<p>enemy: {a.enemy ? "true" : "false"}</p>
											<p>x: {a.position.x.toFixed(2)}</p>
											<p>y: {a.position.y.toFixed(2)}</p>
											<p>z: {a.position.z.toFixed(2)}</p>
											{a.moveGoal && (
												<p>
													moveGoal: ({a.moveGoal.x.toFixed(2)}, {a.moveGoal.y.toFixed(2)}, {a.moveGoal.z.toFixed(2)})
												</p>
											)}
											<p>objectiveHeap: {a.objectives?.length ?? 0}</p>
											{a.activeObjective && (
												<p>
													activeObjective: {objectiveLabel(a.activeObjective.kind)} (p{a.activeObjective.priority})
												</p>
											)}
											{nextObjective && (
												<p>
													nextObjective: {objectiveLabel(nextObjective.kind)} p{nextObjective.priority} to ({nextObjective.target.x.toFixed(2)},{nextObjective.target.y.toFixed(2)},{nextObjective.target.z.toFixed(2)})
												</p>
											)}
											<label className="mt-2 block text-[10px] uppercase tracking-wide text-muted-foreground">Behavior</label>
											<select
												value={behaviorValue}
												disabled={agentBusy[a.id]}
												onChange={(e) => {
													const next = e.target.value as "stationary" | "orbit" | "move_to";
													if (next === "move_to") return;
													void handleBehaviorChange(a.id, next);
												}}
												className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-xs"
											>
												<option value="stationary">stationary</option>
												<option value="orbit">orbit</option>
												<option value="move_to" disabled>
													move_to (active)
												</option>
											</select>
											<label className="mt-2 block text-[10px] uppercase tracking-wide text-muted-foreground">Command</label>
											<div className="mt-1 flex gap-1">
												<input
													type="text"
													value={agentCommands[a.id] ?? ""}
													onChange={(e) =>
														setAgentCommands((prev) => ({
															...prev,
															[a.id]: e.target.value,
														}))
													}
													onKeyDown={(e) => {
														if (e.key === "Enter") {
															e.preventDefault();
															void handleRunCommand(a.id);
														}
													}}
													placeholder="move_to(1,0,-3)"
													disabled={agentBusy[a.id]}
													className="w-full rounded border border-border bg-background px-2 py-1 text-xs"
												/>
												<button
													type="button"
													onClick={() => void handleRunCommand(a.id)}
													disabled={agentBusy[a.id]}
													className="rounded border border-border bg-background px-2 py-1 text-xs disabled:opacity-60"
												>
													Run
												</button>
											</div>
											<p className="mt-1 min-h-4 text-[10px] text-muted-foreground">{agentStatus[a.id] ?? " "}</p>
										</div>
									);
								})}
							</div>
						</>
					)}
				</aside>
			</div>
		</div>
	);
}

export default App;