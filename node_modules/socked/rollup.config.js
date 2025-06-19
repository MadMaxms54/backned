import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';

export default [
  {
    input: 'src/client.js',
    output: [
      {
        file: 'dist/client.esm.js',
        format: 'esm',
        sourcemap: true,
      },
      {
        file: 'dist/client.cjs.js',
        format: 'cjs',
        sourcemap: true,
      },
    ],
    plugins: [resolve(), commonjs()],
  },

  {
    input: 'src/client.js',
    output: {
      file: 'dist/client.umd.js',
      format: 'umd',
      name: 'LightWS',
      sourcemap: true,
    },
    plugins: [resolve(), commonjs()],
  },

  {
    input: 'src/client.js',
    output: {
      file: 'dist/client.umd.min.js',
      format: 'umd',
      name: 'LightWS',
      sourcemap: true,
      plugins: [terser()],
    },
    plugins: [resolve(), commonjs()],
  },

  {
    input: 'src/server.js',
    output: [
      {
        file: 'dist/server.esm.js',
        format: 'esm',
        sourcemap: true,
      },
      {
        file: 'dist/server.cjs.js',
        format: 'cjs',
        sourcemap: true,
      },
    ],
    plugins: [resolve(), commonjs()],
  },

  {
  input: 'src/index.js',
  output: [
    {
      file: 'dist/index.esm.js',
      format: 'esm',
      sourcemap: true
    },
    {
      file: 'dist/index.cjs.js',
      format: 'cjs',
      sourcemap: true
    }
  ],
  plugins: [resolve(), commonjs()]
}

];
