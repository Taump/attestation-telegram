const { db, utils } = require("attestation-kit");

const { logger, Validation, generateParingUrlWithVerifyData, ErrorWithMessage } = utils;

module.exports = async (request, reply) => {
    const { address } = request.params;
    const data = request.query;

    try {
        if (!Validation.isWalletAddress(address) || !Validation.isDataObject(data)) {
            throw new ErrorWithMessage('Invalid data or address', { code: "INVALID_DATA" });
        }

        const order = await db.getAttestationOrders({ data, address });

        if (order) {
            if (order.status === 'attested') {
                throw new ErrorWithMessage('Order already attested', { code: "ORDER_ALREADY_ATTESTED" });
            } else {
                const pairingUrlWithVerifyData = generateParingUrlWithVerifyData(address, data);
                reply.redirect(pairingUrlWithVerifyData);
            }
        } else {
            throw new ErrorWithMessage('Order not found', { code: "ORDER_NOT_FOUND" });
        }
    } catch (err) {
        logger.error('(generateParingUrlWithVerifyData): UNKNOWN ERROR', err);
        reply.badRequest(err.code ?? 'UNKNOWN_ERROR');
    }
}
