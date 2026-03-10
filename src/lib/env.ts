function readPublic(name: 'NEXT_PUBLIC_SUPABASE_URL' | 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY' | 'NEXT_PUBLIC_SITE_URL') {
  return process.env[name] ?? ''
}

function readServer(
  name:
    | 'SUPABASE_SERVICE_ROLE_KEY'
    | 'GOOGLE_CLOUD_PROJECT_ID'
    | 'GOOGLE_CLOUD_CLIENT_EMAIL'
    | 'GOOGLE_CLOUD_PRIVATE_KEY',
) {
  return process.env[name] ?? ''
}

export const env = {
  supabaseUrl: readPublic('NEXT_PUBLIC_SUPABASE_URL'),
  supabasePublishableKey: readPublic('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
  siteUrl: readPublic('NEXT_PUBLIC_SITE_URL') || 'http://localhost:3000',
  supabaseServiceRoleKey: readServer('SUPABASE_SERVICE_ROLE_KEY'),
  googleCloudProjectId: readServer('GOOGLE_CLOUD_PROJECT_ID'),
  googleCloudClientEmail: readServer('GOOGLE_CLOUD_CLIENT_EMAIL'),
  googleCloudPrivateKey: readServer('GOOGLE_CLOUD_PRIVATE_KEY').replace(/\\n/g, '\n'),
}

export const hasSupabaseEnvironment = Boolean(env.supabaseUrl && env.supabasePublishableKey)
export const hasGoogleTtsEnvironment = Boolean(
  env.googleCloudProjectId && env.googleCloudClientEmail && env.googleCloudPrivateKey,
)
