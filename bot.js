// 🔌 Load environment variables first
require('dotenv').config();

// 🌐 Tiny express server to keep host alive
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (_req, res) => {
  res.send('🤖 Ethereum Wallet Monitor Bot is alive!');
});

app.listen(PORT, () => {
  console.log(`🌐 Server is running on port ${PORT}`);
});

const axios = require('axios');
const { Telegraf } = require('telegraf');
const fs = require('fs');

const bot = new Telegraf(process.env.BOT_TOKEN);
const API_KEY = process.env.ETHERSCAN_API;
const CHECK_INTERVAL = 60 * 1000; // every 1 min
const wallets = require('./wallets.json');

let isBotActive = true;
let lastBlocks = {};

// 📐 Format token values
function formatAmount(value, decimals = 18) {
  return (Number(value) / 10 ** decimals).toFixed(6);
}

// 🏷️ Format address short
function shortAddress(addr) {
  return addr.substring(0, 6) + '...' + addr.slice(-4);
}

// ⏱️ Time window: 5 minutes
const FIVE_MINUTES = 5 * 60;

// 🔍 Main ERC-20 Transaction Checker
async function checkTransactions() {
  if (!isBotActive) return;

  const now = Math.floor(Date.now() / 1000);
  const timeWindow = now - FIVE_MINUTES;

  for (const wallet of wallets) {
    const address = wallet.address.toLowerCase();
    const name = wallet.name;
    const fromBlock = lastBlocks[address] || 0;

    const tokenUrl = `https://api.etherscan.io/api?module=account&action=tokentx&address=${address}&startblock=${fromBlock}&endblock=99999999&sort=asc&apikey=${API_KEY}`;

    try {
      const tokenRes = await axios.get(tokenUrl);
      const tokenTxs = tokenRes.data.result;

      for (const tx of tokenTxs) {
        const block = parseInt(tx.blockNumber);
        const txTime = parseInt(tx.timeStamp);

        // ⏳ Skip if older than 5 mins
        if (block <= fromBlock || txTime < timeWindow) continue;

        const isDeposit = tx.to.toLowerCase() === address;
        const isWithdrawal = tx.from.toLowerCase() === address;
        const symbol = tx.tokenSymbol || 'Unknown';
        const value = formatAmount(tx.value, tx.tokenDecimal || 18);

        let alertType = '🟢 Deposit';
        if (isWithdrawal) alertType = '🔴 Withdraw';
        if (!isWithdrawal && !isDeposit) alertType = '🟡 Transfer';

        const message = `
${alertType} ${symbol}

👤 Wallet: *${name}*
💰 Amount: *${value} ${symbol}*
📤 From: ${shortAddress(tx.from)}
📥 To: ${shortAddress(tx.to)}
🧾 Hash: [View TX](https://etherscan.io/tx/${tx.hash})
🕐 Time: ${new Date(txTime * 1000).toLocaleString()}
        `;

        await bot.telegram.sendMessage(process.env.CHAT_ID, message, { parse_mode: 'Markdown' });
        lastBlocks[address] = block;
      }
    } catch (error) {
      console.error('❌ Error checking transactions:', error.message);
    }
  }
}

// ⏱️ Check on interval
setInterval(checkTransactions, CHECK_INTERVAL);

// 🛠️ Telegram Commands
bot.command('start', (ctx) => {
  isBotActive = true;
  ctx.reply('✅ Bot monitoring resumed.');
});

bot.command('stop', (ctx) => {
  isBotActive = false;
  ctx.reply('⏸️ Bot monitoring paused.');
});

bot.launch();
console.log('🤖 Bot started!');
