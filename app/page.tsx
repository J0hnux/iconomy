import { withStartingSettlement } from "@/world/domain/settlement";
import { withStartingProduction } from "@/world/domain/production";
import WorldMap from "@/presentation/world/world-map";
import { generateWorld } from "@/world/domain/world";

export default function Home() {
  return <WorldMap world={withStartingProduction(withStartingSettlement(generateWorld()))} />;
}
