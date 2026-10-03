import { defineConfig } from 'vite';

export default defineConfig({
  // './' để build chạy được cả khi host ở thư mục con (vd GitHub Pages: user.github.io/be-ve/)
  base: './',
  build: {
    // Safari trên iPad 2018 vẫn chạy tốt ES2020
    target: 'es2020',
  },
});
