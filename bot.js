// 🔌 Load environment variables
require('dotenv').config();

// 🌐 Express server to keep bot alive
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (_req, res) => {
  res.send('🤖 Ethereum & ERC-20 Monitor Bot is Alive!');
});

app.listen(PORT, () => {
  console.log(`🌐 Server running on port ${PORT}`);
});

// 📦 Core libraries
const axios = require('axios');
const { Telegraf } = require('telegraf');
const wallets = require('./wallets.json');

const bot = new Telegraf(process.env.BOT_TOKEN);
const API_KEY = process.env.ETHERSCAN_API;
const CHECK_INTERVAL = 60 * 60 * 1000; // ⏱️ Every 1 hour
const TIME_WINDOW = 60 * 60; // ⏳ Scan last 1 hour

let isBotActive = true;
let lastBlocks = {};

// 📐 Format token/ETH value
function formatAmount(value, decimals = 18) {
  return (Number(value) / 10 ** decimals).toFixed(6);
}

// 🏷️ Format short address
function shortAddress(addr) {
  if (!addr || typeof addr !== 'string') return 'N/A';
  return addr.substring(0, 6) + '...' + addr.slice(-4);
}

// 🔍 Main Checker
async function checkTransactions() {
  if (!isBotActive) return;

  const now = Math.floor(Date.now() / 1000);
  const timeWindow = now - TIME_WINDOW;

  for (const wallet of wallets) {
    const address = wallet.address.toLowerCase();
    const name = wallet.name;
    const fromBlock = lastBlocks[address] || 0;

    console.log(`🔍 Checking ${name}: ${address}`);

    // 📥 ETH transactions
    const ethUrl = `https://api.etherscan.io/api?module=account&action=txlist&address=${address}&startblock=${fromBlock}&endblock=99999999&sort=asc&apikey=${API_KEY}`;

    try {
      const ethRes = await axios.get(ethUrl);
      const ethTxs = ethRes.data.result;

      for (const tx of ethTxs) {
        const block = parseInt(tx.blockNumber);
        const txTime = parseInt(tx.timeStamp);
        if (block <= fromBlock || txTime < timeWindow) continue;

        const to = tx.to?.toLowerCase();
        const from = tx.from?.toLowerCase();
        if (!to || !from) continue;

        const isDeposit = to === address;
        const isWithdrawal = from === address;
        if (!isDeposit && !isWithdrawal) continue;

        const value = formatAmount(tx.value, 18);
        const alertType = isWithdrawal ? '🔴 ETH Sent' : '🟢 ETH Received';

        const message = `
${alertType}

👤 Wallet: *${name}*
💰 Amount: *${value} ETH*
📤 From: ${shortAddress(tx.from)}
📥 To: ${shortAddress(tx.to)}
🧾 [View TX](https://etherscan.io/tx/${tx.hash})
🕐 ${new Date(txTime * 1000).toLocaleString()}
        `;

        await bot.telegram.sendMessage(process.env.CHAT_ID, message, { parse_mode: 'Markdown' });
        lastBlocks[address] = block;
      }
    } catch (error) {
      console.error('❌ ETH Error:', error.message);
    }

    // 💠 ERC-20 tokens
    const tokenUrl = `https://api.etherscan.io/api?module=account&action=tokentx&address=${address}&startblock=${fromBlock}&endblock=99999999&sort=asc&apikey=${API_KEY}`;

    try {
      const tokenRes = await axios.get(tokenUrl);
      const tokenTxs = tokenRes.data.result;

      for (const tx of tokenTxs) {
        const block = parseInt(tx.blockNumber);
        const txTime = parseInt(tx.timeStamp);
        if (block <= fromBlock || txTime < timeWindow) continue;

        const to = tx.to?.toLowerCase();
        const from = tx.from?.toLowerCase();
        if (!to || !from) continue;

        const isDeposit = to === address;
        const isWithdrawal = from === address;
        if (!isDeposit && !isWithdrawal) continue;

        const symbol = tx.tokenSymbol || 'Unknown';
        const decimals = tx.tokenDecimal ? parseInt(tx.tokenDecimal) : 18;
        const value = formatAmount(tx.value, decimals);
        const alertType = isWithdrawal ? `🔴 Sent ${symbol}` : `🟢 Received ${symbol}`;

        const message = `
${alertType}

👤 Wallet: *${name}*
💰 Amount: *${value} ${symbol}*
📤 From: ${shortAddress(tx.from)}
📥 To: ${shortAddress(tx.to)}
🧾 [View TX](https://etherscan.io/tx/${tx.hash})
🕐 ${new Date(txTime * 1000).toLocaleString()}
        `;

        await bot.telegram.sendMessage(process.env.CHAT_ID, message, { parse_mode: 'Markdown' });
        lastBlocks[address] = block;
      }
    } catch (error) {
      console.error('❌ Token Error:', error.message);
    }
  }
}

// 🔁 Run on interval
setInterval(checkTransactions, CHECK_INTERVAL);

// 🧠 Telegram commands
bot.command('start', (ctx) => {
  isBotActive = true;
  ctx.reply('✅ Bot monitoring resumed.');
});

bot.command('stop', (ctx) => {
  isBotActive = false;
  ctx.reply('⏸️ Bot monitoring paused.');
});

bot.launch();
console.log('🤖 Bot started and watching wallet movements every hour...');
