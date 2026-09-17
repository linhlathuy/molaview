// Minimal WebGL layer: just enough math, geometry and draw calls for the viewer.
// Replaces three.js, which cost ~515 KB minified for a handful of primitives.

export type Vec = [number, number, number];

export class V3 {
  constructor(public x = 0, public y = 0, public z = 0) {}
  static from(v: Vec): V3 { return new V3(v[0], v[1], v[2]); }
  set(x: number, y: number, z: number): this { this.x = x; this.y = y; this.z = z; return this; }
  copy(v: V3): this { return this.set(v.x, v.y, v.z); }
  clone(): V3 { return new V3(this.x, this.y, this.z); }
  add(v: V3): this { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  sub(v: V3): this { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  addScaled(v: V3, s: number): this { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  scale(s: number): this { this.x *= s; this.y *= s; this.z *= s; return this; }
  dot(v: V3): number { return this.x * v.x + this.y * v.y + this.z * v.z; }
  cross(v: V3): this {
    const { x, y, z } = this;
    return this.set(y * v.z - z * v.y, z * v.x - x * v.z, x * v.y - y * v.x);
  }
  length(): number { return Math.hypot(this.x, this.y, this.z); }
  normalize(): this { const l = this.length(); return l ? this.scale(1 / l) : this; }
  distanceTo(v: V3): number { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
  applyMat4(m: Float32Array): this {
    const { x, y, z } = this;
    const w = m[3]! * x + m[7]! * y + m[11]! * z + m[15]! || 1;
    return this.set(
      (m[0]! * x + m[4]! * y + m[8]! * z + m[12]!) / w,
      (m[1]! * x + m[5]! * y + m[9]! * z + m[13]!) / w,
      (m[2]! * x + m[6]! * y + m[10]! * z + m[14]!) / w
    );
  }
}

/** Column-major 4x4, matching WebGL's uniformMatrix4fv layout. */
export const mat = {
  identity(): Float32Array {
    return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  },
  multiply(a: Float32Array, b: Float32Array, out = new Float32Array(16)): Float32Array {
    for (let c = 0; c < 4; c++) {
      const b0 = b[c * 4]!, b1 = b[c * 4 + 1]!, b2 = b[c * 4 + 2]!, b3 = b[c * 4 + 3]!;
      out[c * 4] = a[0]! * b0 + a[4]! * b1 + a[8]! * b2 + a[12]! * b3;
      out[c * 4 + 1] = a[1]! * b0 + a[5]! * b1 + a[9]! * b2 + a[13]! * b3;
      out[c * 4 + 2] = a[2]! * b0 + a[6]! * b1 + a[10]! * b2 + a[14]! * b3;
      out[c * 4 + 3] = a[3]! * b0 + a[7]! * b1 + a[11]! * b2 + a[15]! * b3;
    }
    return out;
  },
  perspective(fovDeg: number, aspect: number, near: number, far: number): Float32Array {
    const f = 1 / Math.tan((fovDeg * Math.PI) / 360);
    const out = new Float32Array(16);
    out[0] = f / aspect; out[5] = f;
    out[10] = (far + near) / (near - far); out[11] = -1;
    out[14] = (2 * far * near) / (near - far);
    return out;
  },
  orthographic(left: number, right: number, top: number, bottom: number, near: number, far: number): Float32Array {
    const out = new Float32Array(16);
    out[0] = 2 / (right - left); out[5] = 2 / (top - bottom); out[10] = -2 / (far - near);
    out[12] = -(right + left) / (right - left);
    out[13] = -(top + bottom) / (top - bottom);
    out[14] = -(far + near) / (far - near);
    out[15] = 1;
    return out;
  },
  lookAt(eye: V3, target: V3, up: V3): Float32Array {
    const z = eye.clone().sub(target).normalize();
    if (!z.length()) z.set(0, 0, 1);
    const x = up.clone().cross(z).normalize();
    if (!x.length()) x.set(Math.abs(z.y) > 0.99 ? 1 : 0, Math.abs(z.y) > 0.99 ? 0 : 1, 0).cross(z).normalize();
    const y = z.clone().cross(x);
    return new Float32Array([
      x.x, y.x, z.x, 0,
      x.y, y.y, z.y, 0,
      x.z, y.z, z.z, 0,
      -x.dot(eye), -y.dot(eye), -z.dot(eye), 1
    ]);
  },
  /** General inverse; used to unproject pointer rays. */
  invert(m: Float32Array): Float32Array {
    const a = m;
    const b00 = a[0]! * a[5]! - a[1]! * a[4]!, b01 = a[0]! * a[6]! - a[2]! * a[4]!;
    const b02 = a[0]! * a[7]! - a[3]! * a[4]!, b03 = a[1]! * a[6]! - a[2]! * a[5]!;
    const b04 = a[1]! * a[7]! - a[3]! * a[5]!, b05 = a[2]! * a[7]! - a[3]! * a[6]!;
    const b06 = a[8]! * a[13]! - a[9]! * a[12]!, b07 = a[8]! * a[14]! - a[10]! * a[12]!;
    const b08 = a[8]! * a[15]! - a[11]! * a[12]!, b09 = a[9]! * a[14]! - a[10]! * a[13]!;
    const b10 = a[9]! * a[15]! - a[11]! * a[13]!, b11 = a[10]! * a[15]! - a[11]! * a[14]!;
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return mat.identity();
    det = 1 / det;
    return new Float32Array([
      (a[5]! * b11 - a[6]! * b10 + a[7]! * b09) * det,
      (a[2]! * b10 - a[1]! * b11 - a[3]! * b09) * det,
      (a[13]! * b05 - a[14]! * b04 + a[15]! * b03) * det,
      (a[10]! * b04 - a[9]! * b05 - a[11]! * b03) * det,
      (a[6]! * b08 - a[4]! * b11 - a[7]! * b07) * det,
      (a[0]! * b11 - a[2]! * b08 + a[3]! * b07) * det,
      (a[14]! * b02 - a[12]! * b05 - a[15]! * b01) * det,
      (a[8]! * b05 - a[10]! * b02 + a[11]! * b01) * det,
      (a[4]! * b10 - a[5]! * b08 + a[7]! * b06) * det,
      (a[1]! * b08 - a[0]! * b10 - a[3]! * b06) * det,
      (a[12]! * b04 - a[13]! * b02 + a[15]! * b00) * det,
      (a[9]! * b02 - a[8]! * b04 - a[11]! * b00) * det,
      (a[5]! * b07 - a[4]! * b09 - a[6]! * b06) * det,
      (a[0]! * b09 - a[1]! * b07 + a[2]! * b06) * det,
      (a[13]! * b01 - a[12]! * b03 - a[14]! * b00) * det,
      (a[8]! * b03 - a[9]! * b01 + a[10]! * b00) * det
    ]);
  },
  /** Builds a model matrix from translation, a rotation given as basis vectors, and scale. */
  compose(pos: V3, x: V3, y: V3, z: V3, sx: number, sy: number, sz: number): Float32Array {
    return new Float32Array([
      x.x * sx, x.y * sx, x.z * sx, 0,
      y.x * sy, y.y * sy, y.z * sy, 0,
      z.x * sz, z.y * sz, z.z * sz, 0,
      pos.x, pos.y, pos.z, 1
    ]);
  }
};

/** Orthonormal basis whose Y axis points along `dir` — orients cylinders along a bond. */
export function basisFromY(dir: V3): { x: V3; y: V3; z: V3 } {
  const y = dir.clone().normalize();
  const helper = Math.abs(y.y) > 0.99 ? new V3(1, 0, 0) : new V3(0, 1, 0);
  const x = helper.clone().cross(y).normalize();
  const z = x.clone().cross(y).normalize();
  return { x, y, z };
}

export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint16Array;
}

export function sphereMesh(segW: number, segH: number): MeshData {
  const positions: number[] = [], normals: number[] = [], indices: number[] = [];
  for (let iy = 0; iy <= segH; iy++) {
    const v = iy / segH, theta = v * Math.PI;
    for (let ix = 0; ix <= segW; ix++) {
      const u = ix / segW, phi = u * Math.PI * 2;
      const x = -Math.cos(phi) * Math.sin(theta);
      const y = Math.cos(theta);
      const z = Math.sin(phi) * Math.sin(theta);
      positions.push(x, y, z);
      normals.push(x, y, z);
    }
  }
  for (let iy = 0; iy < segH; iy++) {
    for (let ix = 0; ix < segW; ix++) {
      const a = iy * (segW + 1) + ix, b = a + segW + 1;
      if (iy !== 0) indices.push(a, b, a + 1);
      if (iy !== segH - 1) indices.push(b, b + 1, a + 1);
    }
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint16Array(indices) };
}

/** Unit cylinder along Y, spanning y in [-0.5, 0.5]; open-ended (caps are hidden by atoms). */
export function cylinderMesh(segments: number): MeshData {
  const positions: number[] = [], normals: number[] = [], indices: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const phi = (i / segments) * Math.PI * 2;
    const x = Math.cos(phi), z = Math.sin(phi);
    positions.push(x, -0.5, z, x, 0.5, z);
    normals.push(x, 0, z, x, 0, z);
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint16Array(indices) };
}

export function compile(gl: WebGLRenderingContext, vertexSource: string, fragmentSource: string): WebGLProgram {
  const build = (type: number, source: string): WebGLShader => {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(`Shader compile failed: ${gl.getShaderInfoLog(shader) ?? ''}`);
    }
    return shader;
  };
  const program = gl.createProgram()!;
  const vertex = build(gl.VERTEX_SHADER, vertexSource);
  const fragment = build(gl.FRAGMENT_SHADER, fragmentSource);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`Program link failed: ${gl.getProgramInfoLog(program) ?? ''}`);
  }
  return program;
}

/** Nearest ray/sphere hit, or -1. Ray direction must be normalized. */
export function raySphereHit(origin: V3, direction: V3, centers: Float32Array, radii: Float32Array): number {
  let best = -1, bestT = Infinity;
  for (let i = 0; i < radii.length; i++) {
    const cx = centers[i * 3]! - origin.x, cy = centers[i * 3 + 1]! - origin.y, cz = centers[i * 3 + 2]! - origin.z;
    const t = cx * direction.x + cy * direction.y + cz * direction.z;
    const r = radii[i]!;
    const d2 = cx * cx + cy * cy + cz * cz - t * t;
    if (d2 > r * r) continue;
    const hit = t - Math.sqrt(r * r - d2);
    const entry = hit < 0 ? t + Math.sqrt(r * r - d2) : hit;
    if (entry >= 0 && entry < bestT) { bestT = entry; best = i; }
  }
  return best;
}
