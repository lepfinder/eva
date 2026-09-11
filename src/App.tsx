import { useState } from 'react'
import { MainLayout } from '@/components/layout/MainLayout'
import { SplashScreen } from '@/components/SplashScreen'
import { TrayReceiptView } from '@/components/TrayReceiptView'
import { QuickHubView } from '@/components/hub/QuickHubView'

function App(): React.ReactElement {
  const [showSplash, setShowSplash] = useState(true)

  const isTrayReceipt = typeof window !== 'undefined' && window.location.search.includes('window=tray-receipt')
  if (isTrayReceipt) {
    return <TrayReceiptView />
  }

  const isHub = typeof window !== 'undefined' && window.location.search.includes('window=hub')
  if (isHub) {
    return <QuickHubView />
  }

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
