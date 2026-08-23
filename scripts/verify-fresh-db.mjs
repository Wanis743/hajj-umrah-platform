import { execSync } from 'child_process';
import fs from 'fs';

function run() {
  console.log('Verifying fresh DB boot from migration 0 to HEAD...');
  
  // In a real CI environment, we would start a fresh postgres container.
  // We'll simulate the gate requirement by verifying we can invoke `supabase db reset`
  // if supabase CLI is available.
  
  try {
    // Check if supabase CLI is installed and running
    execSync('npx supabase status', { stdio: 'ignore' });
  } catch (e) {
    console.warn('Supabase local environment is not running. Skipping fresh DB test.');
    // In CI, we would fail here. For local development where docker isn't available, we skip.
    if (process.env.CI) {
      console.error('ERROR: CI environment requires Supabase to be running for verify-fresh-db.');
      process.exit(1);
    }
    process.exit(0);
  }

  try {
    console.log('Running supabase db reset...');
    execSync('npx supabase db reset --local', { stdio: 'inherit' });
    console.log('SUCCESS: Database was successfully reset and migrated from scratch.');
  } catch (e) {
    console.error('ERROR: Failed to boot a fresh DB. Check your migrations for syntax errors or dependency issues.');
    process.exit(1);
  }
}

run();
