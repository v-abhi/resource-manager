import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const android = process.env.BUILD_TARGET === 'android';
const repo = (process.env.GITHUB_REPOSITORY || '').split('/')[1];
const base = android ? './' : process.env.GITHUB_ACTIONS === 'true' && repo ? `/${repo}/` : '/';

export default defineConfig({
  base,
  plugins: android ? [] : [VitePWA({
    registerType: 'autoUpdate',
    includeAssets: ['icon-192.png', 'icon-512.png'],
    manifest: {
      name: 'Resource Manager', short_name: 'Resources', description: 'Track your personal resources offline',
      theme_color: '#101b2d', background_color: '#f6f8fc', display: 'standalone',
      start_url: base, scope: base,
      icons: [
        { src: `${base}icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
        { src: `${base}icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
      ]
    },
    workbox: { navigateFallback: `${base}index.html`, globPatterns: ['**/*.{js,css,html,svg,png,ico}'] }
  })]
});
