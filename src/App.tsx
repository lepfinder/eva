import { useState } from 'react'
import { MainLayout } from '@/components/layout/MainLayout'
import { SplashScreen } from '@/components/SplashScreen'

function App(): React.ReactElement {
  const [showSplash, setShowSplash] = useState(true)

  const handleSplashComplete = (): void => {
    setShowSplash(false)
  }

  return (
    <>
      {showSplash && <SplashScreen onComplete={handleSplashComplete} />}
      <MainLayout />
    </>
  )
}

export default App
