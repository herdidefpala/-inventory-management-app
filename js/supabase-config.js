// Supabase project config — the publishable/anon key here is meant to be
// public and safe to ship in client-side code; real security comes from the
// Row Level Security policies in supabase_setup.sql, not from hiding this key.
const SUPABASE_URL = 'https://ygxchbzcmammghjwhmfb.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_lY_P9bWCHXWGgy1AYChuhA_NZGvGEhf';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
