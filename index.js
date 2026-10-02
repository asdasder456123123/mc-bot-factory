require("dotenv").config();

const { Client, GatewayIntentBits } = require("discord.js");
const mineflayer = require("mineflayer");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const activeBots = new Map();
const botHealth = new Map();
const alertState = new Map();
const warnedBots = new Set();
const botOwners = new Map(); // botName -> Discord user ID
const MAX_BOTS_PER_USER = 2;

const AUTH_PASS = "0.963852963";
const ALERT_CHANNEL_ID = "1544256191864250388";

function normalizeBotName(name) {
    return name.toUpperCase();
}

async function sendAlert(text) {
    try {
        const channel = await client.channels.fetch(ALERT_CHANNEL_ID);

        if (channel?.isTextBased()) {
            await channel.send(text);
        }
    } catch (err) {
        console.error(`[Discord Alert] ${err.message}`);
    }
}

async function sendFirstWarning(botName) {
    if (warnedBots.has(botName)) return;

    warnedBots.add(botName);

    await sendAlert(
        `⚠️ **تنبيه — ${botName}**\n` +
        `الحساب جديد وتحت التطوير، وقد يحدث خروج أو إعادة اتصال تلقائي.\n` +
        `سيحاول الروبوت العودة إلى السيرفر تلقائيًا عند انقطاع الاتصال.`
    );
}

function createMcBot(ip, port, botName, version, ownerId) {
    botName = normalizeBotName(botName);

    if (activeBots.has(botName)) return;

    botOwners.set(botName, ownerId);

    let reconnectTimer = null;
    let stopped = false;
    let currentBot = null;
    let reconnectDelay = 5000;
    let reconnecting = false;
    let lastActivity = Date.now();
    let consecutiveFailures = 0;

    sendFirstWarning(botName);

    const connect = () => {
        if (stopped || currentBot) return;

        console.log(
            `جاري الاتصال بـ ${ip}:${port} باسم ${botName}...`
        );

        let mcBot;

        try {
            mcBot = mineflayer.createBot({
                host: ip,
                port,
                username: botName,
                auth: "offline",
                version:
                    version && version !== "auto"
                        ? version
                        : undefined,
                checkTimeoutInterval: 60000
            });
        } catch (err) {
            console.error(
                `[إنشاء الاتصال] ${botName}: ${err.message}`
            );

            scheduleReconnect();
            return;
        }

        currentBot = mcBot;
        lastActivity = Date.now();

        activeBots.set(botName, {
            bot: mcBot,
            ownerId,
            stop: () => {
                stopped = true;

                if (reconnectTimer) {
                    clearTimeout(reconnectTimer);
                    reconnectTimer = null;
                }

                botOwners.delete(botName);
                botHealth.delete(botName);
                alertState.delete(botName);
                warnedBots.delete(botName);
                activeBots.delete(botName);

                try {
                    mcBot.quit();
                } catch {}
            }
        });

        let authDone = false;
        let authTimer = null;

        const scheduleAuth = (type) => {
            if (authDone) return;

            if (authTimer) {
                clearTimeout(authTimer);
            }

            authTimer = setTimeout(() => {
                if (authDone || !mcBot.entity) return;

                try {
                    if (type === "register") {
                        mcBot.chat(
                            `/register ${AUTH_PASS} ${AUTH_PASS}`
                        );
                        console.log(
                            `[AuthMe] ${botName}: register`
                        );
                    }

                    if (type === "login") {
                        mcBot.chat(`/login ${AUTH_PASS}`);
                        console.log(
                            `[AuthMe] ${botName}: login`
                        );
                    }
                } catch {}
            }, 300);
        };

        mcBot.on("login", () => {
            lastActivity = Date.now();
            consecutiveFailures = 0;
            botHealth.set(botName, "connected");
            reconnectDelay = 5000;

            console.log(
                `[تسجيل دخول] ${botName} اتصل بالسيرفر!`
            );
        });

        mcBot.on("messagestr", (message) => {
            lastActivity = Date.now();
            console.log(`[شات ${botName}]: ${message}`);

            const text = message.toLowerCase();

            if (
                !authDone &&
                (
                    text.includes("please register") ||
                    (
                        text.includes("register") &&
                        text.includes("password")
                    )
                )
            ) {
                scheduleAuth("register");
                return;
            }

            if (
                !authDone &&
                (
                    text.includes("please login") ||
                    (
                        text.includes("login") &&
                        text.includes("password")
                    )
                )
            ) {
                scheduleAuth("login");
                return;
            }

            if (
                text.includes("already logged in") ||
                text.includes("you are logged in") ||
                text.includes("successfully logged in")
            ) {
                authDone = true;

                if (authTimer) {
                    clearTimeout(authTimer);
                    authTimer = null;
                }
            }

            if (
                text.includes("successfully registered") ||
                text.includes("registration successful")
            ) {
                authDone = true;

                if (authTimer) {
                    clearTimeout(authTimer);
                    authTimer = null;
                }
            }
        });

        mcBot.on("spawn", () => {
            lastActivity = Date.now();
            consecutiveFailures = 0;
            botHealth.set(botName, "healthy");
            reconnectDelay = 5000;

            console.log(
                `[Spawn] ${botName} دخل العالم.`
            );

            if (reconnecting) {
                sendAlert(
                    `🟢 **${botName}** عاد إلى السيرفر بنجاح بعد انقطاع الاتصال.`
                );

                reconnecting = false;
            }
        });

        mcBot.on("end", (reason) => {
            lastActivity = Date.now();
            consecutiveFailures++;
            botHealth.set(botName, "reconnecting");
            console.log(
                `[خروج] ${botName}: ${reason || "socket closed"}`
            );

            if (currentBot === mcBot) {
                currentBot = null;
            }

            if (authTimer) {
                clearTimeout(authTimer);
                authTimer = null;
            }

            if (reconnectTimer) {
                clearTimeout(reconnectTimer);
                reconnectTimer = null;
            }

            if (stopped) return;

            reconnecting = true;

            const readableReason =
                typeof reason === "string" && reason.trim()
                    ? reason
                    : "انقطاع الاتصال أو إغلاق السيرفر";

            sendAlert(
                `🔴 **${botName}** خرج من السيرفر.\n` +
                `📌 السبب: \`${readableReason}\`\n` +
                `🔄 سيتم إعادة الاتصال تلقائيًا، حتى لو كان السيرفر مغلقًا حاليًا.`
            );

            scheduleReconnect();
        });

        mcBot.on("error", (err) => {
            lastActivity = Date.now();
            consecutiveFailures++;
            console.error(
                `[خطأ] ${botName}: ${err.message}`
            );
        });

        mcBot.on("kicked", (reason) => {
            console.log(
                `[طرد] ${botName}: ${reason}`
            );
        });
    };

    const scheduleReconnect = () => {
        if (stopped || currentBot || reconnectTimer) {
            return;
        }

        reconnectDelay = Math.min(
            Math.max(reconnectDelay, 5000),
            60000
        );

        console.log(
            `[إعادة اتصال] ${botName} سيحاول مرة أخرى خلال ` +
            `${Math.round(reconnectDelay / 1000)} ثانية...`
        );

        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;

            if (stopped || currentBot) return;

            connect();

            reconnectDelay = Math.min(
                reconnectDelay * 2,
                60000
            );
        }, reconnectDelay);
    };

    connect();
}


// ================================
// 🛡️ Smart Bot Monitoring
// ================================

setInterval(() => {
    for (const [botName, info] of activeBots) {
        const bot = info.bot;

        if (!bot) continue;

        const state = botHealth.get(botName) || "starting";

        console.log(
            `[Monitor] ${botName}: ${state} | ` +
            `active=${Boolean(bot.entity)}`
        );
    }
}, 60000);

// تنظيف بيانات البوتات التي لم تعد موجودة
setInterval(() => {
    for (const botName of botHealth.keys()) {
        if (!activeBots.has(botName)) {
            botHealth.delete(botName);
            alertState.delete(botName);
        }
    }
}, 300000);

client.once("ready", () => {
    console.log(
        `تم تسجيل الدخول باسم روبوت Discord: ${client.user.tag}`
    );

    console.log("البوت جاهز.");
});

client.on("messageCreate", (message) => {
    if (message.author.bot) return;

    const args = message.content.trim().split(/\s+/);
    const command = args.shift()?.toLowerCase();

    if (command === "!status") {
        if (activeBots.size === 0) {
            return message.reply("📊 لا يوجد أي روبوت Minecraft يعمل حاليًا.");
        }

        const lines = [];

        for (const [botName, info] of activeBots) {
            const bot = info.bot;
            const state = botHealth.get(botName) || "starting";

            let icon = "⚪";
            if (state === "healthy") icon = "🟢";
            else if (state === "connected") icon = "🔵";
            else if (state === "reconnecting") icon = "🟡";

            const connected = Boolean(bot?.entity);

            lines.push(
                `${icon} **${botName}**\n` +
                `الحالة: ${state}\n` +
                `داخل العالم: ${connected ? "نعم" : "لا"}`
            );
        }

        return message.reply(
            `📊 **حالة روبوتات Minecraft**\n\n${lines.join("\n\n")}`
        );
    }

    if (command === "!mybots") {
        const myBots = [...botOwners.entries()]
            .filter(([_, ownerId]) => ownerId === message.author.id)
            .map(([botName]) => botName);

        if (myBots.length === 0) {
            return message.reply(
                "📭 معندكش أي Minecraft bots شغالة حاليًا."
            );
        }

        return message.reply(
            `🤖 **البوتات بتاعتك (${myBots.length}/${MAX_BOTS_PER_USER})**\\n\\n` +
            myBots.map(name => `• **${name}**`).join("\\n")
        );
    }

    if (command === "!stop") {
        const botName = normalizeBotName(args[0] || "");

        if (!botName) {
            return message.reply(
                "❌ الاستخدام الصحيح: `!stop <BOT_NAME>`"
            );
        }

        const info = activeBots.get(botName);

        if (!info) {
            return message.reply(
                `❌ الروبوت **${botName}** مش شغال حاليًا.`
            );
        }

        if (botOwners.get(botName) !== message.author.id) {
            return message.reply(
                "🚫 مينفعش توقف روبوت مش بتاعك."
            );
        }

        info.stop();

        return message.reply(
            `🛑 تم إيقاف الروبوت **${botName}** وتحرير مكان من حد البوتات.`
        );
    }

    if (command !== "!start") return;

    const ip = args[0];
    const port = Number(args[1]);
    const requestedName = args[2];
    const version = args[3] || "auto";

    if (!ip || !Number.isInteger(port) || !requestedName) {
        return message.reply(
            "❌ الاستخدام الصحيح:\n" +
            "`!start <IP> <PORT> <BOT_NAME> [VERSION]`"
        );
    }

    const botName = normalizeBotName(requestedName);
    const ownerId = message.author.id;

    if (activeBots.has(botName)) {
        return message.reply(
            `⚠️ الروبوت **${botName}** شغال بالفعل!`
        );
    }

    const userBotCount = [...botOwners.values()]
        .filter(id => id === ownerId)
        .length;

    if (userBotCount >= MAX_BOTS_PER_USER) {
        const myBots = [...botOwners.entries()]
            .filter(([_, id]) => id === ownerId)
            .map(([name]) => name);

        return message.reply(
            `🚫 **وصلت للحد الأقصى (${MAX_BOTS_PER_USER}/${MAX_BOTS_PER_USER})**\\n\\n` +
            `🤖 **البوتات بتاعتك:**\\n` +
            myBots.map(name => `• **${name}**`).join("\\n") +
            `\\n\\n🛑 **إيقاف بوت:**\\n` +
            `\`!stop <BOT_NAME>\`\\n\\n` +
            `📋 **عرض بوتاتك:**\\n` +
            `\`!mybots\`\\n\\n` +
            `▶️ **تشغيل بوت بعد إيقاف واحد:**\\n` +
            `\`!start <IP> <PORT> <BOT_NAME> [VERSION]\``
        );
    }

    message.reply(
        `🔄 جاري تشغيل **${botName}** على ` +
        `\`${ip}:${port}\` بإصدار \`${version}\`...`
    );

    createMcBot(
        ip,
        port,
        botName,
        version,
        ownerId
    );
});

client.login(process.env.TOKEN);
