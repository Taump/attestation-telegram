const { utils } = require("attestation-kit");

module.exports = async (_request, reply) => {
    try {
        const pairingUrl = utils.generateParingUrl();
        reply.redirect(pairingUrl);
    } catch (err) {
        utils.logger.error('(generateParingUrl): UNKNOWN ERROR', err);
        reply.badRequest(err.code ?? 'UNKNOWN_ERROR');
    }
}