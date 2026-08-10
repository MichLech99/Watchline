import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  return {
    plugins: [react()],
    server: {
      proxy: {
        ...(env.TMDB_READ_TOKEN ? {
            '/.netlify/functions/tmdb': {
              target: 'https://api.themoviedb.org',
              changeOrigin: true,
              headers: {
                Authorization: `Bearer ${env.TMDB_READ_TOKEN}`,
                Accept: 'application/json',
              },
              rewrite: (requestPath) => {
                const url = new URL(requestPath, 'http://localhost')
                const tmdbPath = url.searchParams.get('path') || '/3/trending/all/week'
                url.searchParams.delete('path')
                const target = new URL(tmdbPath, 'https://api.themoviedb.org')
                url.searchParams.forEach((value, key) => target.searchParams.set(key, value))
                return `${target.pathname}?${target.searchParams.toString()}`
              },
            },
          } : {}),
        ...(env.WATCHMODE_API_KEY ? {
          '/.netlify/functions/watchmode': {
            target: 'https://api.watchmode.com',
            changeOrigin: true,
            headers: { 'X-API-Key': env.WATCHMODE_API_KEY, Accept: 'application/json' },
            rewrite: (requestPath) => {
              const url = new URL(requestPath, 'http://localhost')
              const watchmodePath = url.searchParams.get('path') || '/v1/status/'
              url.searchParams.delete('path')
              return `${watchmodePath}?${url.searchParams.toString()}`
            },
          },
        } : {}),
      },
    },
  }
})
