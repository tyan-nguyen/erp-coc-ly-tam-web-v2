import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { isAdminRole, normalizeRole } from '@/lib/auth/roles'

type UserProfile = {
  profile_id: number
  user_id: string
  role: string
  ho_ten: string | null
  email: string | null
  is_active: boolean
}

export const DEV_ROLE_OVERRIDE_COOKIE = 'dev_role_override'

function buildLoginRedirectUrl(message?: string) {
  const params = new URLSearchParams()
  if (message) params.set('err', message)
  const query = params.toString()
  return query ? `/login?${query}` : '/login'
}

export async function getAuthenticatedClientAndUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  return { supabase, user }
}

export async function getCurrentSessionProfile() {
  const { supabase, user } = await getAuthenticatedClientAndUser()

  const { data: profile, error } = await supabase
    .from('user_profiles')
    .select('profile_id, user_id, role, ho_ten, email, is_active')
    .eq('user_id', user.id)
    .single<UserProfile>()

  if (error || !profile || !profile.is_active) {
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
    const message = error?.message
      ? `Tai khoan dang nhap thanh cong nhung project nay chua co ho so user_profiles hop le. Chi tiet: ${error.message}`
      : !profile
        ? 'Tai khoan dang nhap thanh cong nhung project nay chua co dong user_profiles cho user nay.'
        : 'Tai khoan nay dang bi ngung su dung trong user_profiles.'
    redirect(buildLoginRedirectUrl(message))
  }

  const cookieStore = await cookies()
  const requestedRole = cookieStore.get(DEV_ROLE_OVERRIDE_COOKIE)?.value || ''
  const canOverrideRole = process.env.NODE_ENV !== 'production' && isAdminRole(profile.role)
  const effectiveRole = canOverrideRole && requestedRole ? normalizeRole(requestedRole) || profile.role : profile.role

  return {
    user,
    profile: {
      ...profile,
      role: effectiveRole,
      original_role: profile.role,
      is_role_overridden: canOverrideRole && Boolean(requestedRole),
    },
  }
}

export async function getAuthenticatedClientUserAndProfile() {
  const { supabase, user } = await getAuthenticatedClientAndUser()
  const { profile } = await getCurrentSessionProfile()

  return {
    supabase,
    user,
    profile,
  }
}
