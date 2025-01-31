const conf = require('ocore/conf');
const { webserver: fastifyInstance, utils } = require("attestation-kit");

const pairingUrlController = require('./controllers/pairingUrlController');

module.exports = async () => {
    try {
        fastifyInstance.get('/pairing', pairingUrlController);
        await fastifyInstance.listen({ port: conf.webserverPort, host: '0.0.0.0' });

        utils.logger.info('Server running on port', conf.webserverPort);
    } catch (err) {
        logger.error(err);
        process.exit(1);
    }
}
