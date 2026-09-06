import { footprintOf, type Building } from "../../world/domain/settlement";
import type { WorldSnapshot } from "../../world/domain/world";
import { toScreen, type Camera, type Viewport } from "./projection";

export type BuildingVisual = Readonly<{
  height: number;
  inset?: number;
  top: string;
  left: string;
  right: string;
  mark: string;
}>;
export type BuildingVisualSet = Readonly<Record<Building["type"], BuildingVisual>>;

// Visual definitions are presentation input. They never change footprints,
// recipes, inventory, worker assignments, or any other domain state.
const primitiveA = {
  camp: {
    height: 1.7,
    top: "#ddc393",
    left: "#9e825a",
    right: "#bca071",
    mark: "CAMP",
  },
  house: {
    height: 1.3,
    top: "#b76d4d",
    left: "#c3b28f",
    right: "#e2cfaa",
    mark: "",
  },
  warehouse: {
    height: 1.9,
    top: "#748896",
    left: "#788079",
    right: "#a6afa4",
    mark: "STORE",
  },
  workshop: {
    height: 1.5,
    top: "#b88b58",
    left: "#765b43",
    right: "#947356",
    mark: "SHOP",
  },
  farm: {
    height: 1.15,
    top: "#d3b65d",
    left: "#8b6c35",
    right: "#ad8842",
    mark: "FARM",
  },
  lumber_camp: {
    height: 1.45,
    top: "#82704c",
    left: "#4e4935",
    right: "#655a3e",
    mark: "WOOD",
  },
  quarry: {
    height: 1.2,
    top: "#a8ada8",
    left: "#666d69",
    right: "#808782",
    mark: "STONE",
  },
  iron_mine: {
    height: 1.55,
    top: "#815e53",
    left: "#493e3c",
    right: "#64504b",
    mark: "IRON",
  },
} satisfies BuildingVisualSet;

export const buildingVisualProfiles = {
  primitiveA,
  primitiveB: {
    ...primitiveA,
    lumber_camp: {
      height: 1.9,
      inset: 0.24,
      top: "#c38d4d",
      left: "#3d5137",
      right: "#577048",
      mark: "LOGS",
    },
  },
} as const satisfies Readonly<Record<string, BuildingVisualSet>>;

export type BuildingVisualProfileId = keyof typeof buildingVisualProfiles;
export const defaultBuildingVisualProfile: BuildingVisualProfileId = "primitiveA";
export const buildingVisuals: BuildingVisualSet = buildingVisualProfiles[defaultBuildingVisualProfile];

export function buildingDepthCell(building: Building) {
  const footprint = footprintOf(building.type, building.rotation);
  return {
    x: building.x + footprint.width - 1,
    y: building.y + footprint.depth - 1,
  };
}
export function buildingFaces(
  building: Building,
  camera: Camera,
  viewport: Viewport,
  visuals: BuildingVisualSet = buildingVisuals,
) {
  const footprint = footprintOf(building.type, building.rotation);
  const visual = visuals[building.type];
  const inset = visual.inset ?? 0.12;
  const x = building.x + inset,
    y = building.y + inset;
  const right = building.x + footprint.width - inset,
    bottom = building.y + footprint.depth - inset;
  const at = (x: number, y: number, z: number) =>
    toScreen({ x, y, z }, camera, viewport);
  const z = building.z,
    roof = z + visual.height;
  return [
    {
      color: visual.left,
      points: [
        at(x, bottom, roof),
        at(right, bottom, roof),
        at(right, bottom, z),
        at(x, bottom, z),
      ],
    },
    {
      color: visual.right,
      points: [
        at(right, y, roof),
        at(right, bottom, roof),
        at(right, bottom, z),
        at(right, y, z),
      ],
    },
    {
      color: visual.top,
      points: [
        at(x, y, roof),
        at(right, y, roof),
        at(right, bottom, roof),
        at(x, bottom, roof),
      ],
    },
  ];
}
const indexes = new WeakMap<WorldSnapshot, Map<string, Building>>();
export function buildingsByDepth(world: WorldSnapshot) {
  let index = indexes.get(world);
  if (!index) {
    index = new Map(
      (world.buildings ?? []).map((building) => {
        const cell = buildingDepthCell(building);
        return [`${cell.x},${cell.y}`, building];
      }),
    );
    indexes.set(world, index);
  }
  return index;
}
