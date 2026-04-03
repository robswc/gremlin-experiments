export type ViewMode = "top" | "front" | "side" | "iso";

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface Orientation {
  pitch: number;
  yaw: number;
  roll: number;
}

export interface CameraPan {
  x: number;
  y: number;
}

export interface CameraOrbit {
  /** Horizontal rotation around Y axis, in radians. */
  azimuth: number;
  /** Vertical tilt in radians. 0 = horizontal, π/2 = top-down. */
  elevation: number;
}

export const WORLD_HALF_EXTENT = 64;
export const FLOOR_Y = 0;

/** Preset orbit angles that reproduce the classic fixed view modes. */
export const VIEW_MODE_ORBIT_PRESETS: Record<ViewMode, CameraOrbit> = {
  top:   { azimuth: 0,             elevation: Math.PI / 2 - 0.001 },
  front: { azimuth: 0,             elevation: 0 },
  side:  { azimuth: -Math.PI / 2,  elevation: 0 },
  iso:   { azimuth: Math.PI / 4,   elevation: 0.4 },
};

/**
 * Orthographic orbit projection.
 *
 * Right  = (cos θ,          0,       −sin θ)
 * Up     = (sin θ · sin φ,  cos φ,   cos θ · sin φ)
 *
 * NDC_x = dot(pos, right) / extent
 * NDC_y = dot(pos, up)    / extent
 */
export function projectToNDCOrbit(pos: Vector3, orbit: CameraOrbit): [number, number] {
  const { azimuth: theta, elevation: phi } = orbit;
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);
  const cosP = Math.cos(phi);
  const sinP = Math.sin(phi);
  const nx = (pos.x * cosT - pos.z * sinT) / WORLD_HALF_EXTENT;
  const ny = (pos.x * sinT * sinP + pos.y * cosP + pos.z * cosT * sinP) / WORLD_HALF_EXTENT;
  return [nx, ny];
}

export function projectFloorToNDCOrbit(x: number, z: number, orbit: CameraOrbit): [number, number] {
  return projectToNDCOrbit({ x, y: FLOOR_Y, z }, orbit);
}

export function projectToNDCClampedToFloorOrbit(pos: Vector3, orbit: CameraOrbit): [number, number] {
  const clipped = pos.y >= FLOOR_Y ? pos : { x: pos.x, y: FLOOR_Y, z: pos.z };
  return projectToNDCOrbit(clipped, orbit);
}

/**
 * Inverse of projectToNDCOrbit for points on the floor (y = FLOOR_Y).
 * Returns null when the floor is edge-on (elevation near ±0).
 */
export function unprojectFloorFromNDCOrbit(
  nx: number,
  ny: number,
  orbit: CameraOrbit
): [number, number] | null {
  const { azimuth: theta, elevation: phi } = orbit;
  const sinP = Math.sin(phi);
  if (Math.abs(sinP) < 1e-4) return null; // floor collapses to a line at this angle
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);
  const scale = WORLD_HALF_EXTENT;
  // Solve: x*cosT - z*sinT = nx*scale  and  x*sinT + z*cosT = ny*scale/sinP
  const b = (ny * scale) / sinP;
  const x = cosT * nx * scale + sinT * b;
  const z = cosT * b - sinT * nx * scale;
  return [x, z];
}

export function projectDirectionToNDCOrbit(
  origin: Vector3,
  orientation: Orientation,
  orbit: CameraOrbit,
  worldLength = 2
): [number, number] {
  const f = forwardFromOrientation(orientation);
  const [ox, oy] = projectToNDCOrbit(origin, orbit);
  const [tx, ty] = projectToNDCOrbit(
    { x: origin.x + f.x * worldLength, y: origin.y + f.y * worldLength, z: origin.z + f.z * worldLength },
    orbit
  );
  let dx = tx - ox;
  let dy = ty - oy;
  const mag = Math.hypot(dx, dy);
  if (mag < 1e-6) return [1, 0];
  dx /= mag;
  dy /= mag;
  return [dx, dy];
}

function projectToNDCInternal(pos: Vector3, viewMode: ViewMode): [number, number] {
  switch (viewMode) {
    case "front":
      return [pos.x / WORLD_HALF_EXTENT, pos.y / WORLD_HALF_EXTENT];
    case "side":
      return [pos.z / WORLD_HALF_EXTENT, pos.y / WORLD_HALF_EXTENT];
    case "iso": {
      const isoX = (pos.x - pos.z) / (WORLD_HALF_EXTENT * 1.4);
      const isoY = (pos.y + (pos.x + pos.z) * 0.35) / (WORLD_HALF_EXTENT * 1.4);
      return [isoX, isoY];
    }
    case "top":
    default:
      return [pos.x / WORLD_HALF_EXTENT, pos.z / WORLD_HALF_EXTENT];
  }
}

export function projectToNDC(pos: Vector3, viewMode: ViewMode): [number, number] {
  return projectToNDCInternal(pos, viewMode);
}

export function projectToNDCClampedToFloor(pos: Vector3, viewMode: ViewMode): [number, number] {
  const clipped = pos.y >= FLOOR_Y ? pos : { x: pos.x, y: FLOOR_Y, z: pos.z };
  return projectToNDCInternal(clipped, viewMode);
}

export function projectFloorToNDC(x: number, z: number, viewMode: ViewMode): [number, number] {
  return projectToNDC({ x, y: FLOOR_Y, z }, viewMode);
}

export function ndcToPixel(nx: number, ny: number, width: number, height: number): [number, number] {
  const px = ((nx + 1) * 0.5) * width;
  const py = ((1 - ny) * 0.5) * height;
  return [px, py];
}

export function applyZoomToNDC(nx: number, ny: number, zoom: number): [number, number] {
  return [nx * zoom, ny * zoom];
}

export function applyViewTransformToNDC(
  nx: number,
  ny: number,
  zoom: number,
  pan: CameraPan
): [number, number] {
  return [nx * zoom + pan.x, ny * zoom + pan.y];
}

export function forwardFromOrientation(o: Orientation): Vector3 {
  const cp = Math.cos(o.pitch);
  return {
    x: cp * Math.cos(o.yaw),
    y: Math.sin(o.pitch),
    z: cp * Math.sin(o.yaw),
  };
}

export function projectDirectionToNDC(
  origin: Vector3,
  orientation: Orientation,
  viewMode: ViewMode,
  worldLength = 2
): [number, number] {
  const f = forwardFromOrientation(orientation);
  const [ox, oy] = projectToNDC(origin, viewMode);
  const [tx, ty] = projectToNDC(
    {
      x: origin.x + f.x * worldLength,
      y: origin.y + f.y * worldLength,
      z: origin.z + f.z * worldLength,
    },
    viewMode
  );

  let dx = tx - ox;
  let dy = ty - oy;
  const mag = Math.hypot(dx, dy);
  if (mag < 1e-6) return [1, 0];
  dx /= mag;
  dy /= mag;
  return [dx, dy];
}
