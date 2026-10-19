import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// En GitHub Pages el sitio vive en /<nombre-del-repositorio>/, no en la
// raiz del dominio. El flujo de publicacion pasa esa ruta en VITE_BASE;
// en local la variable no existe y todo queda en la raiz.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
})
