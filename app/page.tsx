import { withStartingSettlement } from "@/world/domain/settlement";
import { withStartingProduction } from "@/world/domain/production";
import { withStartingLogistics } from "@/world/domain/logistics";
import WorldMap from "@/presentation/world/world-map";
import { generateWorld } from "@/world/domain/world";

export default function Home() {
  return (
    <WorldMap
      world={withStartingLogistics(
        withStartingProduction(withStartingSettlement(generateWorld())),
      )}
    />
  );
}
