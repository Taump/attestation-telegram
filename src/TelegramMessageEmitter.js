const EventEmitter = require('events');

const eventEmitter = new EventEmitter();

eventEmitter.setMaxListeners(1); // Prevent accidental memory leaks

module.exports = eventEmitter;
