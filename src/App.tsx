import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WagmiProvider } from 'wagmi'

import { ExitPage } from './components/ExitPage'
import { ActionsProvider } from './hooks/useActions'
import { SigningKeysProvider } from './hooks/useSigningKeys'
import { wagmiConfig } from './wagmi'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
})

export default function App() {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <ActionsProvider>
          <SigningKeysProvider>
            <ExitPage />
          </SigningKeysProvider>
        </ActionsProvider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}
