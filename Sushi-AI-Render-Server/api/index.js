// Vercel Node.js function entrypoint for the existing Express application.
// Apply the same workshop HTML patches used by local start.js.
require('../lib/runtime-patch');
require('../lib/image-lock-patch');
require('../lib/feature-patch');
module.exports = require('../server');
