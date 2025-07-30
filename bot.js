// 🔌 Load environment variables first
require('dotenv').config();

// 🌐 Setup tiny express server to keep host services alive
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (_req, res) => {
  res.send('🤖 Ethereum Wallet Monitor Bot is alive!');
});

app.listen(PORT, () => {
  console.log(`🌐 Server is running on port ${PORT}`);
});

require('dotenv').config();
const axios = require('axios');
const { Telegraf } = require('telegraf');
const fs = require('fs');

const bot = new Telegraf(process.env.BOT_TOKEN);

let isBotActive = true;

const wallets = require('./wallets.json');

const API_KEY = process.env.ETHERSCAN_API;
const CHECK_INTERVAL = 60 * 1000; // 1 min

let lastBlocks = {};

async function fetchTransactions(address, fromBlock, type = 'eth') {
  const module = type === 'eth' ? 'txlist' : 'tokentx';
  const url = `https://api.etherscan.io/api?module=account&action=${module}&address=${address}&startblock=${fromBlock}&endblock=99999999&sort=asc&apikey=${API_KEY}`;
  try {
    const res = await axios.get(url);
    return res.data.status === '1' ? res.data.result : [];
  } catch (err) {
    console.error(`Error fetching ${type} txs for ${address}:`, err.message);
    return [];
  }
}

function formatTxMessage({ wallet, txHash, asset, amount, from, to, timestamp, isDeposit, isSwap }) {
  const direction = isSwap ? '🟡 SWAP' : isDeposit ? '🟢 DEPOSIT' : '🔴 WITHDRAW';
  const short = (addr) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  const time = new Date(parseInt(timestamp) * 1000).toLocaleString();
  return `${direction} ALERT\n\n*Wallet*: ${wallet}\n*Amount*: ${amount.toFixed(4)} ${asset}\n*From*: ${short(from)}\n*To*: ${short(to)}\n*Time*: ${time}\n[View on Etherscan](https://etherscan.io/tx/${txHash})`;
}

async function checkWallets() {
  if (!isBotActive) return;

  for (const wallet of wallets) {
    const addr = wallet.address.toLowerCase();
    const name = wallet.name;
    const lastBlock = lastBlocks[addr] || 0;

    const ethTxs = await fetchTransactions(addr, lastBlock, 'eth');
    const tokenTxs = await fetchTransactions(addr, lastBlock, 'token');
    let highestBlock = lastBlock;

    for (const tx of ethTxs) {
      const blockNum = parseInt(tx.blockNumber);
      if (blockNum > highestBlock) highestBlock = blockNum;
      const isDeposit = tx.to.toLowerCase() === addr;
      const amount = parseFloat(tx.value) / 1e18;
      const message = formatTxMessage({
        wallet: name,
        txHash: tx.hash,
        asset: 'ETH',
        amount,
        from: tx.from,
        to: tx.to,
        timestamp: tx.timeStamp,
        isDeposit,
        isSwap: false
      });
      await bot.telegram.sendMessage(process.env.CHAT_ID, message, { parse_mode: 'Markdown' });
    }

    for (const tx of tokenTxs) {
      const blockNum = parseInt(tx.blockNumber);
      if (blockNum > highestBlock) highestBlock = blockNum;
      const isDeposit = tx.to.toLowerCase() === addr;
      const decimals = parseInt(tx.tokenDecimal) || 18;
      const amount = parseFloat(tx.value) / Math.pow(10, decimals);
      const asset = tx.tokenSymbol || 'UNKNOWN';
      const message = formatTxMessage({
        wallet: name,
        txHash: tx.hash,
        asset,
        amount,
        from: tx.from,
        to: tx.to,
        timestamp: tx.timeStamp,
        isDeposit,
        isSwap: tx.from.toLowerCase() === tx.to.toLowerCase()
      });
      await bot.telegram.sendMessage(process.env.CHAT_ID, message, { parse_mode: 'Markdown' });
    }

    lastBlocks[addr] = highestBlock;
  }
}

bot.command('start', (ctx) => {
  isBotActive = true;
  ctx.reply('✅ Bot has been activated and will start monitoring transactions.');
});

bot.command('stop', (ctx) => {
  isBotActive = false;
  ctx.reply('⏸️ Bot has been paused and will stop monitoring transactions.');
});

bot.command('help', (ctx) => {
  ctx.reply(`🤖 Commands:
/start - Start monitoring
/stop - Stop monitoring
/help - Show commands`);
});

setInterval(checkWallets, CHECK_INTERVAL);

bot.launch().then(() => console.log('Bot started. Monitoring wallets...'));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
