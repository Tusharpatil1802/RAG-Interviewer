import { createClient } from '@supabase/supabase-js';
import { appConfig, assertConfigured } from './config.js';

let cachedClient: ReturnType<typeof createClient<any, 'public', any>> | null = null;

export function getSupabase() {
  assertConfigured(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
  if (!cachedClient) {
    cachedClient = createClient(appConfig.supabaseUrl, appConfig.supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
  return cachedClient;
}
