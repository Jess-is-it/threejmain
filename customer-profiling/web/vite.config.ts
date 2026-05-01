import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import fs from 'fs/promises';
import svgr from '@svgr/rollup';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const webBasePath = env.WEB_BASE_PATH || env.VITE_WEB_BASE_PATH || '/customer-profiling';
  const normalizedBase = webBasePath.endsWith('/') ? webBasePath : `${webBasePath}/`;

  return {
    base: normalizedBase,
    resolve: {
      alias: {
        src: resolve(__dirname, 'src'),
      },
    },
    esbuild: {
      loader: 'tsx',
      include: /src\/.*\.tsx?$/,
      exclude: [],
    },
    optimizeDeps: {
      esbuildOptions: {
        plugins: [
          {
            name: 'load-js-files-as-tsx',
            setup(build) {
              build.onLoad({ filter: /src\\.*\.js$/ }, async (args) => ({
                loader: 'tsx',
                contents: await fs.readFile(args.path, 'utf8'),
              }));
            },
          },
        ],
      },
    },
    plugins: [svgr(), react()],
  };
});
