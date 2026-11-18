import react from '@vitejs/plugin-react'
import { readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { defineConfig, type Plugin } from 'vite'

/**
 * Scrive dist/version.json: la versione (il nome del bundle principale) e tutti i file della build.
 * L'app Android, che ha l'interfaccia dentro l'APK, lo legge dal sito per scaricare quella nuova.
 */
function versionManifest(): Plugin {
  let outDir = 'dist'
  return {
    name: 'musicx-version',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir
    },
    closeBundle() {
      const files: string[] = []
      const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
          const path = join(dir, name)
          if (statSync(path).isDirectory()) walk(path)
          else files.push(relative(outDir, path).split('\\').join('/'))
        }
      }
      walk(outDir)
      const version = files.map((file) => file.match(/^assets\/(index-[\w-]+\.js)$/)?.[1]).find(Boolean)
      if (!version) throw new Error('version.json: bundle principale non trovato')
      const listed = files.filter((file) => file !== 'version.json').sort()
      writeFileSync(join(outDir, 'version.json'), JSON.stringify({ version, files: listed }, null, 2))
    },
  }
}

export default defineConfig({
  // Percorsi relativi: la build funziona sotto qualsiasi sottocartella (es. GitHub Pages).
  base: './',
  plugins: [react(), versionManifest()],
  // strictPort resta false: se la 5173 è occupata Vite passa alla porta libera successiva.
  server: { port: 5173, strictPort: false },
})
