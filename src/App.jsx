import { useMemo } from "react";
import { createWardrobeRepository } from "./data/wardrobeRepository.js";
import { WardrobeView } from "./features/wardrobe/WardrobeView.jsx";
import { supabase } from "./lib/supabase.js";

export function App() {
  const repository = useMemo(() => createWardrobeRepository(supabase), []);

  return <WardrobeView repository={repository} />;
}
