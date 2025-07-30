// 🔌 Load environment variables
require('dotenv').config();

// 🌐 Express server to keep bot alive and receive webhook
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// 📦 Core libraries
const axios = require('axios');
const { Telegraf } = require('telegraf');
const wallets = require('./wallets.json');

const bot = new Telegraf(process.env.BOT_TOKEN);
const API_KEY = process.env.ETHERSCAN_API;

const CHECK_INTERVAL = 60 * 60 * 1000; // 1 hour
const TIME_WINDOW = 60 * 60; // last 1 hour in seconds

let isBotActive = true;
let lastBlocks = {};

// Format token or ETH amount
function formatAmount(value, decimals = 18) {
  return (Number(value) / 10 ** decimals).toFixed(6);
}

// Format short address
function shortAddress(addr) {
  if (!addr || typeof addr !== 'string') return 'N/A';
  return addr.substring(0, 6) + '...' + addr.slice(-4);
}

// Main transaction checker
async function checkTransactions() {
  if (!isBotActive) return;

  const now = Math.floor(Date.now() / 1000);
  const timeWindow = now - TIME_WINDOW;

  for (const wallet of wallets) {
    const address = wallet.address.toLowerCase();
    const name = wallet.name;
    const fromBlock = lastBlocks[address] || 0;

    console.log(`🔍 Checking transactions for ${name}: ${address}`);

    // ETH transactions
    try {
      const ethUrl = `https://api.etherscan.io/api?module=account&action=txlist&address=${address}&startblock=${fromBlock}&endblock=99999999&sort=asc&apikey=${API_KEY}`;
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

    // ERC-20 token transactions
    try {
      const tokenUrl = `https://api.etherscan.io/api?module=account&action=tokentx&address=${address}&startblock=${fromBlock}&endblock=99999999&sort=asc&apikey=${API_KEY}`;
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

// Start periodic transaction checking
setInterval(checkTransactions, CHECK_INTERVAL);

// Express route for health check
app.get('/', (_req, res) => {
  res.send('🤖 Ethereum & ERC-20 Monitor Bot is Alive!');
});

// Webhook path
const webhookPath = `/bot${process.env.BOT_TOKEN}`;
app.use(bot.webhookCallback(webhookPath));

// Start Express server
app.listen(PORT, () => {
  console.log(`🌐 Server listening on port ${PORT}`);
  console.log(`🌐 Webhook path: ${webhookPath}`);
});

// Start bot without polling (webhook mode)
(async () => {
  try {
    // Remove polling, just start bot
    console.log('🤖 Bot webhook mode enabled, ready to receive updates.');
  } catch (error) {
    console.error('❌ Bot launch error:', error);
  }
})();
