import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

// Vite resolves extensionless imports to .js before .tsx, so a compiled .js
// sitting next to a .tsx source silently shadows it — the app runs stale code
// while edits to the .tsx do nothing. Fail the build instead.
function forbidShadowingJs() {
  const srcDir = path.resolve(__dirname, 'src');
  const findShadows = (dir: string): string[] => {
    const shadows: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        shadows.push(...findShadows(full));
      } else if (entry.name.endsWith('.js')) {
        const base = full.slice(0, -3);
        if (existsSync(`${base}.tsx`) || existsSync(`${base}.ts`)) shadows.push(full);
      }
    }
    return shadows;
  };
  return {
    name: 'forbid-shadowing-js',
    buildStart() {
      const shadows = findShadows(srcDir);
      if (shadows.length > 0) {
        throw new Error(
          `Compiled .js files shadow their .ts/.tsx sources — delete them:\n${shadows.join('\n')}`
        );
      }
    },
  };
}

export default defineConfig({
  plugins: [forbidShadowingJs(), react(), tailwindcss()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
