const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');
const HtmlPlugin = require('html-webpack-plugin');

module.exports = {
  entry: {
    'service-worker': './src/background/service-worker.ts',
    'content-script': './src/content/page-analyzer.ts',
    popup: './src/popup/Popup.tsx',
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
    clean: true,
  },
  resolve: { extensions: ['.ts', '.tsx', '.js'] },
  module: {
    rules: [
      { test: /\.tsx?$/, use: 'ts-loader', exclude: /node_modules/ },
      { test: /\.css$/, use: ['style-loader', 'css-loader'] },
    ],
  },
  plugins: [
    new CopyPlugin({
      patterns: [
        { from: 'manifest.json', to: '.' },
        { from: 'icons', to: 'icons' },
      ],
    }),
    new HtmlPlugin({ template: './src/popup/popup.html', filename: 'popup.html', chunks: ['popup'] }),
  ],
};
