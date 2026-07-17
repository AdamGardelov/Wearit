export function readPublicConfig(env) {
  const supabaseUrl = env.VITE_SUPABASE_URL?.trim();
  const supabasePublishableKey = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!supabaseUrl) throw new Error("Missing VITE_SUPABASE_URL.");
  if (!supabasePublishableKey) throw new Error("Missing VITE_SUPABASE_PUBLISHABLE_KEY.");
  return { supabaseUrl, supabasePublishableKey };
}
