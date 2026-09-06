'use strict';

// Apply runtime UI routing patches before loading the main server.
require('./lib/runtime-patch');
require('./lib/image-lock-patch');
require('./lib/feature-patch');
const { main } = require('./server');
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
