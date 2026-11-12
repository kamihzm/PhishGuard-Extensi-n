import { defineConfig } from 'vite'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.config.ts'

export default defineConfig({
  plugins: [crx({ manifest })],
  build: {
    rollupOptions: {
      input: {
        // La página de advertencia no es popup/options/devtools, así que
        // CRXJS no la detecta sola desde el manifest — hay que declararla
        // como entry point para que Vite procese su <script>/<link>.
        warning: 'src/ui/warning/warning.html',
      },
    },
  },
  server: {
    // Por defecto Vite no sirve archivos fuera de `extension/`; `training/`
    // vive un nivel arriba y sus tests necesitan poder cargarse.
    fs: { allow: ['..'] },
  },
  test: {
    environment: 'jsdom',
    // `training/` es un paquete offline hermano que reutiliza extension/src/*
    // (ver plan de arquitectura); se corre desde el mismo Vitest para no
    // duplicar configuración.
    include: [
      'src/**/*.{test,spec}.ts',
      '../training/**/*.{test,spec}.ts',
      '../tools/**/*.{test,spec}.ts',
    ],
  },
})
