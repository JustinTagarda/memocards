export const env = {
  supabaseUrl:
    (process.env as { NEXT_PUBLIC_SUPABASE_URL?: string }).NEXT_PUBLIC_SUPABASE_URL ?? '',
  supabasePublishableKey:
    (process.env as { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string }).NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '',
  siteUrl:
    (process.env as { NEXT_PUBLIC_SITE_URL?: string }).NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
  supabaseServiceRoleKey:
    (process.env as { SUPABASE_SERVICE_ROLE_KEY?: string }).SUPABASE_SERVICE_ROLE_KEY ?? '',
  googleCloudProjectId:
    (process.env as { GOOGLE_CLOUD_PROJECT_ID?: string }).GOOGLE_CLOUD_PROJECT_ID ?? '',
  googleCloudClientEmail:
    (process.env as { GOOGLE_CLOUD_CLIENT_EMAIL?: string }).GOOGLE_CLOUD_CLIENT_EMAIL ?? '',
  googleCloudPrivateKey:
    ((process.env as { GOOGLE_CLOUD_PRIVATE_KEY?: string }).GOOGLE_CLOUD_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
}

export const hasSupabaseEnvironment = Boolean(env.supabaseUrl && env.supabasePublishableKey)
export const hasGoogleCloudEnvironment = Boolean(
  env.googleCloudProjectId && env.googleCloudClientEmail && env.googleCloudPrivateKey,
)
export const hasGoogleTtsEnvironment = hasGoogleCloudEnvironment
