// 🔌 Load environment variables
require('dotenv').config();

const axios = require('axios');
const { Telegraf } = require('telegraf');
const express = require('express');
const app = express();

const PORT = process.env.PORT || 3000;

const bot = new Telegraf(process.env.BOT_TOKEN);
const API_KEY = process.env.ETHERSCAN_API;
const CHECK_INTERVAL = 60 * 1000; // Check every 1 min
const TIME_WINDOW = 60 * 60; // 1 hour

const wallets = [
  { name: 'Own ERC', address: '0xbDCcF65a7b2a4b19601d097457c329064C1f5704' },
  { name: 'Ivan Colombia', address: '0x857c67C421d3E94daC5aBB0EaA4d34b26722B4fB' },
  { name: 'ChainLink-2', address: '0x20145C5e27408B5C1CF2239d0115EE3BBc27CbD7' },
  { name: 'Tether', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7' }
];

let isBotActive = true;
let lastBlocks = {};

// Format amounts
function formatAmount(value, decimals = 18) {
  return (Number(value) / 10 ** decimals).toFixed(6);
}

function shortAddress(addr) {
  if (!addr || typeof addr !== 'string') return 'N/A';
  return addr.slice(0, 6) + '...' + addr.slice(-4);
}

function updateLastBlock(address, block) {
  if (!lastBlocks[address] || block > lastBlocks[address]) {
    lastBlocks[address] = block;
  }
}

// 🧾 Transaction Checker
async function checkTransactions() {
  if (!isBotActive) return;

  const now = Math.floor(Date.now() / 1000);
  const timeWindow = now - TIME_WINDOW;

  for (const wallet of wallets) {
    const address = wallet.address.toLowerCase();
    const name = wallet.name;
    let fromBlock = lastBlocks[address] || 0;

    // === ETH Transactions ===
    try {
      const ethUrl = `https://api.etherscan.io/api?module=account&action=txlist&address=${address}&startblock=${fromBlock + 1}&endblock=99999999&sort=asc&apikey=${API_KEY}`;
      const ethRes = await axios.get(ethUrl);
      const ethTxs = ethRes.data.result || [];

      for (const tx of ethTxs) {
        const block = parseInt(tx.blockNumber);
        const txTime = parseInt(tx.timeStamp);

        if (block <= fromBlock || txTime < timeWindow) continue;

        const isDeposit = tx.to?.toLowerCase() === address;
        const isWithdrawal = tx.from?.toLowerCase() === address;
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
        updateLastBlock(address, block);
      }
    } catch (err) {
      console.error(`❌ ETH Error [${name}]:`, err.message);
    }

    // === ERC-20 Token Transactions ===
    try {
      const tokenUrl = `https://api.etherscan.io/api?module=account&action=tokentx&address=${address}&startblock=${fromBlock + 1}&endblock=99999999&sort=asc&apikey=${API_KEY}`;
      const tokenRes = await axios.get(tokenUrl);
      const tokenTxs = tokenRes.data.result || [];

      for (const tx of tokenTxs) {
        const block = parseInt(tx.blockNumber);
        const txTime = parseInt(tx.timeStamp);

        if (block <= fromBlock || txTime < timeWindow) continue;

        const isDeposit = tx.to?.toLowerCase() === address;
        const isWithdrawal = tx.from?.toLowerCase() === address;
        if (!isDeposit && !isWithdrawal) continue;

        const symbol = tx.tokenSymbol || 'Unknown';
        const decimals = tx.tokenDecimal ? parseInt(tx.tokenDecimal) : 18;
        const value = formatAmount(tx.value, decimals);
        const alertType = isWithdrawal ? `🔴 Withdraw ${symbol}` : `🟢 Deposit ${symbol}`;

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
        updateLastBlock(address, block);
      }
    } catch (err) {
      console.error(`❌ Token Error [${name}]:`, err.message);
    }
  }
}

// 🔁 Run periodically
setInterval(checkTransactions, CHECK_INTERVAL);

// 🛠 Telegram Commands
bot.command('start', ctx => {
  isBotActive = true;
  ctx.reply('✅ Bot monitoring resumed.');
});

bot.command('stop', ctx => {
  isBotActive = false;
  ctx.reply('⏸️ Bot monitoring paused.');
});

// 🔗 Express Health Route
app.get('/', (_req, res) => {
  res.send('🤖 Ethereum Wallet Monitor Bot is alive!');
});

app.listen(PORT, () => {
  console.log(`🌐 Server running on port ${PORT}`);
});

// ✅ Start bot with polling
bot.launch({ dropPendingUpdates: true })
  .then(() => console.log('🤖 Bot started via polling. Monitoring transactions...'))
  .catch(err => console.error('🚨 Failed to launch bot:', err.message));
