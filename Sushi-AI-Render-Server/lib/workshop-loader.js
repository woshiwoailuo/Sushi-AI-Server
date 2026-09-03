'use strict';
const fs = require('node:fs');
const path = require('node:path');
const template = fs.readFileSync(path.join(__dirname, '..', 'views', 'workshop-loader.html'), 'utf8');

module.exports = function workshopLoaderHtml(ticket) {
  const payload = JSON.stringify({ k: ticket.id, iv: ticket.iv, ct: ticket.ciphertext, tag: ticket.tag }).replace(/</g, '\\u003c');
  return template.replace('/*WORKSHOP_PAYLOAD*/{}', payload);
};
