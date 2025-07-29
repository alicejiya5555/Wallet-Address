require('dotenv').config();
const fs = require('fs');
const axios = require('axios');
const { Telegraf } = require('telegraf');

// Load wallet list from file
const WALLETS = JSON.parse(fs.readFileSync('./wallets.json', 'utf8'));

// Load environment variables
const bot = new Telegraf(process.env.BOT_TOKEN);
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY;
const TELEGRAM_CHAT_ID = process.env.CHAT_ID;

async function fetchTransactions(address, fromBlock, type = 'eth') {
  const module = type === 'eth' ? 'txlist' : 'tokentx';
  const url = `https://api.etherscan.io/api?module=account&action=${module}&address=${address}&startblock=${fromBlock}&endblock=99999999&sort=asc&apikey=${ETHERSCAN_API_KEY}`;
  try {
    const { data } = await axios.get(url);
    return data.status === '1' ? data.result : [];
  } catch (err) {
    console.error(`Failed fetching ${type} for ${address}`, err);
    return [];
  }
}

function getStatusIcon(isDeposit, isSwap) {
  if (isSwap) return '🟡';
  return isDeposit ? '🟢' : '🔴';
}

function formatTxMessage({ wallet, txHash, asset, amount, from, to, timestamp, isDeposit, isSwap }) {
  const icon = getStatusIcon(isDeposit, isSwap);
  return `
${icon} *${isDeposit ? 'DEPOSIT' : isSwap ? 'SWAP' : 'WITHDRAWAL'}*

*Wallet*: ${wallet}
*Token*: ${asset}
*Amount*: ${amount.toFixed(4)}
*From*: \`${from}\`
*To*: \`${to}\`
*Time*: ${new Date(parseInt(timestamp) * 1000).toLocaleString()}
[🔗 View Tx](https://etherscan.io/tx/${txHash})
`;
}

async function sendTelegramMessage(text) {
  await bot.telegram.sendMessage(TELEGRAM_CHAT_ID, text, {
    parse_mode: 'Markdown',
    disable_web_page_preview: true
  });
}

async function monitorWallet(wallet) {
  const ethTxs = await fetchTransactions(wallet.address, wallet.lastBlock, 'eth');
  const tokenTxs = await fetchTransactions(wallet.address, wallet.lastBlock, 'token');
  let highestBlock = wallet.lastBlock;

  for (const tx of [...ethTxs, ...tokenTxs]) {
    const isDeposit = tx.to.toLowerCase() === wallet.address.toLowerCase();
    const isSwap = tx.from.toLowerCase() === tx.to.toLowerCase();
    const amount = parseFloat(tx.value) / Math.pow(10, parseInt(tx.tokenDecimal || 18));
    const asset = tx.tokenSymbol || 'ETH';
    const blockNum = parseInt(tx.blockNumber);
    if (blockNum > highestBlock) highestBlock = blockNum;

    const message = formatTxMessage({
      wallet: wallet.name,
      txHash: tx.hash,
      asset,
      amount,
      from: tx.from,
      to: tx.to,
      timestamp: tx.timeStamp,
      isDeposit,
      isSwap
    });

    await sendTelegramMessage(message);
  }

  wallet.lastBlock = highestBlock;
}

async function checkAllWallets() {
  for (const wallet of WALLETS) {
    await monitorWallet(wallet);
  }
  console.log('✅ Wallet check completed.');
}

bot.start(async (ctx) => {
  await ctx.reply('🔍 Checking wallets for new transactions...');
  await checkAllWallets();
});

bot.command('help', async (ctx) => {
  await ctx.reply('🤖 Bot is active.\nUse /start to manually trigger a check.');
});

(async () => {
  console.log('🤖 Bot is running...');
  await checkAllWallets();
  bot.launch();
})();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
