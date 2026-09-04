'use strict';

// Apply runtime UI routing patches before loading the main server.
require('./lib/runtime-patch');
require('./server');
