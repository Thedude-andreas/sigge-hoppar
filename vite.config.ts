import { defineConfig } from 'vite'

// Deployed at https://andreasmartensson.com/sigge-hoppar/
export default defineConfig({
  base: '/sigge-hoppar/',
  server: {
    // Undvik att webbläsaren håller kvar gammal JS under utveckling
    headers: { 'Cache-Control': 'no-store' },
  },
})
