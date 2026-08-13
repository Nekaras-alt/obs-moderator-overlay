import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SHARED = path.join(__dirname, 'shared')
const SRC = path.join(__dirname, 'client', 'src')

// The client lives under ./client. In dev it runs on :5173 and proxies
// /ws + /api to the Node server on :8090. In production the server serves
// the built client statically, so OBS and the moderator hit one port.
export default defineConfig({
  root: 'client',
  plugins: [
    vue({
      // Electron <webview> is a native custom element (OBS CEF analogue).
      // Without this, Vue treats it as an unknown component and it never mounts.
      template: {
        compilerOptions: {
          isCustomElement: (tag) => tag === 'webview'
        }
      }
    }),
    tailwindcss(),
    // Remove crossorigin attribute from script/link tags in the built HTML.
    // Electron's BrowserWindow loads assets from localhost without CORS
    // headers, and the crossorigin attribute causes ES modules to fail
    // silently (white screen).
    {
      name: 'remove-crossorigin',
      transformIndexHtml(html) {
        return html.replace(/ crossorigin/g, '')
      }
    }
  ],
  resolve: {
    alias: {
      '@': SRC,
      '@shared': SHARED
    }
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/ws': { target: 'ws://localhost:8090', ws: true },
      '/api': { target: 'http://localhost:8090', ws: true, changeOrigin: true },
      '/uploads': { target: 'http://localhost:8090' },
      '/docs': { target: 'http://localhost:8090' }
    }
  },
  build: { outDir: '../dist', emptyOutDir: true }
})
