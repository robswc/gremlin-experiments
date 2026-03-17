import { useEffect, useRef, useState } from "react";

interface Vector3 {
  x: number;
  y: number;
  z: number;
}

interface MoveObjective {
  id: number;
  kind: string;
  target: Vector3;
  priority: number;
  createdTick: number;
}

interface PhysicalObject {
  id: string;
  kind: string;
  position: Vector3;
  size: number;
  height: number;
  radius?: number;
}

interface Road {
  id: string;
  name: string;
  width: number;
  points: Vector3[];
}

interface Fleet {
  id: string;
  name: string;
  leaderId: string;
  agentIds?: string[];
  objectIds?: string[];
}

interface Orientation {
  pitch: number;
  yaw: number;
  roll: number;
}

interface Agent {
  id: string;
  friendly: boolean;
  enemy: boolean;
  behavior: string;
  movementMode: string;
  followId?: string;
  position: Vector3;
  orientation: Orientation;
  velocity: Vector3;
  moveGoal?: Vector3;
  movePath?: Vector3[];
  pathIndex?: number;
  activeObjective?: MoveObjective;
  objectives?: MoveObjective[];
}

interface SandboxState {
  tick: number;
  agents: Agent[];
  objects: PhysicalObject[];
  roads: Road[];
  fleets: Fleet[];
}

interface UseSimulationOptions {
  smooth?: boolean;
}

function cloneState(state: SandboxState): SandboxState {
  return {
    tick: state.tick,
    objects: state.objects.map((o) => ({
      id: o.id,
      kind: o.kind,
      position: { ...o.position },
      size: o.size,
      height: o.height,
      radius: o.radius,
    })),
    roads: state.roads.map((road) => ({
      id: road.id,
      name: road.name,
      width: road.width,
      points: road.points.map((point) => ({ ...point })),
    })),
    fleets: state.fleets.map((f) => ({
      id: f.id,
      name: f.name,
      leaderId: f.leaderId,
      agentIds: f.agentIds ? [...f.agentIds] : undefined,
      objectIds: f.objectIds ? [...f.objectIds] : undefined,
    })),
    agents: state.agents.map((a) => ({
      id: a.id,
      friendly: a.friendly,
      enemy: a.enemy,
      behavior: a.behavior,
      movementMode: a.movementMode,
      followId: a.followId,
      position: { ...a.position },
      orientation: { ...a.orientation },
      velocity: { ...a.velocity },
      moveGoal: a.moveGoal ? { ...a.moveGoal } : undefined,
      movePath: a.movePath?.map((point) => ({ ...point })),
      pathIndex: a.pathIndex,
      activeObjective: a.activeObjective
        ? {
            id: a.activeObjective.id,
            kind: a.activeObjective.kind,
            target: { ...a.activeObjective.target },
            priority: a.activeObjective.priority,
            createdTick: a.activeObjective.createdTick,
          }
        : undefined,
      objectives: a.objectives?.map((o) => ({
        id: o.id,
        kind: o.kind,
        target: { ...o.target },
        priority: o.priority,
        createdTick: o.createdTick,
      })),
    })),
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function normalizeAngle(angle: number): number {
  const twoPi = Math.PI * 2;
  let out = angle % twoPi;
  if (out > Math.PI) out -= twoPi;
  if (out < -Math.PI) out += twoPi;
  return out;
}

function lerpAngle(current: number, target: number, t: number): number {
  const delta = normalizeAngle(target - current);
  return current + delta * t;
}

function interpolateState(current: SandboxState, target: SandboxState, t: number): SandboxState {
  const targetByID = new Map(target.agents.map((a) => [a.id, a]));

  const agents = current.agents.map((a) => {
    const ta = targetByID.get(a.id);
    if (!ta) return a;
    return {
      id: a.id,
      friendly: a.friendly,
      enemy: a.enemy,
      behavior: a.behavior,
      movementMode: a.movementMode,
      followId: a.followId,
      position: {
        x: lerp(a.position.x, ta.position.x, t),
        y: lerp(a.position.y, ta.position.y, t),
        z: lerp(a.position.z, ta.position.z, t),
      },
      orientation: {
        pitch: lerpAngle(a.orientation.pitch, ta.orientation.pitch, t),
        yaw: lerpAngle(a.orientation.yaw, ta.orientation.yaw, t),
        roll: lerpAngle(a.orientation.roll, ta.orientation.roll, t),
      },
      velocity: {
        x: lerp(a.velocity.x, ta.velocity.x, t),
        y: lerp(a.velocity.y, ta.velocity.y, t),
        z: lerp(a.velocity.z, ta.velocity.z, t),
      },
      moveGoal: ta.moveGoal ? { ...ta.moveGoal } : undefined,
      movePath: ta.movePath?.map((point) => ({ ...point })),
      pathIndex: ta.pathIndex,
      activeObjective: ta.activeObjective
        ? {
            id: ta.activeObjective.id,
            kind: ta.activeObjective.kind,
            target: { ...ta.activeObjective.target },
            priority: ta.activeObjective.priority,
            createdTick: ta.activeObjective.createdTick,
          }
        : undefined,
      objectives: ta.objectives?.map((o) => ({
        id: o.id,
        kind: o.kind,
        target: { ...o.target },
        priority: o.priority,
        createdTick: o.createdTick,
      })),
    };
  });

  return {
    tick: target.tick,
    objects: target.objects.map((o) => ({
      id: o.id,
      kind: o.kind,
      position: { ...o.position },
      size: o.size,
      height: o.height,
      radius: o.radius,
    })),
    roads: target.roads.map((road) => ({
      id: road.id,
      name: road.name,
      width: road.width,
      points: road.points.map((point) => ({ ...point })),
    })),
    fleets: target.fleets.map((f) => ({
      id: f.id,
      name: f.name,
      leaderId: f.leaderId,
      agentIds: f.agentIds ? [...f.agentIds] : undefined,
      objectIds: f.objectIds ? [...f.objectIds] : undefined,
    })),
    agents,
  };
}

export function useSimulation(url: string, options?: UseSimulationOptions) {
  const smooth = options?.smooth ?? true;
  const [state, setState] = useState<SandboxState | null>(null);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const smoothRef = useRef(smooth);
  const targetStateRef = useRef<SandboxState | null>(null);
  const renderStateRef = useRef<SandboxState | null>(null);

  useEffect(() => {
    smoothRef.current = smooth;
  }, [smooth]);

  useEffect(() => {
    const es = new EventSource(url);
    esRef.current = es;

    es.onopen = () => setConnected(true);

    es.onmessage = (event) => {
      const data: SandboxState = JSON.parse(event.data);
      targetStateRef.current = cloneState(data);
      if (!smoothRef.current) {
        renderStateRef.current = cloneState(data);
        setState(renderStateRef.current);
      }
    };

    es.onerror = () => {
      setConnected(false);
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [url]);

  useEffect(() => {
    let rafID = 0;
    let lastTime = performance.now();

    const frame = (now: number) => {
      const target = targetStateRef.current;
      if (target && smoothRef.current) {
        if (!renderStateRef.current) {
          renderStateRef.current = cloneState(target);
          setState(renderStateRef.current);
        } else {
          const dt = Math.min((now - lastTime) / 1000, 0.1);
          const alpha = 1 - Math.exp(-12 * dt);
          renderStateRef.current = interpolateState(renderStateRef.current, target, alpha);
          setState(renderStateRef.current);
        }
      }
      lastTime = now;
      rafID = requestAnimationFrame(frame);
    };

    rafID = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafID);
  }, []);

  return { state, connected };
}
