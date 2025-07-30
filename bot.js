// 🔌 Load environment variables
require('dotenv').config();

const axios = require('axios');
const { Telegraf } = require('telegraf');
const express = require('express');
const app = express();

const PORT = process.env.PORT || 3000;

const bot = new Telegraf(process.env.BOT_TOKEN);
const API_KEY = process.env.ETHERSCAN_API;
const CHECK_INTERVAL = 60 * 1000; // 1 minute polling
const TIME_WINDOW = 60 * 60; // 1 hour in seconds

const wallets = [
  { name: 'Check Tether', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7' },
  { name: 'Own ERC', address: '0xbDCcF65a7b2a4b19601d097457c329064C1f5704' },
  { name: 'Ivan Colombia', address: '0x857c67C421d3E94daC5aBB0EaA4d34b26722B4fB' },
  { name: 'Chain-Link', address: '0x514910771AF9Ca656af840dff83E8264EcF986CA' },
  { name: 'ChainLink-2', address: '0x20145C5e27408B5C1CF2239d0115EE3BBc27CbD7' },
];

let isBotActive = true;
let lastBlocks = {};

// Format amount with decimals
function formatAmount(value, decimals = 18) {
  return (Number(value) / 10 ** decimals).toFixed(6);
}

// Shorten wallet address
function shortAddress(addr) {
  if (!addr || typeof addr !== 'string') return 'N/A';
  return addr.substring(0, 6) + '...' + addr.slice(-4);
}

// Helper to update lastBlocks with highest block seen
function updateLastBlock(address, block) {
  if (!lastBlocks[address] || block > lastBlocks[address]) {
    lastBlocks[address] = block;
  }
}

// Main transaction checker
async function checkTransactions() {
  if (!isBotActive) return;

  const now = Math.floor(Date.now() / 1000);
  const timeWindow = now - TIME_WINDOW;

  for (const wallet of wallets) {
    const address = wallet.address.toLowerCase();
    const name = wallet.name;
    let fromBlock = lastBlocks[address] || 0;

    console.log(`\n🔎 Checking transactions for "${name}" from block ${fromBlock}`);

    try {
      // Fetch latest ETH transactions
      const ethUrl = `https://api.etherscan.io/api?module=account&action=txlist&address=${address}&startblock=${fromBlock + 1}&endblock=99999999&sort=asc&apikey=${API_KEY}`;
      const ethRes = await axios.get(ethUrl);
      const ethTxs = ethRes.data.result || [];

      console.log(`🔸 Found ${ethTxs.length} ETH tx(s) for ${name}`);

      for (const tx of ethTxs) {
        const block = parseInt(tx.blockNumber);
        const txTime = parseInt(tx.timeStamp);

        if (block <= fromBlock) {
          // Old block, skip
          continue;
        }

        if (txTime < timeWindow) {
          // Older than 1 hour, skip
          continue;
        }

        const to = tx.to?.toLowerCase();
        const from = tx.from?.toLowerCase();
        if (!to || !from) {
          console.log(`⚠️ Skipping ETH tx ${tx.hash} due to missing to/from`);
          continue;
        }

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
        updateLastBlock(address, block);
      }
    } catch (error) {
      console.error(`❌ ETH Error for ${name}:`, error.message);
    }

    try {
      // Fetch ERC-20 token transactions
      const tokenUrl = `https://api.etherscan.io/api?module=account&action=tokentx&address=${address}&startblock=${fromBlock + 1}&endblock=99999999&sort=asc&apikey=${API_KEY}`;
      const tokenRes = await axios.get(tokenUrl);
      const tokenTxs = tokenRes.data.result || [];

      console.log(`🔹 Found ${tokenTxs.length} ERC-20 tx(s) for ${name}`);

      for (const tx of tokenTxs) {
        const block = parseInt(tx.blockNumber);
        const txTime = parseInt(tx.timeStamp);

        if (block <= fromBlock) {
          continue;
        }

        if (txTime < timeWindow) {
          continue;
        }

        const to = tx.to?.toLowerCase();
        const from = tx.from?.toLowerCase();
        if (!to || !from) {
          console.log(`⚠️ Skipping token tx ${tx.hash} due to missing to/from`);
          continue;
        }

        const isDeposit = to === address;
        const isWithdrawal = from === address;

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
    } catch (error) {
      console.error(`❌ Token Error for ${name}:`, error.message);
    }
  }
}

// Telegram commands
bot.command('start', ctx => {
  isBotActive = true;
  ctx.reply('✅ Bot monitoring resumed.');
});

bot.command('stop', ctx => {
  isBotActive = false;
  ctx.reply('⏸️ Bot monitoring paused.');
});

// Express health check
app.get('/', (_req, res) => {
  res.send('🤖 Ethereum & ERC-20 Monitor Bot is Alive!');
});

// Start server
app.listen(PORT, () => {
  console.log(`🌐 Server running on port ${PORT}`);
});

// Launch bot with polling
bot.launch();
console.log('🤖 Bot started with polling... watching transactions...');

// Check transactions every minute
setInterval(checkTransactions, CHECK_INTERVAL);
