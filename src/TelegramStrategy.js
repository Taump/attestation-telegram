const { Telegraf, Scenes, session, Markup } = require('telegraf');
const isArray = require('lodash/isArray');
const conf = require('ocore/conf');
const device = require('ocore/device');

const { utils, BaseStrategy, dictionary } = require('attestation-kit');

const TELEGRAM_BASE_URL = 'https://t.me/';

const { encodeToBase64, postAttestationProfile } = utils;

// const { ErrorWithMessage } = utils.ErrorWithMessage;
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
    * @throws {ErrorWithMessage} Throws an error if the token(TELEGRAM_BOT_TOKEN) is missing.
    */
    constructor(options) {
        super(options);

        if (!options.token) {
            throw new Error('TelegramStrategy: Telegram bot token is required. Please provide it in options.token or set the TELEGRAM_BOT_TOKEN environment variable.');
        }
    }

    walletAddressVerified(deviceAddress, walletAddress) {
        if (this.validate.isWalletAddress(walletAddress)) {
            const query = new URLSearchParams({ address: deviceAddress });
            const encodedData = encodeToBase64(query);
            const url = TELEGRAM_BASE_URL + process.env.TELEGRAM_BOT_USERNAME + `?start=${encodedData}`;

            device.sendMessageToDevice(deviceAddress, 'text', `Your wallet address ${walletAddress} was successfully verified`);
            device.sendMessageToDevice(deviceAddress, 'text', `Please continue in telegram: \n ${url}`);
        } else {
            return device.sendMessageToDevice(deviceAddress, 'text', dictionary.common.INVALID_WALLET_ADDRESS);
        }
    }

    onDevicePaired(deviceAddress) {
        device.sendMessageToDevice(deviceAddress, 'text', dictionary.telegram.WELCOME);
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

        const inputAddressScene = new Scenes.BaseScene('inputAddressScene');

        inputAddressScene.enter((ctx) => {
            ctx.reply(dictionary.telegram.SEND_WALLET);
        });

        const stage = new Scenes.Stage([inputAddressScene]);

        this.client.use(session());
        this.client.use(stage.middleware());

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

                const existedAttestations = await this.db.getAttestationOrders({ data: { userId, username }, address });
                let orderId;

                if (existedAttestations) {
                    if (existedAttestations.status === "attested") {
                        return await ctx.reply(dictionary.common.ALREADY_ATTESTED);
                    } else {
                        orderId = existedAttestations[0].id;
                    }
                } else {
                    orderId = await this.db.createAttestationOrder({ username, userId }, address, true);
                }

                if (deviceAddress) {
                    await this.db.updateDeviceAddressInAttestationOrder(orderId, deviceAddress);
                }

                await ctx.reply('Is everything correct?', Markup.inlineKeyboard([
                    [Markup.button.callback('Yes', 'attestedCallbackAction')],
                    [Markup.button.callback('No, I want to change', 'removeCallbackAction')]
                ]).resize().oneTime());

                this.client.action('attestedCallbackAction', async (ctx) => {
                    const dataObj = { username, userId };

                    this.logger.error('attestedCallbackAction: dataObj:', dataObj);

                    try {
                        await ctx.answerCbQuery();
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
                });

                this.client.action('removeCallbackAction', async (ctx) => {
                    try {
                        await this.db.removeWalletAddressInAttestationOrder({ username, userId }, address);
                        await this.sessionStore.deleteSession(deviceAddress);

                        await ctx.scene.enter('inputAddressScene');
                    } catch (err) {
                        this.logger.error('removeCallbackAction: Error while processing address:', err);
                        await ctx.reply('removeCallbackAction: Unknown error occurred');
                    } finally {
                        await ctx.answerCbQuery();
                        await ctx.deleteMessage();
                    }
                });

            } else {
                ctx.reply(dictionary.telegram.ATTESTATION_COMMAND);
            }
        });

        this.client.command('remove', async (ctx) => {
            try {
                await this.db.removeWalletAddressInAttestationOrder({ userId: ctx.update.message.from.id, username: ctx.update.message.from.username });
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
                await this.db.createAttestationOrder({ username, userId: id }, null, true);

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
                    const orders = await this.db.getAttestationOrders({ data: { userId: id, username } }, true);

                    if (isArray(orders) && orders.length > 0) {
                        const isDataHasBeenAlreadyAttested = orders.find(order => order.user_wallet_address === walletAddress && order.status === 'attested');
                        if (isDataHasBeenAlreadyAttested) {
                            await ctx.reply(dictionary.common.ALREADY_ATTESTED);
                            return await ctx.scene.leave();
                        } else {
                            await ctx.reply(dictionary.common.ADDRESS_RECEIVED);

                            await this.db.updateWalletAddressInAttestationOrder({ userId: id, username }, walletAddress);

                            const verifyUrl = this.getVerifyUrl(walletAddress, { userId: id, username });

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