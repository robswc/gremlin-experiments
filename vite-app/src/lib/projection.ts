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

export const WORLD_HALF_EXTENT = 64;
export const FLOOR_Y = 0;

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
