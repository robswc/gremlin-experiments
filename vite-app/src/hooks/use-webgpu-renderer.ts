import { useEffect, useRef } from "react";
import {
  applyViewTransformToNDC,
  ndcToPixel,
  projectDirectionToNDC,
  projectDirectionToNDCOrbit,
  projectToNDC,
  projectToNDCOrbit,
  type CameraOrbit,
  type CameraPan,
  type Orientation,
  type Vector3,
  type ViewMode,
} from "@/lib/projection";

interface Agent {
  id: string;
  friendly: boolean;
  enemy: boolean;
  position: Vector3;
  orientation: Orientation;
}

const SHADER_CODE = /* wgsl */ `
struct VertexOutput {
  @builtin(position) pos: vec4f,
  @location(0) color: vec3f,
};

@group(0) @binding(0) var<uniform> resolution: vec2f;
@group(0) @binding(1) var<storage, read> positions: array<vec4f>;
@group(0) @binding(2) var<storage, read> directions: array<vec4f>;
@group(0) @binding(3) var<storage, read> colors: array<vec4f>;

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VertexOutput {
  let agent_pos = positions[ii];
  let dir = directions[ii].xy;
  let dir_len = max(length(dir), 0.0001);
  let d = dir / dir_len;
  let p = vec2f(-d.y, d.x);

  var shape = array<vec2f, 3>(
    vec2f(12.0, 0.0),
    vec2f(-8.0, 5.0),
    vec2f(-8.0, -5.0),
  );
  let v = shape[vi];
  let offset_px = d * v.x + p * v.y;
  let pixel_offset = offset_px / resolution * 2.0;

  var out: VertexOutput;
  out.pos = vec4f(agent_pos.x + pixel_offset.x, agent_pos.y + pixel_offset.y, 0.0, 1.0);
  out.color = colors[ii].xyz;
  return out;
}

@fragment
fn fs(@location(0) color: vec3f) -> @location(0) vec4f {
  return vec4f(color, 1.0);
}
`;

export function useWebGPURenderer(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  agents: Agent[],
  viewMode: ViewMode,
  zoom: number,
  cameraPan: CameraPan,
  cameraOrbit?: CameraOrbit
) {
  const gpuRef = useRef<{
    device: GPUDevice;
    context: GPUCanvasContext;
    pipeline: GPURenderPipeline;
    resolutionBuffer: GPUBuffer;
    positionBuffer: GPUBuffer;
    directionBuffer: GPUBuffer;
    colorBuffer: GPUBuffer;
    bindGroup: GPUBindGroup;
  } | null>(null);

  const agentsRef = useRef<Agent[]>(agents);

  useEffect(() => {
    agentsRef.current = agents;
  }, [agents]);

  const render2DFallback = (
    canvas: HTMLCanvasElement,
    currentAgents: Agent[],
    currentViewMode: ViewMode,
    currentCameraPan: CameraPan,
    currentCameraOrbit?: CameraOrbit
  ) => {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    if (width === 0 || height === 0) return;

    // Keep this layer transparent so floor/grid overlays beneath stay visible.
    ctx.clearRect(0, 0, width, height);

    for (const agent of currentAgents) {
      const [nx, ny] = currentCameraOrbit ? projectToNDCOrbit(agent.position, currentCameraOrbit) : projectToNDC(agent.position, currentViewMode);
      const [znx, zny] = applyViewTransformToNDC(nx, ny, zoom, currentCameraPan);
      const [px, py] = ndcToPixel(znx, zny, width, height);
      const [dx, dy] = currentCameraOrbit
        ? projectDirectionToNDCOrbit(agent.position, agent.orientation, currentCameraOrbit, 2)
        : projectDirectionToNDC(agent.position, agent.orientation, currentViewMode, 2);

      const perpX = -dy;
      const perpY = dx;
      const scale = Math.max(4, Math.round(7 * devicePixelRatio));

      const tipX = px + dx * scale * 1.8;
      const tipY = py - dy * scale * 1.8;
      const leftX = px - dx * scale + perpX * scale * 0.8;
      const leftY = py + dy * scale - perpY * scale * 0.8;
      const rightX = px - dx * scale - perpX * scale * 0.8;
      const rightY = py + dy * scale + perpY * scale * 0.8;

      ctx.fillStyle = "#fff";
      if (agent.friendly) {
        ctx.fillStyle = "#00ffff";
      } else if (agent.enemy) {
        ctx.fillStyle = "#ff4040";
      }
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(leftX, leftY);
      ctx.lineTo(rightX, rightY);
      ctx.closePath();
      ctx.fill();
    }
  };

  useEffect(() => {
    let cancelled = false;

    async function init() {
      const canvas = canvasRef.current;
      if (!canvas) return;
      if (!navigator.gpu) return;

      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) return;

      const device = await adapter.requestDevice();
      if (cancelled) return;

      const context = canvas.getContext("webgpu");
      if (!context) return;

      const format = navigator.gpu.getPreferredCanvasFormat();
      context.configure({ device, format, alphaMode: "premultiplied" });

      const shaderModule = device.createShaderModule({ code: SHADER_CODE });

      const resolutionBuffer = device.createBuffer({
        size: 8,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });

      const positionBuffer = device.createBuffer({
        size: 256 * 16,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });

      const directionBuffer = device.createBuffer({
        size: 256 * 16,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });

      const colorBuffer = device.createBuffer({
        size: 256 * 16,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });

      const bindGroupLayout = device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } },
          { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
          { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
          { binding: 3, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
        ],
      });

      const pipeline = device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
        vertex: { module: shaderModule, entryPoint: "vs" },
        fragment: { module: shaderModule, entryPoint: "fs", targets: [{ format }] },
        primitive: { topology: "triangle-list" },
      });

      const bindGroup = device.createBindGroup({
        layout: bindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: resolutionBuffer } },
          { binding: 1, resource: { buffer: positionBuffer } },
          { binding: 2, resource: { buffer: directionBuffer } },
          { binding: 3, resource: { buffer: colorBuffer } },
        ],
      });

      gpuRef.current = {
        device,
        context,
        pipeline,
        resolutionBuffer,
        positionBuffer,
        directionBuffer,
        colorBuffer,
        bindGroup,
      };
    }

    init();

    return () => {
      cancelled = true;
      gpuRef.current?.device.destroy();
      gpuRef.current = null;
    };
  }, [canvasRef]);

  useEffect(() => {
    let rafId: number;

    function frame() {
      const gpu = gpuRef.current;
      const canvas = canvasRef.current;
      const currentAgents = agentsRef.current;

      if (canvas && !gpu) {
        render2DFallback(canvas, currentAgents, viewMode, cameraPan, cameraOrbit);
      }

      if (gpu && canvas) {
        const width = canvas.width;
        const height = canvas.height;
        if (width === 0 || height === 0) {
          rafId = requestAnimationFrame(frame);
          return;
        }

        gpu.device.queue.writeBuffer(gpu.resolutionBuffer, 0, new Float32Array([width, height]));

        if (currentAgents.length > 0) {
          const posData = new Float32Array(currentAgents.length * 4);
          const dirData = new Float32Array(currentAgents.length * 4);
          const colorData = new Float32Array(currentAgents.length * 4);

          for (let i = 0; i < currentAgents.length; i++) {
            const [nx, ny] = cameraOrbit ? projectToNDCOrbit(currentAgents[i].position, cameraOrbit) : projectToNDC(currentAgents[i].position, viewMode);
            const [znx, zny] = applyViewTransformToNDC(nx, ny, zoom, cameraPan);
            const [dx, dy] = cameraOrbit
              ? projectDirectionToNDCOrbit(currentAgents[i].position, currentAgents[i].orientation, cameraOrbit, 2)
              : projectDirectionToNDC(currentAgents[i].position, currentAgents[i].orientation, viewMode, 2);

            posData[i * 4 + 0] = znx;
            posData[i * 4 + 1] = zny;
            posData[i * 4 + 2] = 0;
            posData[i * 4 + 3] = 0;

            dirData[i * 4 + 0] = dx;
            dirData[i * 4 + 1] = dy;
            dirData[i * 4 + 2] = 0;
            dirData[i * 4 + 3] = 0;

            if (currentAgents[i].friendly) {
              colorData[i * 4 + 0] = 0;
              colorData[i * 4 + 1] = 1;
              colorData[i * 4 + 2] = 1;
              colorData[i * 4 + 3] = 1;
            } else if (currentAgents[i].enemy) {
              colorData[i * 4 + 0] = 1;
              colorData[i * 4 + 1] = 0.25;
              colorData[i * 4 + 2] = 0.25;
              colorData[i * 4 + 3] = 1;
            } else {
              colorData[i * 4 + 0] = 1;
              colorData[i * 4 + 1] = 1;
              colorData[i * 4 + 2] = 1;
              colorData[i * 4 + 3] = 1;
            }
          }

          gpu.device.queue.writeBuffer(gpu.positionBuffer, 0, posData);
          gpu.device.queue.writeBuffer(gpu.directionBuffer, 0, dirData);
          gpu.device.queue.writeBuffer(gpu.colorBuffer, 0, colorData);
        }

        const encoder = gpu.device.createCommandEncoder();
        const pass = encoder.beginRenderPass({
          colorAttachments: [
            {
              view: gpu.context.getCurrentTexture().createView(),
              clearValue: { r: 0, g: 0, b: 0, a: 0 },
              loadOp: "clear",
              storeOp: "store",
            },
          ],
        });

        if (currentAgents.length > 0) {
          pass.setPipeline(gpu.pipeline);
          pass.setBindGroup(0, gpu.bindGroup);
          pass.draw(3, currentAgents.length);
        }
        pass.end();

        gpu.device.queue.submit([encoder.finish()]);
      }

      rafId = requestAnimationFrame(frame);
    }

    rafId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafId);
  }, [canvasRef, viewMode, zoom, cameraPan, cameraOrbit]);
}
