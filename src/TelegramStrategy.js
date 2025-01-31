const { Telegraf, session } = require('telegraf');
const conf = require('ocore/conf');
const device = require('ocore/device');

const { utils, BaseStrategy, dictionary } = require('attestation-kit');

const TELEGRAM_BASE_URL = 'https://t.me/';

/**
 * TelegramStrategy class extends BaseStrategy for Telegram-based attestation.
 * @class
 * @extends BaseStrategy
 */
class TelegramStrategy extends BaseStrategy {
    /**
    * Constructs a new TelegramStrategy instance.
    * @param {object} options - Configuration options for the strategy.
    * @param {string} options.token - The Telegram bot token(TELEGRAM_BOT_TOKEN).
    * @param {string} options.domain - The domain of the application.
    * @throws {ErrorWithMessage} Throws an error if the token(TELEGRAM_BOT_TOKEN) is missing.
    */
    constructor(options) {
        super(options);

        if (!options.token) {
            throw new Error('TelegramStrategy: Telegram bot token is required. Please provide it in options.token or set the TELEGRAM_BOT_TOKEN environment variable.');
        }

        if (!options.domain) {
            throw new Error('TelegramStrategy: domain is required. Please provide it in options.domain');
        }
    }

    walletAddressVerified(deviceAddress, walletAddress) {
        if (this.validate.isWalletAddress(walletAddress)) {
            const query = new URLSearchParams({ address: deviceAddress });
            const encodedData = utils.encodeToBase64(query);
            const url = TELEGRAM_BASE_URL + process.env.TELEGRAM_BOT_USERNAME + `?start=${encodedData}`;

            device.sendMessageToDevice(deviceAddress, 'text', `Your wallet address ${walletAddress} was successfully verified`);
            device.sendMessageToDevice(deviceAddress, 'text', `Please continue in telegram: \n ${url}`);
        } else {
            return device.sendMessageToDevice(deviceAddress, 'text', dictionary.common.INVALID_WALLET_ADDRESS);
        }
    }

    async onDevicePaired(deviceAddress) {
        if (!await this.sessionStore.getSession(deviceAddress)) {
            device.sendMessageToDevice(deviceAddress, 'text', dictionary.telegram.WELCOME);
        }

        device.sendMessageToDevice(deviceAddress, 'text', dictionary.wallet.ASK_ADDRESS);
    }

    onAddressAdded(deviceAddress, walletAddress) {
        device.sendMessageToDevice(deviceAddress, 'text', dictionary.wallet.ASK_VERIFY_FN(walletAddress));
    }

    viewAttestationData(id, username, address) {
        return '<b>Your data for attestation:</b> \n\n'
            + `ID: ${id ?? 'N/A'} \n`
            + `Username: ${username ? BaseStrategy.escapeHtml(username) : 'N/A'}`
            + (address ? `\nWallet address: <a href='https://${conf.testnet ? 'testnet' : ''}explorer.obyte.org/${address}'>${address}</a>` : '');
    }

    onAttested(deviceAddress, { data, unit }) {
        if (unit && data.userId && deviceAddress) {
            const message = `Attestation unit: <a href="https://${conf.testnet ? 'testnet' : ''}explorer.obyte.org/${encodeURIComponent(unit)}">${unit}</a>`;
            this.client.telegram.sendMessage(data.userId, message, { parse_mode: 'HTML' });

            return device.sendMessageToDevice(deviceAddress, 'text', `Attestation unit: https://${conf.testnet ? 'testnet' : ''}explorer.obyte.org/${unit}`);
        }
    }

    /**
     * Initializes the Telegram bot and sets up scenes and handlers
     * @returns {void}
     */
    init() {
        this.client = new Telegraf(this.options.token);
        this.client.use(session());

        this.client.catch((err, ctx) => {
            console.error('Bot error:', err);
            ctx.reply('An error occurred while processing your request. Please try again later.');
        });

        this.client.start(async (ctx) => {
            let address;
            let deviceAddress;

            try {
                if (ctx.payload) {
                    const decodedData = Buffer.from(ctx.payload, 'base64').toString('utf-8');
                    const decodedPayload = decodeURIComponent(decodedData);
                    const params = new URLSearchParams(decodedPayload);

                    deviceAddress = params.get('address');
                    address = await this.sessionStore.getSessionWalletAddress(deviceAddress);
                }
            } catch {
                console.error('Error while decoding payload');
                return ctx.reply('UNKNOWN_ERROR, please try again later');
            }

            const { username, id: userId } = ctx.update.message.from;

            await ctx.reply(dictionary.telegram.WELCOME);

            if (!username || !userId) return await ctx.reply(dictionary.telegram.USERNAME_NOT_FOUND);

            if (address) {
                const userDataMessage = this.viewAttestationData(userId, username, address);
                await ctx.reply(userDataMessage, { parse_mode: 'HTML' });

                const existingAttestation = await this.db.getAttestationOrders({ data: { userId, username }, address });
                let orderId;

                if (existingAttestation) {
                    if (existingAttestation.status === "attested") {

                        if (deviceAddress) {
                            const unit = existingAttestation.unit;

                            device.sendMessageToDevice(deviceAddress, 'text', `Sorry, but you have already attested your wallet address with the same data. Attestation unit: https://${conf.testnet ? 'testnet' : ''}explorer.obyte.org/${unit} . If you want to re-attest, please use [attest](command:attest)`);
                        }

                        return await ctx.reply(dictionary.common.ALREADY_ATTESTED);
                    } else {
                        orderId = existingAttestation.id;

                        if (existingAttestation.address !== address) {
                            this.db.updateWalletAddressInAttestationOrder(orderId, address);
                        }
                    }
                } else {
                    orderId = await this.db.createAttestationOrder({ username, userId }, address, true);
                }

                if (deviceAddress) {
                    await this.db.updateDeviceAddressInAttestationOrder(orderId, deviceAddress);
                }

                const dataObj = { username, userId };

                try {
                    await ctx.deleteMessage();

                    const order = await this.db.getAttestationOrders({ data: dataObj, address, excludeAttested: true });

                    const unit = await utils.postAttestationProfile(address, dataObj);

                    await this.db.updateUnitAndChangeStatus(dataObj, address, unit);
                    await this.sessionStore.deleteSession(deviceAddress);

                    const message = `Attestation unit: <a href="https://${conf.testnet ? 'testnet' : ''}explorer.obyte.org/${encodeURIComponent(unit)}">${unit}</a>`;

                    ctx.reply(message, { parse_mode: 'HTML' });

                    if (order.user_device_address) {
                        return device.sendMessageToDevice(order.user_device_address, 'text', `Attestation unit: https://${conf.testnet ? 'testnet' : ''}explorer.obyte.org/${unit}`);
                    }

                } catch (err) {
                    this.logger.error('attestedCallbackAction: Error while processing address:', err);
                    await ctx.reply('Unknown error occurred');
                }
            } else {
                return await ctx.reply(`Sorry, but we couldn't find your wallet address. Please follow instructions from <a href='${this.options.domain}/pairing'>Obyte wallet</a>`, { parse_mode: 'HTML' });
            }
        });

        this.client.launch()
            .then(() => {
                this.logger.info('Telegram attestation service has been started');
            }).catch((err) => {
                this.logger.error('Failed to launch Telegram bot:', err);
            });

        // Enable graceful stop
        process.once('SIGINT', () => this.client.stop('SIGINT'))
        process.once('SIGTERM', () => this.client.stop('SIGTERM'))
    }
}


module.exports = TelegramStrategy;