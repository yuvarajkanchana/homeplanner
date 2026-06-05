import { create } from 'zustand'
import type { User } from '../types/schema'

interface AuthStore {
  user: User | null
  token: string | null
  setAuth: (user: User, token: string) => void
  logout: () => void
  isAuthenticated: () => boolean
}

const storedUser = localStorage.getItem('hp_user')
const storedToken = localStorage.getItem('hp_token')

export const useAuthStore = create<AuthStore>((set, get) => ({
  user: storedUser ? JSON.parse(storedUser) : null,
  token: storedToken || null,

  setAuth: (user, token) => {
    localStorage.setItem('hp_user', JSON.stringify(user))
    localStorage.setItem('hp_token', token)
    set({ user, token })
  },

  logout: () => {
    localStorage.removeItem('hp_user')
    localStorage.removeItem('hp_token')
    set({ user: null, token: null })
  },

  isAuthenticated: () => !!get().token,
}))
