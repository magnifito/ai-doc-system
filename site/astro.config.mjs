import { defineConfig } from 'astro/config'
import sitemap from '@astrojs/sitemap'

// Deployed to GitHub Pages under the repository path.
export default defineConfig({
  site: 'https://magnifito.github.io',
  base: '/docs-notary',
  integrations: [sitemap()],
})
