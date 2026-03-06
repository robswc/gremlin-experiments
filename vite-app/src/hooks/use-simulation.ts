import { useEffect, useRef, useState } from "react";

interface Vector3 {
  x: number;
  y: number;
  z: number;
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
  followId?: string;
  position: Vector3;
  orientation: Orientation;
}

interface SandboxState {
  tick: number;
  agents: Agent[];
}

interface UseSimulationOptions {
  smooth?: boolean;
}

function cloneState(state: SandboxState): SandboxState {
  return {
    tick: state.tick,
    agents: state.agents.map((a) => ({
      id: a.id,
      friendly: a.friendly,
      enemy: a.enemy,
      behavior: a.behavior,
      followId: a.followId,
      position: { ...a.position },
      orientation: { ...a.orientation },
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
    };
  });

  return { tick: target.tick, agents };
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
