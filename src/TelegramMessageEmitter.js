/**
 * Event emitter for Telegram-related events
 * @typedef {import('node:events').EventEmitter}
 * 
 * @event message - Emitted when a new message is received
 * @type {object} payload - Message details
 * 
 * @event error - Emitted when an error occurs
 * @type {Error} error - Error details
 */

const EventEmitter = require('events');

const eventEmitter = new EventEmitter();

eventEmitter.setMaxListeners(1); // Prevent accidental memory leaks

module.exports = eventEmitter;
