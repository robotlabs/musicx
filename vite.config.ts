import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  // Percorsi relativi: la build funziona sotto qualsiasi sottocartella (es. GitHub Pages).
  base: './',
  plugins: [react()],
  // strictPort resta false: se la 5173 è occupata Vite passa alla porta libera successiva.
  server: { port: 5173, strictPort: false },
})
