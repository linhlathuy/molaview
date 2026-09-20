import { elementStyle } from '../src/elements';
import { makeSupercell } from '../src/geometry/supercell';
import type { Atom, Bond, Structure, Vec3 } from '../src/model';
import { basisFromY, compile, cylinderMesh, mat, raySphereHit, sphereMesh, V3, type MeshData } from './gl';

export type DisplayMode = 'ball-and-stick' | 'space-filling' | 'sticks';

export interface DisplayOptions {
  mode: DisplayMode;
  atomScale: number;
  bondScale: number;
  showAtoms: boolean;
  showBonds: boolean;
  showCell: boolean;
  showAxes: boolean;
  showLabels: boolean;
  hiddenElements: ReadonlySet<string>;
  background: number;
}

export interface PreparedRenderStructure {
  structure: Structure;
  stats: { atoms: number; bonds: number; cells: number };
}

export const defaultDisplayOptions: DisplayOptions = {
  mode: 'ball-and-stick',
  atomScale: 1,
  bondScale: 1,
  showAtoms: true,
  showBonds: true,
  showCell: true,
  showAxes: true,
  showLabels: false,
  hiddenElements: new Set(),
  background: 0x17191d
};

function prepareRenderStructure(structure: Structure, repetitions: Vec3): PreparedRenderStructure {
  const expanded = makeSupercell(structure, repetitions);
  return {
    structure: expanded,
    stats: { atoms: expanded.atoms.length, bonds: expanded.bonds.length, cells: expanded.cell ? 1 : 0 }
  };
}

function atomRadius(atom: Atom, options: DisplayOptions): number {
  const style = elementStyle(atom.element);
  if (options.mode === 'space-filling') return style.vanDerWaalsRadius * 0.52 * options.atomScale;
  if (options.mode === 'sticks') return 0.16 * options.atomScale;
  return Math.max(0.2, style.covalentRadius * 0.46) * options.atomScale;
}

function bondEnd(structure: Structure, bond: Bond, atom: Atom): Vec3 {
  if (!bond.offset || !structure.cell) return atom.position;
  const v = structure.cell.vectors;
  return [
    atom.position[0] + bond.offset[0] * v[0][0] + bond.offset[1] * v[1][0] + bond.offset[2] * v[2][0],
    atom.position[1] + bond.offset[0] * v[0][1] + bond.offset[1] * v[1][1] + bond.offset[2] * v[2][1],
    atom.position[2] + bond.offset[0] * v[0][2] + bond.offset[1] * v[1][2] + bond.offset[2] * v[2][2]
  ];
}

const LIT_VERTEX = `
precision mediump float;
attribute vec3 position;
attribute vec3 normal;
attribute vec3 offset;
attribute vec3 axisX;
attribute vec3 axisY;
attribute vec3 axisZ;
attribute vec3 scale;
attribute vec3 color;
uniform mat4 viewProjection;
varying vec3 vNormal;
varying vec3 vColor;
void main() {
  mat3 basis = mat3(axisX, axisY, axisZ);
  vec3 world = basis * (position * scale) + offset;
  vNormal = normalize(basis * (normal / max(scale, vec3(0.0001))));
  vColor = color;
  gl_Position = viewProjection * vec4(world, 1.0);
}`;

// Hemisphere ambient + a single key light, approximating the previous MeshStandardMaterial look.
const LIT_FRAGMENT = `
precision mediump float;
varying vec3 vNormal;
varying vec3 vColor;
uniform vec3 keyDirection;
void main() {
  vec3 n = normalize(vNormal);
  float hemi = 0.5 + 0.5 * n.y;
  vec3 ambient = mix(vec3(0.188, 0.200, 0.227), vec3(1.0), hemi) * 0.55;
  float key = max(dot(n, keyDirection), 0.0);
  vec3 lit = vColor * (ambient + key * 0.85);
  float rim = pow(1.0 - max(n.z, 0.0), 3.0) * 0.05;
  gl_FragColor = vec4(pow(clamp(lit + rim, 0.0, 1.0), vec3(1.0 / 2.2)), 1.0);
}`;

const FLAT_VERTEX = `
precision mediump float;
attribute vec3 position;
uniform mat4 viewProjection;
void main() { gl_Position = viewProjection * vec4(position, 1.0); }`;

const FLAT_FRAGMENT = `
precision mediump float;
uniform vec4 color;
void main() { gl_FragColor = color; }`;

const SPRITE_VERTEX = `
precision mediump float;
attribute vec2 corner;
uniform mat4 viewProjection;
uniform vec3 center;
uniform vec2 size;
uniform vec3 right;
uniform vec3 up;
varying vec2 vUv;
void main() {
  vUv = corner + 0.5;
  vec3 world = center + right * (corner.x * size.x) + up * (corner.y * size.y);
  gl_Position = viewProjection * vec4(world, 1.0);
}`;

const SPRITE_FRAGMENT = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D map;
void main() {
  vec4 texel = texture2D(map, vec2(vUv.x, 1.0 - vUv.y));
  if (texel.a < 0.01) discard;
  gl_FragColor = texel;
}`;

interface InstanceBatch {
  mesh: GpuMesh;
  count: number;
  offset: Float32Array;
  axisX: Float32Array;
  axisY: Float32Array;
  axisZ: Float32Array;
  scale: Float32Array;
  color: Float32Array;
}

interface GpuMesh {
  position: WebGLBuffer;
  normal: WebGLBuffer;
  index: WebGLBuffer;
  count: number;
}

interface Label {
  texture: WebGLTexture;
  center: V3;
  width: number;
  height: number;
}

export class MolecularScene {
  private readonly gl: WebGLRenderingContext;
  private readonly instanced: ANGLE_instanced_arrays;
  private readonly litProgram: WebGLProgram;
  private readonly flatProgram: WebGLProgram;
  private readonly spriteProgram: WebGLProgram;
  private readonly sphereHigh: GpuMesh;
  private readonly sphereLow: GpuMesh;
  private readonly cylinder: GpuMesh;
  private readonly instanceBuffers: Record<'offset' | 'axisX' | 'axisY' | 'axisZ' | 'scale' | 'color', WebGLBuffer>;
  private readonly lineBuffer: WebGLBuffer;
  private readonly spriteBuffer: WebGLBuffer;
  private readonly resizeObserver: ResizeObserver;

  private structure?: Structure;
  private source?: Structure;
  private options: DisplayOptions = defaultDisplayOptions;
  private repetitions: Vec3 = [1, 1, 1];
  private selectedId: number | undefined;
  private animation = 0;
  private dirty = true;


  // Camera state; orbit is expressed as a target plus a spherical offset.
  private orthographic = false;
  private readonly target = new V3();
  private readonly position = new V3(8, 6, 10);
  private readonly up = new V3(0, 1, 0);
  private near = 0.01;
  private far = 100000;
  private zoom = 1;
  private viewProjection = mat.identity();

  private atoms: Atom[] = [];
  private atomCenters = new Float32Array(0);
  private atomRadii = new Float32Array(0);
  private atomBatch: InstanceBatch | undefined;
  private bondBatch: InstanceBatch | undefined;
  private cellLines: { buffer: WebGLBuffer; count: number } | undefined;
  /** One entry per axis arm so each can carry its own colour. */
  private axisLines: Array<{ buffer: WebGLBuffer; count: number; color: [number, number, number, number] }> = [];
  private labels: Label[] = [];

  constructor(private readonly canvas: HTMLCanvasElement, private readonly onSelect: (atom: Atom | undefined) => void) {
    const gl = canvas.getContext('webgl', { antialias: true, alpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL is not available');
    this.gl = gl;
    const instanced = gl.getExtension('ANGLE_instanced_arrays');
    if (!instanced) throw new Error('ANGLE_instanced_arrays is not available');
    this.instanced = instanced;
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    this.litProgram = compile(gl, LIT_VERTEX, LIT_FRAGMENT);
    this.flatProgram = compile(gl, FLAT_VERTEX, FLAT_FRAGMENT);
    this.spriteProgram = compile(gl, SPRITE_VERTEX, SPRITE_FRAGMENT);
    this.sphereHigh = this.upload(sphereMesh(24, 16));
    this.sphereLow = this.upload(sphereMesh(10, 8));
    this.cylinder = this.upload(cylinderMesh(12));
    this.instanceBuffers = {
      offset: gl.createBuffer()!, axisX: gl.createBuffer()!, axisY: gl.createBuffer()!,
      axisZ: gl.createBuffer()!, scale: gl.createBuffer()!, color: gl.createBuffer()!
    };
    this.lineBuffer = gl.createBuffer()!;
    this.spriteBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.spriteBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]), gl.STATIC_DRAW);

    this.resizeObserver = new ResizeObserver(() => { this.dirty = true; });
    this.resizeObserver.observe(canvas);
    this.attachControls();
    this.resize();
    this.animate();
  }

  private upload(data: MeshData): GpuMesh {
    const gl = this.gl;
    const position = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, position);
    gl.bufferData(gl.ARRAY_BUFFER, data.positions, gl.STATIC_DRAW);
    const normal = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, normal);
    gl.bufferData(gl.ARRAY_BUFFER, data.normals, gl.STATIC_DRAW);
    const index = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data.indices, gl.STATIC_DRAW);
    return { position, normal, index, count: data.indices.length };
  }

  // --- camera controls (orbit / pan / dolly) ---

  private attachControls(): void {
    const canvas = this.canvas;
    let mode: 'rotate' | 'pan' | undefined;
    let lastX = 0, lastY = 0, moved = 0;
    const onDown = (event: PointerEvent): void => {
      mode = event.button === 0 ? 'rotate' : event.button === 2 ? 'pan' : undefined;
      lastX = event.clientX; lastY = event.clientY; moved = 0;
      if (mode) canvas.setPointerCapture(event.pointerId);
    };
    const onMove = (event: PointerEvent): void => {
      if (!mode) return;
      const dx = event.clientX - lastX, dy = event.clientY - lastY;
      lastX = event.clientX; lastY = event.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      if (mode === 'rotate') this.orbit(dx, dy); else this.pan(dx, dy);
      this.dirty = true;
    };
    const onUp = (event: PointerEvent): void => {
      if (mode && canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      // Only treat a near-stationary release as a click, so orbiting never changes selection.
      if (event.button === 0 && moved < 5) this.pick(event);
      mode = undefined;
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', () => { mode = undefined; });
    canvas.addEventListener('contextmenu', event => event.preventDefault());
    canvas.addEventListener('wheel', event => {
      event.preventDefault();
      this.dolly(Math.pow(0.95, -Math.sign(event.deltaY)));
      this.dirty = true;
    }, { passive: false });
  }

  private orbit(dx: number, dy: number): void {
    const offset = this.position.clone().sub(this.target);
    const radius = offset.length();
    if (!radius) return;
    /*
     * Spherical angles about the current up axis. This used to measure the polar
     * angle against world Y no matter where up pointed, so aligning along the b
     * axis - which flips up to Z because the view direction is parallel to Y -
     * left the camera sitting exactly on the orbit's pole. phi clamped to 0.001
     * and dragging moved the camera about 0.02 units out of 20, which reads as
     * rotation being dead. Building the frame from up keeps the poles where the
     * user sees them, whichever axis is up.
     */
    const pole = this.up.clone().normalize();
    // Any two axes perpendicular to the pole complete the frame; seed the first
    // from whichever world axis is least parallel to it so the cross is stable.
    const seed = Math.abs(pole.x) < 0.9 ? new V3(1, 0, 0) : new V3(0, 1, 0);
    // Ordered so that a Y pole yields exactly the world X and Z axes, keeping
    // the ordinary case bit-for-bit identical to the plain spherical form.
    const basisZ = seed.clone().cross(pole).normalize();
    const basisX = pole.clone().cross(basisZ).normalize();
    const height = offset.dot(pole);
    let theta = Math.atan2(offset.dot(basisX), offset.dot(basisZ));
    let phi = Math.acos(Math.min(1, Math.max(-1, height / radius)));
    theta -= (dx / this.canvas.clientWidth) * Math.PI * 2;
    phi -= (dy / this.canvas.clientHeight) * Math.PI;
    phi = Math.min(Math.PI - 0.001, Math.max(0.001, phi));
    const sinPhi = Math.sin(phi), cosPhi = Math.cos(phi);
    this.position.copy(this.target)
      .addScaled(basisX, radius * sinPhi * Math.sin(theta))
      .addScaled(pole, radius * cosPhi)
      .addScaled(basisZ, radius * sinPhi * Math.cos(theta));
  }

  private pan(dx: number, dy: number): void {
    const offset = this.position.clone().sub(this.target);
    const distance = offset.length();
    const forward = offset.clone().normalize();
    const right = this.up.clone().cross(forward).normalize();
    const up = forward.clone().cross(right).normalize();
    // Scale screen pixels to world units at the target plane.
    const height = this.orthographic
      ? (2 * 10) / this.zoom
      : 2 * distance * Math.tan((38 * Math.PI) / 360);
    const scale = height / Math.max(1, this.canvas.clientHeight);
    const shift = right.scale(-dx * scale).add(up.scale(dy * scale));
    this.position.add(shift);
    this.target.add(shift);
  }

  private dolly(factor: number): void {
    if (this.orthographic) {
      this.zoom = Math.min(1000, Math.max(0.001, this.zoom / factor));
      return;
    }
    const offset = this.position.clone().sub(this.target);
    const distance = Math.min(1e6, Math.max(0.05, offset.length() * factor));
    this.position.copy(this.target).addScaled(offset.normalize(), distance);
  }

  // --- scene assembly ---

  setStructure(structure: Structure, fit = true): void {
    this.source = structure;
    this.rebuild();
    if (fit) this.fit();
    this.dirty = true;
  }

  setSupercell(repetitions: Vec3): void {
    this.repetitions = repetitions;
    this.rebuild();
    this.fit();
    this.dirty = true;
  }

  setDisplayOptions(options: Partial<DisplayOptions>): void {
    this.options = { ...this.options, ...options };
    this.rebuild();
    this.dirty = true;
  }

  private rebuild(): void {
    if (!this.source) return;
    this.releaseScene();
    const prepared = prepareRenderStructure(this.source, this.repetitions);
    this.structure = prepared.structure;
    this.atoms = this.structure.atoms.filter(atom => !this.options.hiddenElements.has(atom.element));
    this.buildAtoms();
    this.buildBonds();
    this.buildCell();
    this.buildAxes();
    this.buildLabels();
    this.dirty = true;
  }

  private buildAtoms(): void {
    const atoms = this.atoms;
    this.atomCenters = new Float32Array(atoms.length * 3);
    this.atomRadii = new Float32Array(atoms.length);
    atoms.forEach((atom, i) => {
      this.atomCenters[i * 3] = atom.position[0];
      this.atomCenters[i * 3 + 1] = atom.position[1];
      this.atomCenters[i * 3 + 2] = atom.position[2];
      this.atomRadii[i] = atomRadius(atom, this.options) * (atom.id === this.selectedId ? 1.24 : 1);
    });
    if (!this.options.showAtoms || !atoms.length) return;
    const batch = this.createBatch(atoms.length > 5000 ? this.sphereLow : this.sphereHigh, atoms.length);
    atoms.forEach((atom, i) => {
      const r = this.atomRadii[i]!;
      batch.offset.set([atom.position[0], atom.position[1], atom.position[2]], i * 3);
      batch.axisX.set([1, 0, 0], i * 3);
      batch.axisY.set([0, 1, 0], i * 3);
      batch.axisZ.set([0, 0, 1], i * 3);
      batch.scale.set([r, r, r], i * 3);
      const hex = elementStyle(atom.element).color;
      batch.color.set([((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255], i * 3);
    });
    this.uploadBatch(batch);
    this.atomBatch = batch;
  }

  private buildBonds(): void {
    if (!this.structure || !this.options.showBonds || this.options.mode === 'space-filling') return;
    const visible = new Set(this.atoms.map(atom => atom.id));
    const byId = new Map(this.structure.atoms.map(atom => [atom.id, atom]));
    const bonds = this.structure.bonds.filter(bond => visible.has(bond.a) && visible.has(bond.b));
    if (!bonds.length) return;
    const batch = this.createBatch(this.cylinder, bonds.length);
    const radius = 0.09 * this.options.bondScale;
    bonds.forEach((bond, i) => {
      const from = byId.get(bond.a)!;
      const toAtom = byId.get(bond.b)!;
      const start = V3.from(from.position);
      const end = V3.from(bondEnd(this.structure!, bond, toAtom));
      const direction = end.clone().sub(start);
      const length = direction.length();
      const basis = basisFromY(direction);
      const mid = start.clone().add(end).scale(0.5);
      batch.offset.set([mid.x, mid.y, mid.z], i * 3);
      batch.axisX.set([basis.x.x, basis.x.y, basis.x.z], i * 3);
      batch.axisY.set([basis.y.x, basis.y.y, basis.y.z], i * 3);
      batch.axisZ.set([basis.z.x, basis.z.y, basis.z.z], i * 3);
      batch.scale.set([radius, length, radius], i * 3);
      batch.color.set([0.647, 0.663, 0.690], i * 3);
    });
    this.uploadBatch(batch);
    this.bondBatch = batch;
  }

  private createBatch(mesh: GpuMesh, count: number): InstanceBatch {
    return {
      mesh, count,
      offset: new Float32Array(count * 3), axisX: new Float32Array(count * 3),
      axisY: new Float32Array(count * 3), axisZ: new Float32Array(count * 3),
      scale: new Float32Array(count * 3), color: new Float32Array(count * 3)
    };
  }

  private uploadBatch(batch: InstanceBatch): void {
    const gl = this.gl;
    for (const key of ['offset', 'axisX', 'axisY', 'axisZ', 'scale', 'color'] as const) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffers[key]);
      gl.bufferData(gl.ARRAY_BUFFER, batch[key], gl.DYNAMIC_DRAW);
    }
  }

  private buildCell(): void {
    if (!this.structure?.cell || !this.options.showCell) return;
    const [av, bv, cv] = this.structure.cell.vectors;
    const a = V3.from(av), b = V3.from(bv), c = V3.from(cv);
    const corners = [
      new V3(), a, b, c,
      a.clone().add(b), a.clone().add(c), b.clone().add(c), a.clone().add(b).add(c)
    ];
    const edges = [[0,1],[0,2],[0,3],[1,4],[1,5],[2,4],[2,6],[3,5],[3,6],[4,7],[5,7],[6,7]];
    const points = new Float32Array(edges.length * 6);
    edges.forEach((edge, i) => {
      const p = corners[edge[0]!]!, q = corners[edge[1]!]!;
      points.set([p.x, p.y, p.z, q.x, q.y, q.z], i * 6);
    });
    const buffer = this.gl.createBuffer()!;
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, buffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, points, this.gl.STATIC_DRAW);
    this.cellLines = { buffer, count: edges.length * 2 };
  }

  /**
   * Unit arms about the origin. They are drawn as a fixed-size corner gizmo
   * rather than in world space, so the structure can never cover them and they
   * keep a constant size at any zoom; drawAxes() supplies the placement.
   */
  private buildAxes(): void {
    if (!this.options.showAxes) return;
    // Conventional a/b/c -> red/green/blue, so the orientation reads at a glance.
    const arms: Array<{ tip: [number, number, number]; color: [number, number, number, number] }> = [
      { tip: [1, 0, 0], color: [0.91, 0.30, 0.34, 0.95] },
      { tip: [0, 1, 0], color: [0.46, 0.80, 0.36, 0.95] },
      { tip: [0, 0, 1], color: [0.35, 0.60, 0.95, 0.95] }
    ];
    this.axisLines = arms.map(({ tip, color }) => {
      const buffer = this.gl.createBuffer()!;
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, buffer);
      this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array([0, 0, 0, ...tip]), this.gl.STATIC_DRAW);
      return { buffer, count: 2, color };
    });
  }

  /**
   * Corner orientation gizmo: takes only the camera's rotation, so the arms
   * turn with the scene but stay pinned to the bottom-left at a constant size.
   */
  private drawAxes(): void {
    if (!this.axisLines.length) return;
    const gl = this.gl;
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    // Fixed pixel footprint: an arm of unit length spans sizePx on screen.
    const sizePx = 42;
    const marginPx = 18;
    // Unit arms map to sizePx, then the whole gizmo shifts to the corner. Both
    // are expressed directly in NDC (-1..1 across the canvas).
    const scaleX = (2 * sizePx) / width;
    const scaleY = (2 * sizePx) / height;
    const centreX = -1 + (2 * (marginPx + sizePx)) / width;
    const centreY = -1 + (2 * (marginPx + sizePx)) / height;
    const placement = new Float32Array([
      scaleX, 0, 0, 0,
      0, scaleY, 0, 0,
      0, 0, 0.001, 0,
      centreX, centreY, 0, 1
    ]);
    const direction = this.position.clone().sub(this.target).normalize();
    const view = mat.lookAt(direction, new V3(0, 0, 0), this.up);
    const matrix = mat.multiply(placement, view);
    gl.disable(gl.DEPTH_TEST);
    for (const arm of this.axisLines) this.drawLines(arm, arm.color, matrix);
    gl.enable(gl.DEPTH_TEST);
  }

  private buildLabels(): void {
    if (!this.structure || !this.options.showLabels || this.structure.atoms.length > 500) return;
    const gl = this.gl;
    for (const [index, atom] of this.atoms.entries()) {
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 48;
      const context = canvas.getContext('2d');
      if (!context) continue;
      context.font = '600 24px system-ui';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillStyle = '#ffffff';
      context.strokeStyle = '#111318';
      context.lineWidth = 5;
      const text = atom.label ?? `${atom.element}${(atom.sourceId ?? atom.id) + 1}`;
      context.strokeText(text, 64, 24);
      context.fillText(text, 64, 24);
      const texture = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const offset = (this.atomRadii[index] ?? 0) + 0.32;
      this.labels.push({
        texture,
        center: new V3(atom.position[0], atom.position[1] + offset, atom.position[2]),
        width: 1.8,
        height: 0.68
      });
    }
  }

  // --- camera framing ---

  private bounds(): { min: V3; max: V3 } {
    const min = new V3(Infinity, Infinity, Infinity);
    const max = new V3(-Infinity, -Infinity, -Infinity);
    for (const atom of this.atoms) {
      min.set(Math.min(min.x, atom.position[0]), Math.min(min.y, atom.position[1]), Math.min(min.z, atom.position[2]));
      max.set(Math.max(max.x, atom.position[0]), Math.max(max.y, atom.position[1]), Math.max(max.z, atom.position[2]));
    }
    if (!Number.isFinite(min.x)) { min.set(0, 0, 0); max.set(0, 0, 0); }
    return { min, max };
  }

  private center(): V3 {
    const { min, max } = this.bounds();
    return new V3((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2);
  }

  private extent(): number {
    const { min, max } = this.bounds();
    return Math.max(1, Math.hypot(max.x - min.x, max.y - min.y, max.z - min.z));
  }

  /** Bounding sphere radius around the centre, including atom radii. */
  private boundingRadius(): number {
    const center = this.center();
    let radius = 0;
    this.atoms.forEach((atom, i) => {
      const distance = Math.hypot(
        atom.position[0] - center.x,
        atom.position[1] - center.y,
        atom.position[2] - center.z
      );
      radius = Math.max(radius, distance + (this.atomRadii[i] ?? 0));
    });
    if (this.structure?.cell && this.options.showCell) {
      const v = this.structure.cell.vectors;
      for (let corner = 0; corner < 8; corner++) {
        const x = (corner & 1 ? 1 : 0), y = (corner & 2 ? 1 : 0), z = (corner & 4 ? 1 : 0);
        radius = Math.max(radius, Math.hypot(
          x * v[0][0] + y * v[1][0] + z * v[2][0] - center.x,
          x * v[0][1] + y * v[1][1] + z * v[2][1] - center.y,
          x * v[0][2] + y * v[1][2] + z * v[2][2] - center.z
        ));
      }
    }
    return Math.max(1, radius);
  }

  fit(): void {
    const center = this.center();
    const radius = this.boundingRadius() * 1.1;
    const direction = this.position.clone().sub(this.target);
    if (!direction.length()) direction.set(1, 0.7, 1);
    direction.normalize();
    this.target.copy(center);
    // Fit against whichever of the vertical/horizontal half-angles is tighter.
    const aspect = Math.max(0.1, (this.canvas.clientWidth || 1) / (this.canvas.clientHeight || 1));
    const vertical = (38 * Math.PI) / 360;
    const horizontal = Math.atan(Math.tan(vertical) * aspect);
    const distance = radius / Math.sin(Math.min(vertical, horizontal));
    this.position.copy(center).addScaled(direction, distance);
    this.near = Math.max(0.01, distance / 1000);
    this.far = Math.max(100, distance + radius * 10);
    this.zoom = 10 / radius * Math.min(1, aspect);
    this.dirty = true;
  }

  align(axis: 0 | 1 | 2): void {
    if (!this.structure?.cell) return;
    const direction = V3.from(this.structure.cell.vectors[axis]).normalize();
    const center = this.center();
    this.target.copy(center);
    this.position.copy(center).addScaled(direction, this.extent() * 2.5);
    this.up.set(0, 1, 0);
    if (Math.abs(direction.dot(this.up)) > 0.95) this.up.set(0, 0, 1);
    this.dirty = true;
  }

  setOrthographic(enabled: boolean): void {
    this.orthographic = enabled;
    this.fit();
  }

  // --- picking ---

  private pick(event: PointerEvent): void {
    if (!this.atoms.length) { this.onSelect(undefined); return; }
    const rect = this.canvas.getBoundingClientRect();
    const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
    const inverse = mat.invert(this.viewProjection);
    const nearPoint = new V3(ndcX, ndcY, -1).applyMat4(inverse);
    const farPoint = new V3(ndcX, ndcY, 1).applyMat4(inverse);
    const direction = farPoint.clone().sub(nearPoint).normalize();
    const index = raySphereHit(nearPoint, direction, this.atomCenters, this.atomRadii);
    const atom = index < 0 ? undefined : this.atoms[index];
    this.selectedId = atom?.id;
    this.onSelect(atom);
    this.rebuild();
  }

  // --- drawing ---

  private updateCamera(): void {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    const aspect = width / height;
    const projection = this.orthographic
      ? mat.orthographic(-10 * aspect / this.zoom, 10 * aspect / this.zoom, 10 / this.zoom, -10 / this.zoom, this.near, this.far)
      : mat.perspective(38, aspect, this.near, this.far);
    const view = mat.lookAt(this.position, this.target, this.up);
    this.viewProjection = mat.multiply(projection, view);
  }

  private resize(): void {
    const ratio = Math.min(devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor(this.canvas.clientWidth * ratio));
    const height = Math.max(1, Math.floor(this.canvas.clientHeight * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  private drawBatch(batch: InstanceBatch): void {
    const gl = this.gl, ext = this.instanced, program = this.litProgram;
    this.uploadBatch(batch);
    const bindInstance = (name: string, buffer: WebGLBuffer): void => {
      const location = gl.getAttribLocation(program, name);
      if (location < 0) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, 3, gl.FLOAT, false, 0, 0);
      ext.vertexAttribDivisorANGLE(location, 1);
    };
    const bindVertex = (name: string, buffer: WebGLBuffer): void => {
      const location = gl.getAttribLocation(program, name);
      if (location < 0) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, 3, gl.FLOAT, false, 0, 0);
      ext.vertexAttribDivisorANGLE(location, 0);
    };
    bindVertex('position', batch.mesh.position);
    bindVertex('normal', batch.mesh.normal);
    bindInstance('offset', this.instanceBuffers.offset);
    bindInstance('axisX', this.instanceBuffers.axisX);
    bindInstance('axisY', this.instanceBuffers.axisY);
    bindInstance('axisZ', this.instanceBuffers.axisZ);
    bindInstance('scale', this.instanceBuffers.scale);
    bindInstance('color', this.instanceBuffers.color);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, batch.mesh.index);
    ext.drawElementsInstancedANGLE(gl.TRIANGLES, batch.mesh.count, gl.UNSIGNED_SHORT, 0, batch.count);
    // Reset divisors so the non-instanced passes below are not affected.
    for (const name of ['offset', 'axisX', 'axisY', 'axisZ', 'scale', 'color']) {
      const location = gl.getAttribLocation(program, name);
      if (location >= 0) { ext.vertexAttribDivisorANGLE(location, 0); gl.disableVertexAttribArray(location); }
    }
  }

  private drawLines(lines: { buffer: WebGLBuffer; count: number }, rgba: [number, number, number, number], matrix = this.viewProjection): void {
    const gl = this.gl, program = this.flatProgram;
    gl.useProgram(program);
    gl.uniformMatrix4fv(gl.getUniformLocation(program, 'viewProjection'), false, matrix);
    gl.uniform4f(gl.getUniformLocation(program, 'color'), ...rgba);
    const location = gl.getAttribLocation(program, 'position');
    gl.bindBuffer(gl.ARRAY_BUFFER, lines.buffer);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 3, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.LINES, 0, lines.count);
    gl.disableVertexAttribArray(location);
  }

  private drawLabels(): void {
    if (!this.labels.length) return;
    const gl = this.gl, program = this.spriteProgram;
    gl.useProgram(program);
    gl.disable(gl.DEPTH_TEST);
    gl.uniformMatrix4fv(gl.getUniformLocation(program, 'viewProjection'), false, this.viewProjection);
    // Billboard basis from the current view direction.
    const forward = this.position.clone().sub(this.target).normalize();
    const right = this.up.clone().cross(forward).normalize();
    const up = forward.clone().cross(right).normalize();
    gl.uniform3f(gl.getUniformLocation(program, 'right'), right.x, right.y, right.z);
    gl.uniform3f(gl.getUniformLocation(program, 'up'), up.x, up.y, up.z);
    const location = gl.getAttribLocation(program, 'corner');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.spriteBuffer);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(gl.getUniformLocation(program, 'map'), 0);
    for (const label of this.labels) {
      gl.bindTexture(gl.TEXTURE_2D, label.texture);
      gl.uniform3f(gl.getUniformLocation(program, 'center'), label.center.x, label.center.y, label.center.z);
      gl.uniform2f(gl.getUniformLocation(program, 'size'), label.width, label.height);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    gl.disableVertexAttribArray(location);
    gl.enable(gl.DEPTH_TEST);
  }

  private render(): void {
    const gl = this.gl;
    this.resize();
    this.updateCamera();
    const background = this.options.background;
    gl.clearColor(((background >> 16) & 255) / 255, ((background >> 8) & 255) / 255, (background & 255) / 255, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    if (this.atomBatch || this.bondBatch) {
      gl.useProgram(this.litProgram);
      gl.uniformMatrix4fv(gl.getUniformLocation(this.litProgram, 'viewProjection'), false, this.viewProjection);
      const key = new V3(7, 10, 12).normalize();
      gl.uniform3f(gl.getUniformLocation(this.litProgram, 'keyDirection'), key.x, key.y, key.z);
      if (this.atomBatch) this.drawBatch(this.atomBatch);
      if (this.bondBatch) this.drawBatch(this.bondBatch);
    }
    if (this.cellLines) this.drawLines(this.cellLines, [0.561, 0.580, 0.620, 0.72]);
    this.drawAxes();
    this.drawLabels();
  }

  private animate = (): void => {
    this.animation = requestAnimationFrame(this.animate);
    if (!this.dirty) return;
    this.dirty = false;
    this.render();
  };

  screenshot(): Uint8Array {
    this.render();
    const data = this.canvas.toDataURL('image/png').split(',')[1] ?? '';
    const binary = atob(data);
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  }

  /**
   * Raw RGBA of the current view, for frame-by-frame capture. readPixels gives
   * bottom-up rows, so they are flipped here to the top-down order images use.
   */
  capturePixels(): { data: Uint8Array; width: number; height: number } {
    this.render();
    const gl = this.gl;
    const width = this.canvas.width;
    const height = this.canvas.height;
    const flipped = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, flipped);
    const data = new Uint8Array(width * height * 4);
    const stride = width * 4;
    for (let row = 0; row < height; row += 1) {
      data.set(flipped.subarray((height - 1 - row) * stride, (height - row) * stride), row * stride);
    }
    return { data, width, height };
  }

  stats(): PreparedRenderStructure['stats'] {
    return { atoms: this.structure?.atoms.length ?? 0, bonds: this.structure?.bonds.length ?? 0, cells: this.structure?.cell ? 1 : 0 };
  }

  private releaseScene(): void {
    const gl = this.gl;
    if (this.cellLines) gl.deleteBuffer(this.cellLines.buffer);
    for (const arm of this.axisLines) gl.deleteBuffer(arm.buffer);
    for (const label of this.labels) gl.deleteTexture(label.texture);
    this.cellLines = undefined;
    this.axisLines = [];
    this.labels = [];
    this.atomBatch = undefined;
    this.bondBatch = undefined;
  }

  dispose(): void {
    cancelAnimationFrame(this.animation);
    this.resizeObserver.disconnect();
    this.releaseScene();
    const gl = this.gl;
    for (const mesh of [this.sphereHigh, this.sphereLow, this.cylinder]) {
      gl.deleteBuffer(mesh.position);
      gl.deleteBuffer(mesh.normal);
      gl.deleteBuffer(mesh.index);
    }
    for (const buffer of Object.values(this.instanceBuffers)) gl.deleteBuffer(buffer);
    gl.deleteBuffer(this.lineBuffer);
    gl.deleteBuffer(this.spriteBuffer);
    gl.deleteProgram(this.litProgram);
    gl.deleteProgram(this.flatProgram);
    gl.deleteProgram(this.spriteProgram);
  }
}
