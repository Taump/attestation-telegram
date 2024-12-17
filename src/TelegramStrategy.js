const { Telegraf, Scenes, session, Markup } = require('telegraf');
const isArray = require('lodash/isArray');
const eventBus = require('ocore/event_bus.js');
const conf = require('ocore/conf');
const device = require('ocore/device');

const { utils, BaseStrategy, dictionary } = require('attestation-kit');

const TELEGRAM_BASE_URL = 'https://t.me/';

const { encodeToBase64 } = utils;

const { ErrorWithMessage } = utils.ErrorWithMessage;
/**
 * TelegramStrategy class extends BaseStrategy for Telegram-based attestation.
 * @class
 * @extends BaseStrategy
 */
class TelegramStrategy extends BaseStrategy {

    static provider = 'telegram';

    /**
    * Constructs a new TelegramStrategy instance.
    * @param {object} options - Configuration options for the strategy.
    * @param {string} options.token - The Telegram bot token(TELEGRAM_BOT_TOKEN).
    * @throws {ErrorWithMessage} Throws an error if the token(TELEGRAM_BOT_TOKEN) is missing.
    */
    constructor(options) {
        super(options);

        if (!options.token) {
            throw new Error('TelegramStrategy: Telegram bot token is required. Please provide it in options.token or set the TELEGRAM_BOT_TOKEN environment variable.');
        }
    }

    getFirstPairedInstruction(walletAddress) {
        if (this.validate.isWalletAddress(walletAddress)) {
            const query = new URLSearchParams({ address: walletAddress });
            const encodedData = encodeToBase64(query);
            return TELEGRAM_BASE_URL + process.env.TELEGRAM_BOT_USERNAME + `?start=${encodedData}`;
        } else {
            throw new ErrorWithMessage(dictionary.common.INVALID_WALLET_ADDRESS);
        }
    }

    onWalletPaired(from_address) {
        device.sendMessageToDevice(from_address, 'text', dictionary.common.WELCOME);
        device.sendMessageToDevice(from_address, 'text', dictionary.wallet.ASK_ADDRESS);
    }

    viewAttestationData(id, username) {
        return '<b>Your data for attestation:</b> \n\n' + `ID: ${id ?? 'N/A'} \n` + `Username: ${username ? BaseStrategy.escapeHtml(username) : 'N/A'}\n\n`;
    }

    /**
     * Initializes the Telegram bot and sets up scenes and handlers
     * @returns {void}
     */
    init() {
        this.client = new Telegraf(this.options.token);

        const inputAddressScene = new Scenes.BaseScene('inputAddressScene');

        inputAddressScene.enter((ctx) => {
            ctx.reply(dictionary.telegram.SEND_WALLET);
        });

        const stage = new Scenes.Stage([inputAddressScene]);

        eventBus.on('ATTESTATION_KIT_ATTESTED', ({ data, provider, unit }) => {
            if (unit && provider === this.provider && data.userId) {
                const message = `Attestation unit: <a href="https://${conf.testnet ? 'testnet' : ''}explorer.obyte.org/${encodeURIComponent(unit)}">${unit}</a>`;
                this.client.telegram.sendMessage(data.userId, message, { parse_mode: 'HTML' });
            }
        });

        this.client.use(session());
        this.client.use(stage.middleware());

        this.client.start(async (ctx) => {
            let address;

            try {
                if (ctx.payload) {
                    const decodedData = Buffer.from(ctx.payload, 'base64').toString('utf-8');
                    const decodedPayload = decodeURIComponent(decodedData);
                    const params = new URLSearchParams(decodedPayload);
                    address = params.get('address');
                }
            } catch {
                console.error('Error while decoding payload');
                return ctx.reply('UNKNOWN_ERROR, please try again later');
            }

            const { username, id } = ctx.update.message.from;

            await ctx.reply(dictionary.common.WELCOME);

            if (address) {
                const userDataMessage = this.viewAttestationData(id, username);
                await ctx.reply(userDataMessage, { parse_mode: 'HTML' });

                await this.db.createAttestationOrder(this.provider, { username, userId: id }, true);
                await this.db.updateWalletAddressInAttestationOrder(this.provider, { userId: id, username }, address);

                const verifyUrl = this.getVerifyUrl(address, this.provider, { userId: id, username });

                await ctx.reply(dictionary.common.HAVE_TO_VERIFY, Markup.inlineKeyboard([
                    Markup.button.url('Verify', verifyUrl)
                ]));

                await ctx.reply(dictionary.telegram.REMOVE_ADDRESS);
            } else {
                ctx.reply(dictionary.telegram.ATTESTATION_COMMAND);
            }
        });

        this.client.command('remove', async (ctx) => {
            try {
                await this.db.removeWalletAddressInAttestationOrder(this.provider, { userId: ctx.update.message.from.id, username: ctx.update.message.from.username });
                await ctx.scene.enter('inputAddressScene');
            } catch (err) {
                if (err.code === 'ALREADY_ATTESTED') {
                    await ctx.reply(dictionary.common.REMOVE_ADDRESS_ALREADY_ATTESTED);
                } else if (err.code === 'ADDRESS_NOT_FOUND') {
                    await ctx.reply(dictionary.common.REMOVE_ADDRESS_NOT_FOUND);
                } else {
                    await ctx.reply(err.message);
                }
            }
        });

        // Handle attestation command and ask for wallet address
        this.client.command('attest', async (ctx) => {
            const { username, id } = ctx.update.message.from;

            const userDataMessage = this.viewAttestationData(id, username);

            try {
                await this.db.createAttestationOrder(this.provider, { username, userId: id }, true);

                await ctx.reply(userDataMessage, { parse_mode: 'HTML' });

                await ctx.scene.enter('inputAddressScene');
            } catch (err) {
                this.logger.error('Unknown error in /attest command:', err);
                ctx.reply(err.message);
            }
        });

        // Handle wallet address input
        inputAddressScene.on('text', async (ctx) => {
            const walletAddress = ctx.message.text;
            const { id, username } = ctx.update.message.from;

            if (this.validate.isWalletAddress(walletAddress)) {
                try {
                    const orders = await this.db.getAttestationOrders({ serviceProvider: this.provider, data: { userId: id, username } }, true);

                    if (isArray(orders) && orders.length > 0) {
                        const isDataHasBeenAlreadyAttested = orders.find(order => order.user_wallet_address === walletAddress && order.status === 'attested');
                        if (isDataHasBeenAlreadyAttested) {
                            await ctx.reply(dictionary.common.ALREADY_ATTESTED(this.provider, walletAddress, { username, userId: id }));
                            return await ctx.scene.leave();
                        } else {
                            await ctx.reply(dictionary.common.ADDRESS_RECEIVED);

                            await this.db.updateWalletAddressInAttestationOrder(this.provider, { userId: id, username }, walletAddress);

                            const verifyUrl = this.getVerifyUrl(walletAddress, this.provider, { userId: id, username });

                            await ctx.reply(dictionary.common.HAVE_TO_VERIFY, Markup.inlineKeyboard([
                                Markup.button.url('Verify', verifyUrl)
                            ]));

                            await ctx.reply(dictionary.telegram.REMOVE_ADDRESS);

                            return await ctx.scene.leave();
                        }
                    } else {
                        this.logger.error("if order not found (It's strange, but we should handle it)");

                        await ctx.reply(dictionary.telegram.COMMAND_ATTESTATION_AGAIN);
                        await ctx.scene.leave();
                    }
                } catch (err) {
                    this.logger.error('Error while processing address:', err);
                    return ctx.reply('An error occurred while processing your request. Please try again later.');
                }
            } else {
                ctx.reply(dictionary.common.INVALID_WALLET_ADDRESS);
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