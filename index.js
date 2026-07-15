require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');

// Получаем переменные окружения и очищаем их от случайных пробелов
const token = process.env.BOT_TOKEN ? process.env.BOT_TOKEN.trim() : null;
const adminChatId = process.env.ADMIN_CHAT_ID ? process.env.ADMIN_CHAT_ID.trim() : null;

if (!token || !adminChatId) {
  console.error("КРИТИЧЕСКАЯ ОШИБКА: Переменные BOT_TOKEN или ADMIN_CHAT_ID не заданы!");
  process.exit(1);
}

// Создаем инстанс бота. polling: false обязателен для вебхуков на Render!
const bot = new TelegramBot(token, { polling: false });

const app = express();
app.use(express.json());

// Хранилище связей в оперативной памяти (ID сообщения в админке -> ID пользователя)
const messageRelations = new Map();
let botInfo = null; // Здесь будут храниться данные бота (его ID), чтобы фильтровать реплаи

// Функция для безопасного экранирования HTML, чтобы бот не падал из-за спецсимволов в именах
const escapeHTML = (text) => {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
};

// Обработка команды /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  if (chatId.toString() === adminChatId.toString()) {
    bot.sendMessage(chatId, "Вы зарегистрированы как администратор. Сюда будут приходить предложения пользователей.");
  } else {
    bot.sendMessage(chatId, "👋 Привет! Отправь мне своё предложение, отзыв или вопрос, и администраторы ответят тебе прямо здесь.");
  }
});

// Обработка всех входящих сообщений
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const messageId = msg.message_id;

  // Игнорируем текстовые команды
  if (msg.text && msg.text.startsWith('/')) return;

  // --- ЛОГИКА АДМИНИСТРАТОРА (Ответ пользователю) ---
  if (chatId.toString() === adminChatId.toString()) {
    if (msg.reply_to_message) {
      // Защита: реагируем только если админ ответил на сообщение бота
      if (botInfo && msg.reply_to_message.from.id !== botInfo.id) {
        return; 
      }

      const repliedMsgId = msg.reply_to_message.message_id;
      let targetUserId = messageRelations.get(repliedMsgId);

      // Резервный поиск ID в тексте/подписи (если сервер перезапустился и очистил Map)
      if (!targetUserId) {
        const sourceText = msg.reply_to_message.text || msg.reply_to_message.caption || '';
        const match = sourceText.match(/\[ID:\s*(\d+)\]/);
        if (match) {
          targetUserId = match[1];
        }
      }

      if (targetUserId) {
        try {
          if (msg.text) {
            // Если админ ответил простым текстом
            await bot.sendMessage(targetUserId, `💬 <b>Ответ от администрации:</b>\n\n${escapeHTML(msg.text)}`, { parse_mode: 'HTML' });
          } else {
            // Если админ ответил медиафайлом (фото, док, голосовое и т.д.)
            const options = { parse_mode: 'HTML' };
            if (msg.caption) {
              options.caption = `💬 <b>Ответ от администрации:</b>\n\n${escapeHTML(msg.caption)}`;
            } else {
              options.caption = `💬 <b>Ответ от администрации</b>`;
            }
            await bot.copyMessage(targetUserId, adminChatId, messageId, options);
          }
          await bot.sendMessage(adminChatId, "✅ Ответ успешно доставлен.");
        } catch (error) {
          console.error("Ошибка при отправке ответа пользователю:", error);
          await bot.sendMessage(adminChatId, "❌ Не удалось отправить ответ. Возможно, пользователь заблокировал бота.");
        }
      } else {
        await bot.sendMessage(adminChatId, "⚠️ Не удалось определить получателя. Сообщение слишком старое или сервер был перезапущен.");
      }
    }
    return;
  }

  // --- ЛОГИКА ПОЛЬЗОВАТЕЛЯ (Отправка предложения админам) ---
  try {
    const username = msg.from.username ? `@${escapeHTML(msg.from.username)}` : 'Скрыт';
    const name = escapeHTML(`${msg.from.first_name || ''} ${msg.from.last_name || ''}`.trim());
    const infoHeader = `📩 <b>Новое предложение</b>\n👤 От: ${name} (${username})\n🆔 [ID: ${chatId}]\n\n`;

    let adminMsg;

    if (msg.text) {
      // Текстовое предложение
      adminMsg = await bot.sendMessage(adminChatId, `${infoHeader}${escapeHTML(msg.text)}`, { parse_mode: 'HTML' });
      messageRelations.set(adminMsg.message_id, chatId);
    } else {
      // Предложение с медиа (фото, видео, документ, аудио, голосовое, анимация)
      const options = {
        caption: `${infoHeader}${escapeHTML(msg.caption || '')}`,
        parse_mode: 'HTML'
      };
      
      // Копируем сообщение пользователя в админ-чат, добавляя инфо-шапку в подпись
      adminMsg = await bot.copyMessage(adminChatId, chatId, messageId, options);
      messageRelations.set(adminMsg.message_id, chatId);
    }

    // Подтверждение пользователю
    await bot.sendMessage(chatId, "✨ Спасибо! Ваше сообщение передано администраторам. Ожидайте ответа.");
  } catch (error) {
    console.error("Ошибка при пересылке предложения:", error);
  }
});

// Базовый роут для проверки работоспособности (хелсчек)
app.get('/', (req, res) => {
  res.status(200).send('Proposal Bot is running via Webhooks!');
});

// Защищенный роут для приема обновлений от Telegram
app.post(`/bot${token}`, (req, res) => {
  try {
    bot.processUpdate(req.body);
  } catch (err) {
    console.error("Ошибка при обработке вебхука:", err);
  }
  res.sendStatus(200); // Всегда возвращаем 200 OK для Telegram
});

// Запуск сервера Express
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`Сервер запущен на порту ${PORT}`);
  
  try {
    // Получаем информацию о боте на старте для фильтрации реплаев
    botInfo = await bot.getMe();
    console.log(`Бот авторизован: @${botInfo.username}`);
  } catch (err) {
    console.error("Ошибка получения информации о боте:", err);
  }

  const renderUrl = process.env.RENDER_EXTERNAL_URL;
  if (renderUrl) {
    const webhookUrl = `${renderUrl}/bot${token}`;
    try {
      await bot.setWebHook(webhookUrl);
      console.log(`Вебхук успешно установлен: ${webhookUrl}`);
    } catch (err) {
      console.error("Ошибка установки вебхука:", err);
    }
  } else {
    console.log("Внимание: RENDER_EXTERNAL_URL не задан. Сервер ожидает вебхуков локально.");
  }
});});

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
