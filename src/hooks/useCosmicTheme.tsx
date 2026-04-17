import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

export type CosmicTheme = 'night' | 'dusk'

interface CosmicThemeContextValue {
  theme: CosmicTheme
  toggleTheme: () => void
}

const CosmicThemeContext = createContext<CosmicThemeContextValue>({
  theme: 'night',
  toggleTheme: () => {}
})

function readInitial(): CosmicTheme {
  if (typeof localStorage === 'undefined') return 'night'
  const saved = localStorage.getItem('cosmic-theme')
  return saved === 'dusk' ? 'dusk' : 'night'
}

export function CosmicThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<CosmicTheme>(readInitial)

  useEffect(() => {
    const el = document.documentElement
    el.classList.add('dark')
    if (theme === 'dusk') {
      el.classList.add('dusk')
    } else {
      el.classList.remove('dusk')
    }
    localStorage.setItem('cosmic-theme', theme)
  }, [theme])

  const toggleTheme = () => setTheme(t => (t === 'night' ? 'dusk' : 'night'))

  return (
    <CosmicThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </CosmicThemeContext.Provider>
  )
}

export function useCosmicTheme() {
  return useContext(CosmicThemeContext)
}
