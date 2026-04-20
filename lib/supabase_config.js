// lib/supabase_config.js
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://unamoikkxjwdiyjetbyn.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVuYW1vaWtreGp3ZGl5amV0YnluIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2Nzc2MDcsImV4cCI6MjA5MjI1MzYwN30.wPh02GPlnLeL__qqmX95PQDLPKh9LEBuvKow6P2uq88";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        storageKey: 'prysm_auth_token',
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true
    }
});

export { supabase };
