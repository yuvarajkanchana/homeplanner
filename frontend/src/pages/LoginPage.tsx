import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { getApiErrorMessage } from '../api/error'
import { useAuthStore } from '../store/useAuthStore'
import toast from 'react-hot-toast'
import { Home, Lock, Mail } from 'lucide-react'
import authBg from '../assets/auth-home-bg.png'

export default function LoginPage() {
  const navigate = useNavigate()
  const setAuth = useAuthStore((s) => s.setAuth)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const form = new FormData()
      form.append('username', email)
      form.append('password', password)
      const { data } = await api.post('/auth/login', form, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      })
      setAuth(data.user, data.access_token)
      navigate('/')
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err, 'Login failed'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="min-h-screen bg-cover bg-center relative flex items-center justify-center px-6 py-8"
      style={{ backgroundImage: `url(${authBg})` }}
    >
      <div className="absolute inset-0 bg-white/30" />
      <div className="relative z-10 w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-white/92 shadow-md border border-white">
            <Home size={24} className="text-primary-500" />
          </div>
          <h1 className="mt-4 text-3xl font-semibold text-gray-950">HomePlanner</h1>
          <p className="text-gray-700 text-sm mt-1">Design your dream home</p>
        </div>

        <div className="bg-white/90 backdrop-blur-md border border-white rounded-xl p-7 shadow-2xl">
          <h2 className="text-xl font-semibold text-gray-950 mb-1">Sign in</h2>
          <p className="text-sm text-gray-600 mb-6">Open your saved plans and keep building.</p>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
              <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2.5 shadow-sm focus-within:border-primary-500">
                <Mail size={16} className="text-gray-500" />
                <input
                  type="email"
                  required
                  className="min-w-0 flex-1 bg-transparent text-sm text-gray-950 outline-none placeholder:text-gray-400"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Password</label>
              <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2.5 shadow-sm focus-within:border-primary-500">
                <Lock size={16} className="text-gray-500" />
                <input
                  type="password"
                  required
                  className="min-w-0 flex-1 bg-transparent text-sm text-gray-950 outline-none placeholder:text-gray-400"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                />
              </div>
            </div>
            <button type="submit" disabled={loading} className="w-full mt-2 rounded-lg bg-primary-500 px-4 py-2.5 text-sm font-semibold text-black shadow-md transition-colors hover:bg-primary-600 disabled:opacity-60">
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
          <p className="text-center text-sm text-gray-600 mt-5">
            No account?{' '}
            <Link to="/register" className="font-medium text-primary-500 hover:underline">
              Create one
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
