// 🔌 Load environment variables
require('dotenv').config();

const axios = require('axios');
const { Telegraf } = require('telegraf');
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

const bot = new Telegraf(process.env.BOT_TOKEN);
const API_KEY = process.env.ETHERSCAN_API;
const CHECK_INTERVAL = 60 * 1000; // 1 min
const TIME_WINDOW = 60 * 60; // 1 hour in seconds

const wallets = [
  { name: 'Check Tether', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7' },
  { name: 'Own ERC', address: '0xbDCcF65a7b2a4b19601d097457c329064C1f5704' },
  { name: 'Ivan Colombia', address: '0x857c67C421d3E94daC5aBB0EaA4d34b26722B4fB' },
  { name: 'Chain-Link', address: '0x514910771AF9Ca656af840dff83E8264EcF986CA' },
  { name: 'ChainLink-2', address: '0x20145C5e27408B5C1CF2239d0115EE3BBc27CbD7' },
];

const trackedTokens = [
  { symbol: 'USDT', decimals: 6, contract: '0xdAC17F958D2ee523a2206206994597C13D831ec7' },
  { symbol: 'BNB', decimals: 18, contract: '0xB8c77482e45F1F44dE1745F52C74426C631bDD52' },
  { symbol: 'USDC', decimals: 6, contract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' },
  { symbol: 'LINK', decimals: 18, contract: '0x514910771AF9Ca656af840dff83E8264EcF986CA' },
];

let isBotActive = true;
let lastBlocks = {};

function formatAmount(value, decimals = 18) {
  return (Number(value) / 10 ** decimals).toFixed(6);
}

function shortAddress(addr) {
  if (!addr || typeof addr !== 'string') return 'N/A';
  return addr.substring(0, 6) + '...' + addr.slice(-4);
}

function updateLastBlock(address, block) {
  if (!lastBlocks[address] || block > lastBlocks[address]) {
    lastBlocks[address] = block;
  }
}

async function getEthBalance(address) {
  const url = `https://api.etherscan.io/api?module=account&action=balance&address=${address}&tag=latest&apikey=${API_KEY}`;
  const res = await axios.get(url);
  return formatAmount(res.data.result, 18);
}

async function getTokenBalance(address, token) {
  const url = `https://api.etherscan.io/api?module=account&action=tokenbalance&contractaddress=${token.contract}&address=${address}&tag=latest&apikey=${API_KEY}`;
  const res = await axios.get(url);
  return formatAmount(res.data.result, token.decimals);
}

async function getAllBalances(address) {
  const eth = await getEthBalance(address);
  let balances = `📊 *Total Balances:*
• ETH: ${eth}`;
  for (const token of trackedTokens) {
    const bal = await getTokenBalance(address, token);
    balances += `\n• ${token.symbol}: ${bal}`;
  }
  return balances;
}

async function checkTransactions() {
  if (!isBotActive) return;

  const now = Math.floor(Date.now() / 1000);
  const timeWindow = now - TIME_WINDOW;

  for (const wallet of wallets) {
    const address = wallet.address.toLowerCase();
    const name = wallet.name;
    let fromBlock = lastBlocks[address] || 0;

    try {
      const ethUrl = `https://api.etherscan.io/api?module=account&action=txlist&address=${address}&startblock=${fromBlock + 1}&endblock=99999999&sort=asc&apikey=${API_KEY}`;
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

        const balances = await getAllBalances(address);

        const message = `
${alertType}

👤 Wallet: *${name}*
💰 Amount: *${value} ETH*
📤 From: ${shortAddress(tx.from)}
📥 To: ${shortAddress(tx.to)}
🧾 [View TX](https://etherscan.io/tx/${tx.hash})
🕐 ${new Date(txTime * 1000).toLocaleString()}

${balances}
        `;

        await bot.telegram.sendMessage(process.env.CHAT_ID, message, { parse_mode: 'Markdown' });
        updateLastBlock(address, block);
      }
    } catch (error) {
      console.error(`❌ ETH Error for ${name}:`, error.message);
    }

    try {
      const tokenUrl = `https://api.etherscan.io/api?module=account&action=tokentx&address=${address}&startblock=${fromBlock + 1}&endblock=99999999&sort=asc&apikey=${API_KEY}`;
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
        if (!isDeposit && !isWithdrawal) continue;

        const symbol = tx.tokenSymbol || 'Unknown';
        const decimals = tx.tokenDecimal ? parseInt(tx.tokenDecimal) : 18;
        const value = formatAmount(tx.value, decimals);

        const alertType = isWithdrawal ? `🔴 Withdraw ${symbol}` : `🟢 Deposit ${symbol}`;

        const balances = await getAllBalances(address);

        const message = `
${alertType}

👤 Wallet: *${name}*
💰 Amount: *${value} ${symbol}*
📤 From: ${shortAddress(tx.from)}
📥 To: ${shortAddress(tx.to)}
🧾 [View TX](https://etherscan.io/tx/${tx.hash})
🕐 ${new Date(txTime * 1000).toLocaleString()}

${balances}
        `;

        await bot.telegram.sendMessage(process.env.CHAT_ID, message, { parse_mode: 'Markdown' });
        updateLastBlock(address, block);
      }
    } catch (error) {
      console.error(`❌ Token Error for ${name}:`, error.message);
    }
  }
}

bot.command('start', ctx => {
  isBotActive = true;
  ctx.reply('✅ Bot monitoring resumed.');
});

bot.command('stop', ctx => {
  isBotActive = false;
  ctx.reply('⏸️ Bot monitoring paused.');
});

app.get('/', (_req, res) => {
  res.send('🤖 Ethereum & ERC-20 Monitor Bot is Alive!');
});

app.listen(PORT, () => {
  console.log(`🌐 Server running on port ${PORT}`);
});

bot.launch();
console.log('🤖 Bot started...');

setInterval(checkTransactions, CHECK_INTERVAL);
