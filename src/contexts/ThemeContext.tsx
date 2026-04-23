import { createContext, useContext, useEffect, ReactNode } from 'react'

type Theme = 'light'

interface ThemeContextType {
  theme: Theme
  setTheme: (theme: Theme) => void
  resolvedTheme: 'light'
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

interface ThemeProviderProps {
  children: ReactNode
}

export function ThemeProvider({
  children
}: ThemeProviderProps): React.ReactElement {
  const theme: Theme = 'light'
  const resolvedTheme: 'light' = 'light'

  useEffect(() => {
    const root = window.document.documentElement
    // 确保始终是 light 模式
    root.classList.remove('dark')
    root.classList.add('light')
  }, [])

  const setTheme = (): void => {
    // 固定为浅色主题，不做任何操作
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme, resolvedTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextType {
  const context = useContext(ThemeContext)
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}
