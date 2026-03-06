# CONTEXT.md

## Project Purpose
This repo is a lightweight simulation sandbox for agent/object movement in 3D space, rendered in a Vite frontend (WebGPU + canvas overlays) and driven by a Go backend simulation stream.

The current setup focuses on:
- clear simulation state streaming
- behavior experimentation (orbit, tail)
- visual debugging overlays (grid, vectors, labels)
- quick iteration with minimal dependencies

## High-Level Architecture

### Backend (Go)
- Path: `go-server/`
- Main server: `go-server/main.go`
- Simulation domain:
  - `go-server/simulation/agent.go`
  - `go-server/simulation/sandbox.go`

Responsibilities:
- own simulation truth state
- tick simulation at fixed cadence
- stream state over SSE (`/events`)
- expose control endpoints (`/reset`)

### Frontend (Vite + React)
- Path: `vite-app/`
- Main UI: `vite-app/src/App.tsx`
- Data stream hook: `vite-app/src/hooks/use-simulation.ts`
- Render/projection helpers:
  - `vite-app/src/lib/projection.ts`
- Layered render hooks:
  - `use-floor-grid-renderer.ts`
  - `use-ground-vector-renderer.ts`
  - `use-tail-link-renderer.ts`
  - `use-webgpu-renderer.ts`
  - `use-agent-label-renderer.ts`

Responsibilities:
- consume streamed simulation state
- interpolate for smooth visuals
- render projected overlays and agent arrows
- provide controls (view, zoom, reset, toggles)

## Current Simulation Model

### Agent Data
Current serialized agent fields include:
- `id: string`
- `friendly: boolean`
- `enemy: boolean`
- `behavior: string`
- `followId?: string`
- `position: { x, y, z }`
- `orientation: { pitch, yaw, roll }`

### Behaviors
- `orbit`: circles around an orbit center
- `tail`: follows behind target (`followId`) with delayed correction updates

Important tail dynamics:
- translational speed is constant (no slowdown near goal)
- heading correction is delayed and rate-limited
- delayed updates are randomized within configured bounds

### Tick + Motion Timing
- backend tick currently ~60Hz (`16ms`)
- motion uses `deltaSeconds` (time-based, not per-tick fixed steps)

This combination is key for smoothness and stability across jitter.

## State Streaming and Controls

### SSE Stream
- Endpoint: `GET /events`
- Data: per-tick JSON snapshots (`tick`, `agents`)

### Reset
- Endpoint: `POST /reset`
- Resets simulation tick and all agents to initial state

## Rendering Model (Layered Canvases)
In `App.tsx`, rendering is intentionally split into layers:
1. floor grid canvas
2. ground-vector canvas
3. tail-link canvas
4. agent canvas (WebGPU or 2D fallback)
5. label canvas

Why this matters:
- keeps each concern isolated
- makes toggles cheap and safe
- avoids shader complexity for debug overlays

## Projection and Camera Notes
Projection logic is centralized in `src/lib/projection.ts`.

Keep all render hooks using shared projection helpers. If one hook diverges, overlays stop lining up.

Supported views:
- top
- front
- side
- iso

Floor grid is projected from world floor coordinates (not a CSS screen-space pattern), so it aligns correctly in isometric view.

## Zoom
Zoom is a scalar applied to projected NDC coordinates before pixel conversion.

Current behavior:
- controls in Parameters panel
- shared across all layers
- approximately `0.4x` to `3.0x`

If adding new overlays, pass `zoom` into those hooks too.

## Color Conventions
- Friendly agent: cyan
- Enemy agent: red
- Tail links: white at 66% opacity (`rgba(255,255,255,0.66)`)
- Agent-to-label connectors: white at 33% opacity (`rgba(255,255,255,0.33)`)

Ground vectors are team-colored as well.

## Frontend Smoothing
`use-simulation.ts` supports interpolated render state.

Key points:
- receives raw snapshots from SSE
- keeps target state and interpolated render state
- blends position and orientation each animation frame
- uses angle-safe interpolation for yaw/pitch/roll wrapping

This should remain optional/toggleable for debugging.

## Important Gotchas

1. Transparent top layer requirement
- If fallback agent renderer fills opaque black, lower layers disappear.
- Agent canvas should clear transparent, not paint background.

2. Keep all canvases DPI-synced
- Every overlay canvas must be resized with the same DPR-aware logic.
- Missing one canvas causes misalignment.

3. Behavior update order matters
- Orbit agents should update before tail agents each tick.
- Tailing relies on up-to-date target transform.

4. Schema changes must be propagated end-to-end
- Adding backend agent fields requires frontend type updates in hooks/UI.

5. Maintain projection single source of truth
- Do not duplicate projection math inside each renderer.

## Running the Project
From repo root, run in separate terminals:

- Backend:
  - `make start-backend`
- Frontend:
  - `make start-frontend`

## Practical Next-Step Ideas
- behavior registry/system (instead of behavior string checks)
- camera pan + wheel zoom
- multiple enemies/friendlies + role-based formations
- collision/avoidance layer
- deterministic seeds for replayable simulations
- snapshot recording/replay tools

## Minimal-Dependency Principle
This project intentionally favors standard library/simple primitives over additional packages where possible. Keep that bias unless there is clear value to adding dependencies.
