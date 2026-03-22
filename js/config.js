// CONFIG — Supabase client, shared globals, utilities
const SUPABASE_URL = 'https://lecssjvuskqemjzvjimo.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxlY3NzanZ1c2txZW1qenZqaW1vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1MTg4NjgsImV4cCI6MjA4ODA5NDg2OH0.Djl2cEDwf2AHca5SSN9HVQMyx7a1ZyY3MOMLTz5OtsY';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let currentUser = null;
let isAdmin = false;
let allCustomers = [];
let allDevices = [];

function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
