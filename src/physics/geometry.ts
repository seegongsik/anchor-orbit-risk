export type Vec2 = { x: number; y: number };
export type Vec3 = { x: number; y: number; z: number };

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(a: Vec2, s: number): Vec2 {
  return { x: a.x * s, y: a.y * s };
}

export function hypot2(a: Vec2): number {
  return Math.hypot(a.x, a.y);
}

export function normalize(a: Vec2): Vec2 {
  const n = hypot2(a);
  if (n === 0) {
    throw new Error("cannot normalize a zero vector");
  }
  return { x: a.x / n, y: a.y / n };
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function angleBetween(a: Vec2, b: Vec2): number {
  const na = hypot2(a);
  const nb = hypot2(b);
  if (na === 0 || nb === 0) {
    throw new Error("cannot take angle with a zero vector");
  }
  return Math.acos(clamp(dot(a, b) / (na * nb), -1, 1));
}

export function rotate(p: Vec2, radians: number, origin: Vec2 = { x: 0, y: 0 }): Vec2 {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  const x = p.x - origin.x;
  const y = p.y - origin.y;
  return { x: origin.x + c * x - s * y, y: origin.y + s * x + c * y };
}

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}
