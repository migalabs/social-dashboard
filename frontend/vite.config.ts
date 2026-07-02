import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'

// https://vite.dev/config/
// base defaults to '/' (Vite's own default); deployments served behind a path
// prefix (e.g. migalabs.io/social) set BASE_PATH at build time (see docker-compose.yml).
export default defineConfig(({ command }) => ({
  base: command === 'build' ? (process.env.BASE_PATH || '/') : '/',
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] })
  ],
}))
