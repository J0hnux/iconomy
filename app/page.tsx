import WorldMap from "@/presentation/world/world-map";
import { createStartingWorld } from "@/world/simulation/game-simulation";

export default function Home() {
  return <WorldMap world={createStartingWorld()} />;
}
