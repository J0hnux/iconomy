export type WorldPosition = Readonly<{ x: number; y: number; z: number }>;
export type SurfaceCell = WorldPosition & Readonly<{ terrain: "grassland" | "water" }>;
export type WorldSnapshot = Readonly<{ seed: string; size: number; chunkSize: number; cells: readonly SurfaceCell[] }>;

// Semantic world data; never browser objects or visual coordinates.
export function generateWorld(seed = "prototype-001", size = 128): WorldSnapshot {
  if (!Number.isInteger(size) || size < 8 || size > 256) throw new RangeError("World size must be an integer between 8 and 256.");
  let hash = 2166136261;
  for (const character of seed) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  const phase = (hash >>> 0) / 0xffffffff * Math.PI * 2;
  const cells: SurfaceCell[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const river = size * (0.44 + 0.09 * Math.sin(y / size * 9 + phase));
      const coast = size * (0.85 + 0.025 * Math.sin(x / size * 13 + phase));
      cells.push({ x, y, z: 0, terrain: Math.abs(x - river) < size * 0.025 || y > coast ? "water" : "grassland" });
    }
  }
  return { seed, size, chunkSize: 32, cells };
}

export function chunkOf(position: WorldPosition, chunkSize: number) {
  return { x: Math.floor(position.x / chunkSize), y: Math.floor(position.y / chunkSize) };
}
