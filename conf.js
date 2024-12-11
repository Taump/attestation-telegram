/*jslint node: true */
"use strict";

exports.bServeAsHub = false;
exports.bLight = true;
exports.bNoPassphrase = true;
exports.webPort = null;
exports.storage = 'sqlite';

exports.webserverPort = process.env.testnet ? 5001 : 5005;
exports.testnet = process.env.testnet == "1";

exports.permanent_pairing_secret = '*';
exports.control_addresses = [''];
exports.payout_address = 'WHERE THE MONEY CAN BE SENT TO';
exports.hub = process.env.testnet ? 'obyte.org/bb-test' : 'obyte.org/bb';
exports.deviceName = 'Telegram attestation service';

exports.bIgnoreUnpairRequests = true;
exports.bSingleAddress = true;
exports.bStaticChangeAddress = true;
exports.KEYS_FILENAME = 'keys.json';