import { createClient } from "@supabase/supabase-js";
import { readPublicConfig } from "../config.js";

const config = readPublicConfig(import.meta.env);

export const supabase = createClient(
  config.supabaseUrl,
  config.supabasePublishableKey,
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } },
);
