// Minimal WebGPU type declarations
// These are ambient types so TypeScript knows about the WebGPU API.

interface GPU {
  requestAdapter(): Promise<GPUAdapter | null>;
  getPreferredCanvasFormat(): GPUTextureFormat;
}

interface Navigator {
  readonly gpu: GPU;
}

interface GPUAdapter {
  requestDevice(): Promise<GPUDevice>;
}

interface GPUDevice {
  createShaderModule(desc: { code: string }): GPUShaderModule;
  createBuffer(desc: GPUBufferDescriptor): GPUBuffer;
  createBindGroupLayout(desc: GPUBindGroupLayoutDescriptor): GPUBindGroupLayout;
  createPipelineLayout(desc: { bindGroupLayouts: GPUBindGroupLayout[] }): GPUPipelineLayout;
  createRenderPipeline(desc: GPURenderPipelineDescriptor): GPURenderPipeline;
  createBindGroup(desc: GPUBindGroupDescriptor): GPUBindGroup;
  createCommandEncoder(): GPUCommandEncoder;
  readonly queue: GPUQueue;
  destroy(): void;
}

interface GPUQueue {
  writeBuffer(buffer: GPUBuffer, offset: number, data: BufferSource): void;
  submit(buffers: GPUCommandBuffer[]): void;
}

interface GPUBuffer {
  readonly size: number;
}

interface GPUBufferDescriptor {
  size: number;
  usage: number;
  mappedAtCreation?: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
declare const GPUBufferUsage: {
  UNIFORM: number;
  STORAGE: number;
  COPY_DST: number;
  COPY_SRC: number;
  VERTEX: number;
  INDEX: number;
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
declare const GPUShaderStage: {
  VERTEX: number;
  FRAGMENT: number;
  COMPUTE: number;
};

type GPUTextureFormat = string;

interface GPUShaderModule {}
interface GPUBindGroupLayout {}
interface GPUPipelineLayout {}
interface GPURenderPipeline {}
interface GPUCommandBuffer {}

interface GPUBindGroupDescriptor {
  layout: GPUBindGroupLayout;
  entries: GPUBindGroupEntry[];
}

interface GPUBindGroupEntry {
  binding: number;
  resource: { buffer: GPUBuffer };
}

interface GPUBindGroup {}

interface GPUBindGroupLayoutDescriptor {
  entries: GPUBindGroupLayoutEntry[];
}

interface GPUBindGroupLayoutEntry {
  binding: number;
  visibility: number;
  buffer?: { type: string };
}

interface GPURenderPipelineDescriptor {
  layout: GPUPipelineLayout;
  vertex: { module: GPUShaderModule; entryPoint: string };
  fragment: {
    module: GPUShaderModule;
    entryPoint: string;
    targets: { format: GPUTextureFormat }[];
  };
  primitive?: { topology: string };
}

interface GPUCommandEncoder {
  beginRenderPass(desc: GPURenderPassDescriptor): GPURenderPassEncoder;
  finish(): GPUCommandBuffer;
}

interface GPURenderPassDescriptor {
  colorAttachments: GPURenderPassColorAttachment[];
}

interface GPURenderPassColorAttachment {
  view: GPUTextureView;
  clearValue: { r: number; g: number; b: number; a: number };
  loadOp: string;
  storeOp: string;
}

interface GPUTextureView {}

interface GPUTexture {
  createView(): GPUTextureView;
}

interface GPURenderPassEncoder {
  setPipeline(pipeline: GPURenderPipeline): void;
  setBindGroup(index: number, group: GPUBindGroup): void;
  draw(vertexCount: number, instanceCount?: number): void;
  end(): void;
}

interface GPUCanvasContext {
  configure(config: { device: GPUDevice; format: GPUTextureFormat; alphaMode?: string }): void;
  getCurrentTexture(): GPUTexture;
}

interface HTMLCanvasElement {
  getContext(contextId: "webgpu"): GPUCanvasContext | null;
}
