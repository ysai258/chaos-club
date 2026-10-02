import { Route, Switch } from 'wouter'
import { Toaster } from './ui/index.ts'
import { Landing } from './pages/Landing.tsx'
import { RoomPage } from './pages/RoomPage.tsx'
import { NotFound } from './pages/NotFound.tsx'

export function App() {
  return (
    <>
      <Switch>
        <Route path="/" component={Landing} />
        <Route path="/r/:code">{(params) => <RoomPage key={params.code.toUpperCase()} code={params.code.toUpperCase()} />}</Route>
        <Route component={NotFound} />
      </Switch>
      <Toaster />
    </>
  )
}
