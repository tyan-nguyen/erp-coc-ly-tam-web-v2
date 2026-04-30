'use client'

import Image from 'next/image'
import type { CSSProperties, FormEvent } from 'react'
import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const DEFAULT_LOGIN_DOMAIN = 'nguyentrinh.com.vn'

export default function LoginPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()
  const queryError = searchParams.get('err') || ''

  const [account, setAccount] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleLogin(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const normalizedAccount = account.trim()
    const email = normalizedAccount.includes('@')
      ? normalizedAccount
      : `${normalizedAccount}@${DEFAULT_LOGIN_DOMAIN}`

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    router.replace('/dashboard')
  }

  return (
    <main
      className="relative flex min-h-screen items-center justify-center overflow-hidden p-6"
      style={{
        backgroundImage:
          'linear-gradient(90deg, rgba(7, 33, 44, 0.34), rgba(7, 33, 44, 0.12)), url("/branding/login-background.jpg")',
        backgroundPosition: 'center',
        backgroundSize: 'cover',
      }}
    >
      <div className="absolute inset-0 bg-black/18" aria-hidden="true" />

      <div className="relative w-full max-w-[560px]">
        <div className="mb-6 flex items-center justify-center gap-4">
          <Image
            src="/branding/nguyen-trinh-logo.png"
            alt="Nguyễn Trình"
            width={126}
            height={76}
            priority
            className="h-12 w-auto object-contain sm:h-14"
          />
          <div className="font-serif text-2xl tracking-[0.08em] text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.55)] sm:text-3xl">
            NGUYỄN TRÌNH
          </div>
        </div>

        <form
          onSubmit={handleLogin}
          className="rounded-[18px] border px-7 py-7 shadow-2xl backdrop-blur-md sm:px-10 sm:py-8"
          style={{
            borderColor: 'rgba(255,255,255,0.44)',
            backgroundColor: 'rgba(255,255,255,0.54)',
          }}
        >
          <div className="space-y-2.5">
            <label className="text-xl font-medium text-slate-700">Tài khoản</label>
            <input
              type="text"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              className="w-full rounded-md border-0 px-5 py-3 text-lg text-slate-950 outline-none transition focus:ring-2"
              style={{
                backgroundColor: 'rgba(226, 232, 240, 0.66)',
                boxShadow: 'inset 0 0 0 1px rgba(148, 163, 184, 0.16)',
                '--tw-ring-color': 'rgba(29, 82, 112, 0.36)',
              } as CSSProperties}
              placeholder="Tên đăng nhập"
              autoComplete="username"
              required
            />
          </div>

          <div className="mt-6 space-y-2.5">
            <label className="text-xl font-medium text-slate-700">Mật khẩu</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border-0 px-5 py-3 text-lg text-slate-950 outline-none transition focus:ring-2"
              style={{
                backgroundColor: 'rgba(226, 232, 240, 0.66)',
                boxShadow: 'inset 0 0 0 1px rgba(148, 163, 184, 0.16)',
                '--tw-ring-color': 'rgba(29, 82, 112, 0.36)',
              } as CSSProperties}
              placeholder="••••••"
              autoComplete="current-password"
              required
            />
          </div>

          {error || queryError ? (
            <div
              className="mt-6 rounded-xl border px-4 py-3 text-sm"
              style={{
                borderColor: 'rgba(185, 28, 28, 0.22)',
                backgroundColor: 'rgba(254, 226, 226, 0.9)',
                color: '#991b1b',
              }}
            >
              {error || queryError}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={loading || !account.trim() || !password}
            className="mt-7 flex w-full items-center justify-center gap-3 rounded-md px-4 py-3.5 text-xl font-semibold uppercase tracking-[0.08em] text-white transition disabled:cursor-not-allowed disabled:opacity-55"
            style={{ backgroundColor: 'rgba(25, 82, 113, 0.96)' }}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6 fill-current">
              <path d="M17 9h-1V7a4 4 0 0 0-8 0v2H7a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2Zm-7-2a2 2 0 1 1 4 0v2h-4V7Z" />
            </svg>
            {loading ? 'Đang đăng nhập...' : 'Đăng nhập'}
          </button>
        </form>
      </div>
    </main>
  )
}
