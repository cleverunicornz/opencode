import { Router } from "@solidjs/router"
import { FileRoutes } from "@solidjs/start/router"
import { Suspense } from "solid-js"
import { Fonts } from "@opencode-ai/ui/fonts"
import { MetaProvider } from "@solidjs/meta"
import "./app.css"

export default function App() {
  return (
    <Router
      root={(props) => (
        <>
          <Suspense>
            <MetaProvider>
              <Fonts />
              {props.children}
            </MetaProvider>
          </Suspense>
        </>
      )}
    >
      <FileRoutes />
    </Router>
  )
}
