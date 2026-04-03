import { useRef, useEffect, useState } from "react";
import { useSimulation } from "./hooks/use-simulation";
import { useWebGPURenderer } from "./hooks/use-webgpu-renderer";
import { useFloorGridRenderer } from "./hooks/use-floor-grid-renderer";
import { useGroundVectorRenderer } from "./hooks/use-ground-vector-renderer";
import { useTailLinkRenderer } from "./hooks/use-tail-link-renderer";
import { useAgentLabelRenderer } from "./hooks/use-agent-label-renderer";
import { useMoveTargetRenderer } from "./hooks/use-move-target-renderer";
import { usePhysicalObjectRenderer } from "./hooks/use-physical-object-renderer";
import { useRoadRenderer } from "./hooks/use-road-renderer";
import { projectToNDC, type CameraOrbit, type CameraPan, type ViewMode, VIEW_MODE_ORBIT_PRESETS } from "@/lib/projection";

type SidebarTab = "parameters" | "agents" | "fleets";
type TrackingTarget = "none" | `agent:${string}` | `object:${string}`;

function formatTrackingLabel(target: TrackingTarget): string {
	if (target === "none") {
		return "none";
	}

	const [kind, id] = target.split(":");
	return `${kind} ${id}`;
}

export function App() {
	const gridCanvasRef = useRef<HTMLCanvasElement>(null);
	const vectorCanvasRef = useRef<HTMLCanvasElement>(null);
	const roadCanvasRef = useRef<HTMLCanvasElement>(null);
	const objectCanvasRef = useRef<HTMLCanvasElement>(null);
	const tailLinkCanvasRef = useRef<HTMLCanvasElement>(null);
	const moveTargetCanvasRef = useRef<HTMLCanvasElement>(null);
	const labelCanvasRef = useRef<HTMLCanvasElement>(null);
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const viewportRef = useRef<HTMLDivElement>(null);
	const dragRef = useRef<{ active: boolean; x: number; y: number; shift: boolean }>({ active: false, x: 0, y: 0, shift: false });
	const [viewMode, setViewMode] = useState<ViewMode>("iso");
	const [zoom, setZoom] = useState(1);
	const [cameraPan, setCameraPan] = useState<CameraPan>({ x: 0, y: 0 });
	const [cameraOrbit, setCameraOrbit] = useState<CameraOrbit>(VIEW_MODE_ORBIT_PRESETS["iso"]);
	const [isOrbiting, setIsOrbiting] = useState(false);
	const [trackingTarget, setTrackingTarget] = useState<TrackingTarget>("none");
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
	const [selectedFleetID, setSelectedFleetID] = useState("");
	const [fleetName, setFleetName] = useState("");
	const [fleetLeaderID, setFleetLeaderID] = useState("");
	const [fleetAgentIDs, setFleetAgentIDs] = useState<string[]>([]);
	const [fleetObjectIDs, setFleetObjectIDs] = useState<string[]>([]);
	const [fleetBusy, setFleetBusy] = useState(false);
	const [fleetStatus, setFleetStatus] = useState("");
	const { state, connected } = useSimulation("/api/events", { smooth: smoothMotion });
	const trackedEntity =
		trackingTarget === "none"
			? null
			: trackingTarget.startsWith("agent:")
				? state?.agents.find((agent) => agent.id === trackingTarget.slice(6)) ?? null
				: state?.objects.find((object) => object.id === trackingTarget.slice(7)) ?? null;

	const clearTracking = () => {
		setTrackingTarget("none");
	};

	const nudgePan = (dx: number, dy: number) => {
		setTrackingTarget("none");
		setCameraPan((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
	};

	const handleReset = async () => {
		setResetting(true);
		try {
			await fetch("/api/reset", { method: "POST" });
		} finally {
			setResetting(false);
		}
	};

	const resetCamera = () => {
		setZoom(1);
		setTrackingTarget("none");
		setCameraPan({ x: 0, y: 0 });
		setCameraOrbit(VIEW_MODE_ORBIT_PRESETS[viewMode]);
	};

	const setBusy = (agentID: string, busy: boolean) => {
		setAgentBusy((prev) => ({ ...prev, [agentID]: busy }));
	};

	const setStatus = (agentID: string, message: string) => {
		setAgentStatus((prev) => ({ ...prev, [agentID]: message }));
	};

	const applyFleetToForm = (fleet: {
		id: string;
		name: string;
		leaderId: string;
		agentIds?: string[];
		objectIds?: string[];
	}) => {
		setSelectedFleetID(fleet.id);
		setFleetName(fleet.name);
		setFleetLeaderID(fleet.leaderId);
		setFleetAgentIDs(fleet.agentIds ? [...fleet.agentIds] : []);
		setFleetObjectIDs(fleet.objectIds ? [...fleet.objectIds] : []);
		setFleetStatus("");
	};

	const startNewFleet = () => {
		const leader = state?.agents[0]?.id ?? "";
		setSelectedFleetID("");
		setFleetName("");
		setFleetLeaderID(leader);
		setFleetAgentIDs(leader ? [leader] : []);
		setFleetObjectIDs([]);
		setFleetStatus("");
	};

	const toggleID = (items: string[], id: string) =>
		items.includes(id) ? items.filter((item) => item !== id) : [...items, id];

	const toggleFleetAgent = (id: string) => {
		setFleetAgentIDs((prev) => toggleID(prev, id));
	};

	const toggleFleetObject = (id: string) => {
		setFleetObjectIDs((prev) => toggleID(prev, id));
	};

	const handleSaveFleet = async () => {
		setFleetBusy(true);
		setFleetStatus("");
		try {
			const body = {
				id: selectedFleetID || undefined,
				name: fleetName,
				leaderId: fleetLeaderID,
				agentIds: fleetAgentIDs,
				objectIds: fleetObjectIDs,
			};
			const response = await fetch("/api/fleet", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});
			if (!response.ok) {
				const text = await response.text();
				throw new Error(text || "Fleet save failed");
			}
			const json: { fleet?: { id?: string } } = await response.json();
			if (json.fleet?.id) {
				setSelectedFleetID(json.fleet.id);
			}
			setFleetStatus("Fleet saved");
		} catch (error) {
			setFleetStatus(error instanceof Error ? error.message : "Fleet save failed");
		} finally {
			setFleetBusy(false);
		}
	};

	const handleDeleteFleet = async () => {
		if (!selectedFleetID) {
			setFleetStatus("Select a fleet first");
			return;
		}
		setFleetBusy(true);
		setFleetStatus("");
		try {
			const response = await fetch(`/api/fleet?id=${encodeURIComponent(selectedFleetID)}`, {
				method: "DELETE",
			});
			if (!response.ok) {
				const text = await response.text();
				throw new Error(text || "Fleet delete failed");
			}
			startNewFleet();
			setFleetStatus("Fleet deleted");
		} catch (error) {
			setFleetStatus(error instanceof Error ? error.message : "Fleet delete failed");
		} finally {
			setFleetBusy(false);
		}
	};

	useEffect(() => {
		setCameraOrbit(VIEW_MODE_ORBIT_PRESETS[viewMode]);
	}, [viewMode]);

	useEffect(() => {
		if (trackingTarget === "none") {
			return;
		}

		if (!trackedEntity) {
			setTrackingTarget("none");
			return;
		}

		const [nx, ny] = projectToNDC(trackedEntity.position, viewMode);
		setCameraPan({ x: -nx * zoom, y: -ny * zoom });
	}, [trackedEntity, trackingTarget, viewMode, zoom]);

	useEffect(() => {
		if (!state) {
			return;
		}

		if (state.fleets.length === 0) {
			if (selectedFleetID !== "") {
				const leader = state.agents[0]?.id ?? "";
				setSelectedFleetID("");
				setFleetName("");
				setFleetLeaderID(leader);
				setFleetAgentIDs(leader ? [leader] : []);
				setFleetObjectIDs([]);
				setFleetStatus("");
			}
			return;
		}

		if (selectedFleetID) {
			const exists = state.fleets.some((fleet) => fleet.id === selectedFleetID);
			if (!exists) {
				const leader = state.agents[0]?.id ?? "";
				setSelectedFleetID("");
				setFleetName("");
				setFleetLeaderID(leader);
				setFleetAgentIDs(leader ? [leader] : []);
				setFleetObjectIDs([]);
				setFleetStatus("");
			}
			return;
		}

		if (!fleetName && !selectedFleetID) {
			applyFleetToForm(state.fleets[0]);
		}
	}, [state, selectedFleetID, fleetName]);

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
		const roadCanvas = roadCanvasRef.current;
		const objectCanvas = objectCanvasRef.current;
		const tailLinkCanvas = tailLinkCanvasRef.current;
		const moveTargetCanvas = moveTargetCanvasRef.current;
		const labelCanvas = labelCanvasRef.current;
		const canvas = canvasRef.current;
		const viewport = viewportRef.current;
		if (!gridCanvas || !vectorCanvas || !roadCanvas || !objectCanvas || !tailLinkCanvas || !moveTargetCanvas || !labelCanvas || !canvas || !viewport) return;

		const resize = () => {
			const width = Math.max(1, Math.floor(viewport.clientWidth));
			const height = Math.max(1, Math.floor(viewport.clientHeight));
			gridCanvas.width = Math.floor(width * devicePixelRatio);
			gridCanvas.height = Math.floor(height * devicePixelRatio);
			vectorCanvas.width = Math.floor(width * devicePixelRatio);
			vectorCanvas.height = Math.floor(height * devicePixelRatio);
			roadCanvas.width = Math.floor(width * devicePixelRatio);
			roadCanvas.height = Math.floor(height * devicePixelRatio);
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
			roadCanvas.width = Math.floor(Math.max(1, width) * devicePixelRatio);
			roadCanvas.height = Math.floor(Math.max(1, height) * devicePixelRatio);
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

	useFloorGridRenderer(gridCanvasRef, viewMode, zoom, cameraPan, cameraOrbit);
	useGroundVectorRenderer(vectorCanvasRef, state?.agents ?? [], viewMode, showGroundVectors, zoom, cameraPan, cameraOrbit);
	useRoadRenderer(roadCanvasRef, state?.roads ?? [], viewMode, zoom, cameraPan, cameraOrbit);
	usePhysicalObjectRenderer(objectCanvasRef, state?.objects ?? [], viewMode, zoom, cameraPan, cameraOrbit);
	useTailLinkRenderer(tailLinkCanvasRef, state?.agents ?? [], viewMode, showTailLinks, zoom, cameraPan, cameraOrbit);
	useMoveTargetRenderer(moveTargetCanvasRef, state?.agents ?? [], viewMode, zoom, cameraPan, cameraOrbit);
	useWebGPURenderer(canvasRef, state?.agents ?? [], viewMode, zoom, cameraPan, cameraOrbit);
	useAgentLabelRenderer(labelCanvasRef, state?.agents ?? [], viewMode, zoom, cameraPan, showCoordinateLabels, cameraOrbit);

	return (
		<div className="h-screen w-screen overflow-hidden bg-background text-foreground">
			<div className="grid h-full grid-cols-1 md:grid-cols-[minmax(0,1fr)_360px]">
				<main className="relative min-h-0">
					<div
						ref={viewportRef}
						tabIndex={0}
						onPointerDown={(e) => {
							if (trackingTarget !== "none") {
								clearTracking();
							}
							dragRef.current = { active: true, x: e.clientX, y: e.clientY, shift: e.shiftKey };
							if (e.shiftKey) {
								setIsOrbiting(true);
							} else {
								setIsPanning(true);
							}
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
							if (dragRef.current.shift) {
								// Shift+drag: orbit camera. Horizontal = azimuth, vertical = elevation.
								const sensitivity = 2.5;
								const dAzimuth = -(dxPx / width) * Math.PI * sensitivity;
								const dElevation = (dyPx / height) * Math.PI * sensitivity;
								setCameraOrbit((prev) => ({
									azimuth: prev.azimuth + dAzimuth,
									elevation: Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, prev.elevation + dElevation)),
								}));
							} else {
								const dxNdc = (dxPx / width) * 2;
								const dyNdc = (-dyPx / height) * 2;
								nudgePan(dxNdc, dyNdc);
							}
						}}
						onPointerUp={(e) => {
							dragRef.current.active = false;
							setIsPanning(false);
							setIsOrbiting(false);
							e.currentTarget.releasePointerCapture(e.pointerId);
						}}
						onPointerLeave={() => {
							dragRef.current.active = false;
							setIsPanning(false);
							setIsOrbiting(false);
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
						className="relative h-full w-full overflow-hidden bg-black outline-none"
					style={{ cursor: isOrbiting ? "crosshair" : isPanning ? "grabbing" : "grab", touchAction: "none" }}
					>
						<div className="pointer-events-none absolute left-3 top-3 z-50">
							<span className={`inline-flex items-center gap-1.5 rounded bg-background/80 px-2 py-1 text-xs backdrop-blur-sm ${connected ? "text-green-400" : "text-red-400"}`}>
								<span className={`h-2 w-2 rounded-full ${connected ? "bg-green-400" : "bg-red-400"}`} />
								{connected ? "Connected" : "Disconnected"}
							</span>
						</div>
						<canvas ref={gridCanvasRef} className="absolute inset-0 z-0 block h-full w-full" />
						<canvas ref={vectorCanvasRef} className="absolute inset-0 z-10 block h-full w-full" />
						<canvas ref={roadCanvasRef} className="absolute inset-0 z-[12] block h-full w-full" />
						<canvas ref={objectCanvasRef} className="absolute inset-0 z-[15] block h-full w-full" />
						<canvas ref={tailLinkCanvasRef} className="absolute inset-0 z-20 block h-full w-full" />
						<canvas ref={moveTargetCanvasRef} className="pointer-events-none absolute inset-0 z-[25] block h-full w-full" />
						<canvas ref={canvasRef} className="relative z-30 block h-full w-full bg-transparent" />
						<canvas ref={labelCanvasRef} className="pointer-events-none absolute inset-0 z-40 block h-full w-full" />
					</div>
				</main>

				<aside className="h-full overflow-y-auto border-l border-border bg-card p-6">
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
						<button
							type="button"
							onClick={() => setSidebarTab("fleets")}
							className={`rounded px-3 py-1.5 text-sm ${
								sidebarTab === "fleets"
									? "border border-border bg-background text-foreground"
									: "border border-transparent bg-muted/30 text-muted-foreground"
							}`}
						>
							Fleets
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
								<label htmlFor="camera-track" className="mt-2 text-xs uppercase tracking-wide text-muted-foreground">
									Track Target
								</label>
								<select
									id="camera-track"
									value={trackingTarget}
									onChange={(e) => setTrackingTarget(e.target.value as TrackingTarget)}
									className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
								>
									<option value="none">None</option>
									{state?.agents.map((agent) => (
										<option key={`agent:${agent.id}`} value={`agent:${agent.id}`}>
											Agent: {agent.id}
										</option>
									))}
									{state?.objects.map((object) => (
										<option key={`object:${object.id}`} value={`object:${object.id}`}>
											Object: {object.id}
										</option>
									))}
								</select>
								<p className="text-xs text-muted-foreground">
									Tracking: {formatTrackingLabel(trackingTarget)}
								</p>
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
										onClick={clearTracking}
										disabled={trackingTarget === "none"}
										className="rounded border border-border bg-background px-2 py-1 text-xs disabled:opacity-60"
									>
										Stop Track
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
								<p className="text-xs text-muted-foreground">
									Drag to pan. <strong>Shift+drag</strong> to orbit the camera in 3D. Arrow keys pan while focused. Manual camera moves stop tracking.
								</p>
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

					{sidebarTab === "fleets" && (
						<>
							<h2 className="mt-4 text-lg font-semibold tracking-tight">Fleets</h2>
							<p className="mt-2 text-sm text-muted-foreground">Total: {state?.fleets.length ?? 0}</p>
							<div className="mt-3 flex gap-2">
								<button
									type="button"
									onClick={startNewFleet}
									disabled={fleetBusy}
									className="rounded border border-border bg-background px-2 py-1 text-xs disabled:opacity-60"
								>
									New Fleet
								</button>
								<button
									type="button"
									onClick={() => void handleSaveFleet()}
									disabled={fleetBusy}
									className="rounded border border-border bg-background px-2 py-1 text-xs disabled:opacity-60"
								>
									{fleetBusy ? "Saving..." : "Save Fleet"}
								</button>
								<button
									type="button"
									onClick={() => void handleDeleteFleet()}
									disabled={fleetBusy || !selectedFleetID}
									className="rounded border border-border bg-background px-2 py-1 text-xs disabled:opacity-60"
								>
									Delete
								</button>
							</div>

							<div className="mt-3 space-y-2 text-xs text-muted-foreground">
								<label className="block text-[10px] uppercase tracking-wide">Name</label>
								<input
									type="text"
									value={fleetName}
									onChange={(e) => setFleetName(e.target.value)}
									placeholder="Alpha Fleet"
									disabled={fleetBusy}
									className="w-full rounded border border-border bg-background px-2 py-1 text-xs"
								/>

								<label className="block text-[10px] uppercase tracking-wide">Leader</label>
								<select
									value={fleetLeaderID}
									onChange={(e) => {
										const nextLeader = e.target.value;
										setFleetLeaderID(nextLeader);
										if (nextLeader && !fleetAgentIDs.includes(nextLeader)) {
											setFleetAgentIDs((prev) => [nextLeader, ...prev]);
										}
									}}
									disabled={fleetBusy}
									className="w-full rounded border border-border bg-background px-2 py-1 text-xs"
								>
									<option value="">Select leader</option>
									{state?.agents.map((agent) => (
										<option key={agent.id} value={agent.id}>
											{agent.id}
										</option>
									))}
								</select>

								<label className="block text-[10px] uppercase tracking-wide">Agents</label>
								<div className="max-h-28 space-y-1 overflow-y-auto rounded border border-border p-2">
									{state?.agents.map((agent) => (
										<label key={agent.id} className="flex items-center gap-2">
											<input
												type="checkbox"
												checked={fleetAgentIDs.includes(agent.id)}
												onChange={() => toggleFleetAgent(agent.id)}
												disabled={fleetBusy}
											/>
											{agent.id}
										</label>
									))}
								</div>

								<label className="block text-[10px] uppercase tracking-wide">Objects</label>
								<div className="max-h-28 space-y-1 overflow-y-auto rounded border border-border p-2">
									{state?.objects.map((object) => (
										<label key={object.id} className="flex items-center gap-2">
											<input
												type="checkbox"
												checked={fleetObjectIDs.includes(object.id)}
												onChange={() => toggleFleetObject(object.id)}
												disabled={fleetBusy}
											/>
											{object.id}
										</label>
									))}
									{(state?.objects.length ?? 0) === 0 && <p className="text-[10px]">No objects available</p>}
								</div>
								<p className="min-h-4 text-[10px]">{fleetStatus || " "}</p>
							</div>

							<div className="mt-3 space-y-2">
								<label className="block text-[10px] uppercase tracking-wide text-muted-foreground">Existing Fleets</label>
								<div className="max-h-44 space-y-1 overflow-y-auto">
									{state?.fleets.map((fleet) => (
										<button
											key={fleet.id}
											type="button"
											onClick={() => applyFleetToForm(fleet)}
											className={`w-full rounded border px-2 py-1 text-left text-xs ${
												selectedFleetID === fleet.id
													? "border-border bg-background"
													: "border-border/50 bg-muted/20"
											}`}
										>
											<div className="flex items-center justify-between gap-2">
												<span>{fleet.name}</span>
												<span className="text-[10px] text-muted-foreground">{fleet.id}</span>
											</div>
											<p className="text-[10px] text-muted-foreground">leader: {fleet.leaderId}</p>
											<p className="text-[10px] text-muted-foreground">
												agents: {fleet.agentIds?.length ?? 0} objects: {fleet.objectIds?.length ?? 0}
											</p>
										</button>
									))}
									{(state?.fleets.length ?? 0) === 0 && (
										<p className="rounded border border-dashed border-border p-2 text-xs text-muted-foreground">No fleets yet</p>
									)}
								</div>
							</div>
						</>
					)}
				</aside>
			</div>
		</div>
	);
}

export default App;