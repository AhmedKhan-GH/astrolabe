import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Lens } from './lens/Lens'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Lens />
    </QueryClientProvider>
  )
}
