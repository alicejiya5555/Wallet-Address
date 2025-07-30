// 🔌 Load env variables
require('dotenv').config();

// 🌐 Express setup
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// 📦 Core
const axios = require('axios');
const { Telegraf } = require('telegraf');

// Wallets to monitor
const wallets = [
  { name: 'Check Tether', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7' },
  { name: 'Own ERC', address: '0xbDCcF65a7b2a4b19601d097457c329064C1f5704' },
  { name: 'Ivan Colombia', address: '0x857c67C421d3E94daC5aBB0EaA4d34b26722B4fB' },
  { name: 'Chain-Link', address: '0x514910771AF9Ca656af840dff83E8264EcF986CA' },
  { name: 'ChainLink-2', address: '0x20145C5e27408B5C1CF2239d0115EE3BBc27CbD7' },
];

// Constants and instances
const bot = new Telegraf(process.env.BOT_TOKEN);
const API_KEY = process.env.ETHERSCAN_API;
const CHECK_INTERVAL = 60 * 1000; // 1 minute
const TIME_WINDOW = 60; // 1 minute in seconds

let isBotActive = true;
let lastBlocks = {};

// Format amount with decimals
function formatAmount(value, decimals = 18) {
  return (Number(value) / 10 ** decimals).toFixed(6);
}

// Shorten address display
function shortAddress(addr) {
  if (!addr || typeof addr !== 'string') return 'N/A';
  return addr.substring(0, 6) + '...' + addr.slice(-4);
}

// Main transaction check function
async function checkTransactions() {
  if (!isBotActive) return;

  const now = Math.floor(Date.now() / 1000);
  const timeWindow = now - TIME_WINDOW;

  for (const wallet of wallets) {
    const address = wallet.address.toLowerCase();
    const name = wallet.name;
    const fromBlock = lastBlocks[address] || 0;

    // ETH transactions
    try {
      const ethUrl = `https://api.etherscan.io/api?module=account&action=txlist&address=${address}&startblock=${fromBlock}&endblock=99999999&sort=asc&apikey=${API_KEY}`;
      const ethRes = await axios.get(ethUrl);
      const ethTxs = ethRes.data.result || [];

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
        const alertType = isWithdrawal ? '🔴 ETH Withdraw' : '🟢 ETH Deposit';

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
    } catch (err) {
      console.error('❌ ETH Error:', err.message);
    }

    // ERC-20 token transactions (includes USDT, Chainlink, and others)
    try {
      const tokenUrl = `https://api.etherscan.io/api?module=account&action=tokentx&address=${address}&startblock=${fromBlock}&endblock=99999999&sort=asc&apikey=${API_KEY}`;
      const tokenRes = await axios.get(tokenUrl);
      const tokenTxs = tokenRes.data.result || [];

      for (const tx of tokenTxs) {
        const block = parseInt(tx.blockNumber);
        const txTime = parseInt(tx.timeStamp);

        if (block <= fromBlock || txTime < timeWindow) continue;

        const to = tx.to?.toLowerCase();
        const from = tx.from?.toLowerCase();

        if (!to || !from) continue;

        const isDeposit = to === address;
        const isWithdrawal = from === address;

        // Identify swap by neither sending nor receiving the wallet address directly
        const isSwap = !isDeposit && !isWithdrawal;

        const symbol = tx.tokenSymbol || 'Unknown';
        const decimals = tx.tokenDecimal ? parseInt(tx.tokenDecimal) : 18;
        const value = formatAmount(tx.value, decimals);

        let alertType = '🟡 Token Swap';
        if (isWithdrawal) alertType = `🔴 Withdraw ${symbol}`;
        else if (isDeposit) alertType = `🟢 Deposit ${symbol}`;

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
    } catch (err) {
      console.error('❌ Token Error:', err.message);
    }
  }
}

// Telegram bot commands
bot.command('start', ctx => {
  isBotActive = true;
  ctx.reply('✅ Bot monitoring resumed.');
});

bot.command('stop', ctx => {
  isBotActive = false;
  ctx.reply('⏸️ Bot monitoring paused.');
});

// Express health check endpoint
app.get('/', (_req, res) => {
  res.send('🤖 Ethereum & ERC-20 Monitor Bot is Alive!');
});

// Telegram webhook setup
const webhookPath = `/bot${process.env.BOT_TOKEN}`;
app.use(bot.webhookCallback(webhookPath));

// Start Express server
app.listen(PORT, () => {
  console.log(`🌐 Server running on port ${PORT}`);
  console.log(`🌐 Webhook path: ${webhookPath}`);
});

// Start periodic transaction checking every 1 minute
setInterval(checkTransactions, CHECK_INTERVAL);

// No polling in webhook mode
console.log('🤖 Bot started in webhook mode, watching transactions...');
