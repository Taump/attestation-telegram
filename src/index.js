const { start, dictionary } = require("attestation-kit");

dictionary.set("telegram");

const TelegramStrategy = require("./TelegramStrategy");
const webserver = require("./webserver");

start(async () => {
    new TelegramStrategy({
        token: process.env.TELEGRAM_BOT_TOKEN
    })

    await webserver();
});
