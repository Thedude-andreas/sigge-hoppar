import { defineConfig } from 'vite'

// Deployed at https://andreasmartensson.com/99-natter-pa-kronan/
export default defineConfig({
  base: '/99-natter-pa-kronan/',
  server: {
    // Undvik att webbläsaren håller kvar gammal JS under utveckling
    headers: { 'Cache-Control': 'no-store' },
  },
})
