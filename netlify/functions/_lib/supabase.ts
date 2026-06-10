import { createClient } from '@supabase/supabase-js';
import { appConfig, assertConfigured } from './config.js';

assertConfigured(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);

export const supabase = createClient(appConfig.supabaseUrl, appConfig.supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});
