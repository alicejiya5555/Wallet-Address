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

const wallets = [
  { name: 'Felix Colombia', address: '0x705A46DdB89F0B6F0c6348b4aF40192778bC0C87' },
  { name: 'Daniel', address: '0x5218177BC361DEA6fE7654C8Ac25D4f7424Aa993' },
  { name: 'Ivan', address: '0x857c67C421d3E94daC5aBB0EaA4d34b26722B4fB' },
  { name: 'Chainlink', address: '0x514910771AF9Ca656af840dff83E8264EcF986CA' }
];

let isBotActive = true;
let lastBlocks = {}; // track highest block per wallet

// Format token amount
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

// Cache token prices during one check cycle to avoid many API calls
let priceCache = {};

async function getTokenPrice(symbol) {
  if (priceCache[symbol]) return priceCache[symbol];
  
  try {
    // Map common token symbols to CoinGecko IDs
    const coinIds = {
      'USDT': 'tether',
      'USDC': 'usd-coin',
      'LINK': 'chainlink',
      'BNB': 'binancecoin',
      'ETH': 'ethereum'
      // Add more if needed
    };

    const coinId = coinIds[symbol.toUpperCase()];
    if (!coinId) return 0;

    const res = await axios.get(`https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`);
    const price = res.data[coinId]?.usd || 0;
    priceCache[symbol] = price;
    return price;
  } catch {
    return 0;
  }
}

// Get ETH balance for a wallet
async function getETHBalance(address) {
  const url = `https://api.etherscan.io/api?module=account&action=balance&address=${address}&tag=latest&apikey=${API_KEY}`;
  try {
    const res = await axios.get(url);
    return formatAmount(res.data.result, 18);
  } catch {
    return '0.000000';
  }
}

// Get ERC-20 token balance for a wallet
async function getERC20TokenBalance(address, contract, decimals) {
  const url = `https://api.etherscan.io/api?module=account&action=tokenbalance&contractaddress=${contract}&address=${address}&tag=latest&apikey=${API_KEY}`;
  try {
    const res = await axios.get(url);
    return formatAmount(res.data.result, decimals);
  } catch {
    return '0.000000';
  }
}

// List of popular token contracts you want balances for at the end
const tokenContracts = [
  { symbol: 'USDT', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
  { symbol: 'USDC', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
  { symbol: 'LINK', address: '0x514910771AF9Ca656af840dff83E8264EcF986CA', decimals: 18 },
  { symbol: 'BNB', address: '0xB8c77482e45F1F44dE1745F52C74426C631bDD52', decimals: 18 }
];

// Main function to check new transactions
async function checkTransactions() {
  if (!isBotActive) return;

  priceCache = {}; // Reset price cache on each check

  for (const wallet of wallets) {
    const address = wallet.address.toLowerCase();
    const name = wallet.name;
    let fromBlock = lastBlocks[address] || 0;

    try {
      // Fetch ETH txs from last checked block
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
        const price = await getTokenPrice('ETH');
        const usdValue = (value * price).toFixed(2);

        const message = `
${alertType}

👤 Wallet: *${name}*
💰 Amount: *${value} ETH* (~$${usdValue} USD)
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
      // Fetch ERC20 token txs
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

        const price = await getTokenPrice(symbol);
        const usdValue = (value * price).toFixed(2);

        const message = `
${alertType}

👤 Wallet: *${name}*
💰 Amount: *${value} ${symbol}* (~$${usdValue} USD)
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

    // At the end, show wallet balances
    try {
      const ethBalance = await getETHBalance(address);
      let balances = `📊 *${name}'s Total Wallet Balances:*\n\n- 🌐 ETH: *${ethBalance} ETH*`;

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

// Run every minute
setInterval(checkTransactions, CHECK_INTERVAL);

// Telegram commands to start/stop monitoring
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
  res.send('🤖 Wallet Monitor is Alive');
});

app.listen(PORT, () => {
  console.log(`🌐 Server listening on port ${PORT}`);
});

// Start bot
bot.launch({ dropPendingUpdates: true })
  .then(() => console.log('🤖 Bot started via polling.'))
  .catch(err => console.error('🚨 Launch error:', err.message));
