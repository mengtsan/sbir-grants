import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const vendorChunk = (id: string): string | undefined => {
  if (!id.includes('/node_modules/')) return undefined

  if (
    id.includes('/react/') ||
    id.includes('/react-dom/') ||
    id.includes('/react-router-dom/')
  ) {
    return 'react'
  }

  if (
    id.includes('/react-markdown/') ||
    id.includes('/remark-gfm/') ||
    id.includes('/remark-parse/') ||
    id.includes('/unified/') ||
    id.includes('/marked/')
  ) {
    return 'markdown'
  }

  if (id.includes('/docx-templates/')) {
    return 'docx-template'
  }

  if (id.includes('/docx/')) {
    return 'docx-core'
  }

  if (id.includes('/mdast2docx/')) {
    return 'docx-converter'
  }

  if (id.includes('/@m2d/')) {
    return 'docx-plugins'
  }

  return undefined
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          return vendorChunk(id)
        },
      },
    },
  },
})
