/**
 * This module exports localized messages for the Telegram attestation process.
 * If you want to add localization for your attestation service, please create a file
 * in this directory with the name as the filename and a `.local.js` extension.
 * For example: `telegram.local.js`.
 * 
 * Inside the file, export a JavaScript object containing the localized messages.
 * Example:
 * 
 * module.exports = {
 *     ATTESTATION_COMMAND: 'To get started, please use the /attest command.',
 *     SEND_WALLET: 'Please send your own wallet address; it will be verified.'
 * };
 * 
 * IMPORTANT:
 * Before starting the application, make sure to set the desired locale using `dictionary.setLocale("any_name");`.
 * For example, to use the Telegram locale, call `dictionary.set("telegram");` before initializing the attestation service.
 * 
 * These messages will be used by the application to communicate with users
 * during the attestation process.
 */