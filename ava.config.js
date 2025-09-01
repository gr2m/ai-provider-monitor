export default {
  files: ['test/**/*.test.js'],
  verbose: true,
  timeout: '30s',
  serial: true, // Run tests serially to avoid undici dispatcher conflicts
  snapshotDir: 'test/snapshots',
  environmentVariables: {
    NODE_ENV: 'test'
  }
};
