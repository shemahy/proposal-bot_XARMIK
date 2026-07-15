require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');

const token = process.env.BOT_TOKEN;
const adminChatId = process.env.ADMIN_CHAT_ID;

if (!token || !adminChatId) {
  console.error("КРИТИЧЕСКАЯ ОШИБКА: Переменные BOT_TOKEN или ADMIN_CHAT_ID не заданы!");
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: false });
const app = express();
app.use(express.json());

const messageRelations = new Map();

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  if (chatId.toString() === adminChatId.toString()) {
    bot.sendMessage(chatId, "Вы вошли как администратор. Сюда будут приходить предложения пользователей.");
  } else {
    bot.sendMessage(chatId, "👋 Привет! Отправь мне своё предложение, отзыв или вопрос, и администраторы ответят тебе прямо здесь.");
  }
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const messageId = msg.message_id;

  if (msg.text && msg.text.startsWith('/')) return;

  if (chatId.toString() === adminChatId.toString()) {
    if (msg.reply_to_message) {
      const repliedMsgId = msg.reply_to_message.message_id;
      let targetUserId = messageRelations.get(repliedMsgId);

      if (!targetUserId && msg.reply_to_message.text) {
        const match = msg.reply_to_message.text.match(/\[ID:\s*(\d+)\]/);
        if (match) targetUserId = match[1];
      }
      if (!targetUserId && msg.reply_to_message.caption) {
        const match = msg.reply_to_message.caption.match(/\[ID:\s*(\d+)\]/);
        if (match) targetUserId = match[1];
      }

      if (targetUserId) {
        try {
          if (msg.text) {
            await bot.sendMessage(targetUserId, `💬 **Ответ от администрации:**\n\n${msg.text}`, { parse_mode: 'Markdown' });
          } else if (msg.photo) {
            const photoId = msg.photo[msg.photo.length - 1].file_id;
            await bot.sendPhoto(targetUserId, photoId, { caption: msg.caption ? `💬 **Ответ от администрации:**\n\n${msg.caption}` : '💬 **Ответ от администрации**', parse_mode: 'Markdown' });
          } else if (msg.document) {
            await bot.sendDocument(targetUserId, msg.document.file_id, { caption: msg.caption });
          } else if (msg.voice) {
            await bot.sendVoice(targetUserId, msg.voice.file_id, { caption: msg.caption });
          } else {
            await bot.copyMessage(targetUserId, adminChatId, messageId);
          }
          await bot.sendMessage(adminChatId, "✅ Ответ успешно доставлен пользователю.");
        } catch (error) {
          console.error("Ошибка при отправке:", error);
          await bot.sendMessage(adminChatId, "❌ Не удалось отправить ответ.");
        }
      } else {
        await bot.sendMessage(adminChatId, "⚠️ Не удалось определить получателя.");
      }
    }
    return;
  }

  try {
    const username = msg.from.username ? `@${msg.from.username}` : 'Скрыт';
    const name = `${msg.from.first_name || ''} ${msg.from.last_name || ''}`.trim();
    const infoHeader = `📩 **Новое предложение**\n👤 От: ${name} (${username})\n🆔 [ID: ${chatId}]\n\n`;

    let forwardedMsg;

    if (msg.text) {
      forwardedMsg = await bot.sendMessage(adminChatId, `${infoHeader}${msg.text}`, { parse_mode: 'Markdown' });
    } else {
      forwardedMsg = await bot.forwardMessage(adminChatId, chatId, messageId);
      await bot.sendMessage(adminChatId, `${infoHeader}☝️ Выше отправлен медиафайл. Ответьте на это сообщение (Reply), чтобы написать пользователю.`, { 
        parse_mode: 'Markdown',
        reply_to_message_id: forwardedMsg.message_id 
      });
    }

    messageRelations.set(forwardedMsg.message_id, chatId);
    await bot.sendMessage(chatId, "✨ Спасибо! Ваше сообщение передано администраторам. Ожидайте ответа.");
  } catch (error) {
    console.error("Ошибка при пересылке:", error);
  }
});

app.get('/', (req, res) => {
  res.status(200).send('Proposal Bot is running via Webhooks!');
});

app.post(`/bot${token}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`Сервер запущен на порту ${PORT}`);
  const renderUrl = process.env.RENDER_EXTERNAL_URL;
  if (renderUrl) {
    const webhookUrl = `${renderUrl}/bot${token}`;
    try {
      await bot.setWebHook(webhookUrl);
      console.log(`Вебхук успешно установлен: ${webhookUrl}`);
    } catch (err) {
      console.error("Ошибка установки вебхука:", err);
    }
  }
});
