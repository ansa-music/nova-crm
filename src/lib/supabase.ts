import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Public anon key — same class of credential as the Firebase web API key.
// Access is gated by Supabase Storage policies on the `row-files` bucket.
export const SUPABASE_URL: string = import.meta.env.VITE_SUPABASE_URL || "https://xoqivqqcmunavuwpsmsd.supabase.co";
export const SUPABASE_ANON_KEY: string =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhvcWl2cXFjbXVuYXZ1d3BzbXNkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1NzI3NTksImV4cCI6MjEwMzE0ODc1OX0.O6kPppHl4R3JrpC4eSZGJVmWnja0G-m6WPTtZ6AnB8w";

export const ROW_FILES_BUCKET = "row-files";

export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

