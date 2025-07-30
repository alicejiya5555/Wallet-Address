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

const wallets = [
  { name: 'Ivan Colombia', address: '0x857c67C421d3E94daC5aBB0EaA4d34b26722B4fB' }
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

async function getERC20TokenBalance(address, contract, decimals) {
  const url = `https://api.etherscan.io/api?module=account&action=tokenbalance&contractaddress=${contract}&address=${address}&tag=latest&apikey=${API_KEY}`;
  try {
    const res = await axios.get(url);
    return formatAmount(res.data.result, decimals);
  } catch (e) {
    return '0.000000';
  }
}

async function getETHBalance(address) {
  const url = `https://api.etherscan.io/api?module=account&action=balance&address=${address}&tag=latest&apikey=${API_KEY}`;
  try {
    const res = await axios.get(url);
    return formatAmount(res.data.result, 18);
  } catch (e) {
    return '0.000000';
  }
}

const tokenContracts = [
  { symbol: 'USDT', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
  { symbol: 'USDC', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
  { symbol: 'LINK', address: '0x514910771AF9Ca656af840dff83E8264EcF986CA', decimals: 18 },
  { symbol: 'BNB', address: '0xB8c77482e45F1F44dE1745F52C74426C631bDD52', decimals: 18 }
];

// 🧾 Transaction Checker
async function checkTransactions() {
  if (!isBotActive) return;

  for (const wallet of wallets) {
    const address = wallet.address.toLowerCase();
    const name = wallet.name;
    let fromBlock = lastBlocks[address] || 0;

    try {
      // ETH Transactions
      const ethUrl = `https://api.etherscan.io/api?module=account&action=txlist&address=${address}&startblock=${fromBlock + 1}&endblock=99999999&sort=asc&apikey=${API_KEY}`;
      const ethRes = await axios.get(ethUrl);
      const ethTxs = ethRes.data.result || [];

      for (const tx of ethTxs) {
        const block = parseInt(tx.blockNumber);

        if (block <= fromBlock) continue;

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
🕐 ${new Date(tx.timeStamp * 1000).toLocaleString()}
        `;

        await bot.telegram.sendMessage(process.env.CHAT_ID, message, { parse_mode: 'Markdown' });
        updateLastBlock(address, block);
      }
    } catch (err) {
      console.error(`❌ ETH Error [${name}]:`, err.message);
    }

    try {
      // ERC-20 Token Transactions
      const tokenUrl = `https://api.etherscan.io/api?module=account&action=tokentx&address=${address}&startblock=${fromBlock + 1}&endblock=99999999&sort=asc&apikey=${API_KEY}`;
      const tokenRes = await axios.get(tokenUrl);
      const tokenTxs = tokenRes.data.result || [];

      for (const tx of tokenTxs) {
        const block = parseInt(tx.blockNumber);

        if (block <= fromBlock) continue;

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
🕐 ${new Date(tx.timeStamp * 1000).toLocaleString()}
        `;

        await bot.telegram.sendMessage(process.env.CHAT_ID, message, { parse_mode: 'Markdown' });
        updateLastBlock(address, block);
      }
    } catch (err) {
      console.error(`❌ Token Error [${name}]:`, err.message);
    }

    // 📊 Show Total Balances
    try {
      const ethBalance = await getETHBalance(address);
      let balances = `📊 *${name}'s Total Wallet Balances:* 

- 🌐 ETH: *${ethBalance} ETH*`;

      for (const token of tokenContracts) {
        const bal = await getERC20TokenBalance(address, token.address, token.decimals);
        balances += `\n- 💠 ${token.symbol}: *${bal}*`;
      }

      await bot.telegram.sendMessage(process.env.CHAT_ID, balances, { parse_mode: 'Markdown' });
    } catch (e) {
      console.error(`❌ Balance Fetch Error [${name}]:`, e.message);
    }
  }
}

// 🔁 Run periodically
setInterval(checkTransactions, CHECK_INTERVAL);

// Commands
bot.command('start', ctx => {
  isBotActive = true;
  ctx.reply('✅ Bot monitoring resumed.');
});

bot.command('stop', ctx => {
  isBotActive = false;
  ctx.reply('⏸️ Bot monitoring paused.');
});

// Health Check
app.get('/', (_req, res) => {
  res.send('🤖 Wallet Monitor is Alive');
});

app.listen(PORT, () => {
  console.log(`🌐 Server listening on port ${PORT}`);
});

// Start bot
bot.launch({ dropPendingUpdates: true })
  .then(() => console.log('🤖 Bot started via polling.'))
  .catch(err => console.error('🚨 Launch error:', err.message));
