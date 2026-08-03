const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const dotenv = require("dotenv");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { ethers } = require("ethers");
const { z } = require("zod");

dotenv.config();

const app = express();

// Security middleware
app.use(helmet());
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "http://localhost:3000").split(",").map(o => o.trim());
app.use(cors({
  origin: ALLOWED_ORIGINS,
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));
app.use(express.json({ limit: '1mb' }));

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests',
  standardHeaders: true,
  legacyHeaders: false
});

app.use("/api/", apiLimiter);

const PORT = Number(process.env.PORT || 5174);
const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || "";
const UNLIMINT_BASE_URL = process.env.UNLIMINT_BASE_URL || "https://sandbox.unlimint.com";
const UNLIMINT_MERCHANT_ID = process.env.UNLIMINT_MERCHANT_ID || "";
const UNLIMINT_API_KEY = process.env.UNLIMINT_API_KEY || "";

// Input validation schemas
const bridgeSchema = z.object({
  tokenAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  amount: z.string().regex(/^\d+(\.\d+)?$/)
});

const rampSchema = z.object({
  amount: z.string().regex(/^\d+(\.\d+)?$/).optional(),
  currency: z.string().max(10).optional(),
  asset: z.string().max(50).optional()
});

const PORT = Number(process.env.PORT || 5174);
const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || "";
const UNLIMINT_BASE_URL = process.env.UNLIMINT_BASE_URL || "https://sandbox.unlimint.com";
const UNLIMINT_MERCHANT_ID = process.env.UNLIMINT_MERCHANT_ID || "";
const UNLIMINT_API_KEY = process.env.UNLIMINT_API_KEY || "";

const erc20Abi = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address account) view returns (uint256)"
];

const exchangeAbi = [
  "function buy(address token, uint256 tokenAmount) external",
  "function sell(address token, uint256 airzarAmount) external"
];

const zeroAddress = "0x0000000000000000000000000000000000000000";

const provider = new ethers.JsonRpcProvider(RPC_URL);
const signer = DEPLOYER_PRIVATE_KEY ? new ethers.Wallet(DEPLOYER_PRIVATE_KEY, provider) : null;

function loadDeployment() {
  try {
    const deploymentPath = path.join(__dirname, "..", "frontend", "src", "config", "deployments.json");
    const raw = fs.readFileSync(deploymentPath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    return {
      network: "unknown",
      airzar: zeroAddress,
      exchange: zeroAddress,
      treasury: zeroAddress,
      tokens: []
    };
  }
}

function getAddresses() {
  const deployment = loadDeployment();
  return {
    airzar: process.env.AIRZAR_ADDRESS || deployment.airzar || zeroAddress,
    exchange: process.env.EXCHANGE_ADDRESS || deployment.exchange || zeroAddress
  };
}

function ensureConfigured() {
  if (!signer) {
    return "DEPLOYER_PRIVATE_KEY is not set.";
  }
  const { airzar, exchange } = getAddresses();
  if (!airzar || airzar === zeroAddress || !exchange || exchange === zeroAddress) {
    return "Contract addresses are not configured yet.";
  }
  return "";
}

async function getTokenDecimals(tokenAddress) {
  const token = new ethers.Contract(tokenAddress, erc20Abi, provider);
  return token.decimals();
}

app.get("/api/health", async (_req, res) => {
  try {
    const network = await provider.getNetwork();
    res.json({
      ok: true,
      chainId: Number(network.chainId),
      signerReady: Boolean(signer),
      hasUnlimintConfig: Boolean(UNLIMINT_MERCHANT_ID && UNLIMINT_API_KEY)
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/ramp/session", (req, res) => {
  try {
    const validated = rampSchema.parse(req.body || {});
    const { amount, currency, asset } = validated;
    const randomSuffix = crypto.randomBytes(16).toString("hex");
    const sessionId = `ulmt_${Date.now()}_${randomSuffix}`;

    res.json({
      sessionId,
      amount: amount || "0",
      currency: currency || "ZAR",
      asset: asset || "USDC",
      checkoutUrl: `${UNLIMINT_BASE_URL}/checkout/${sessionId}`,
      status: "stub",
      requiresConfig: !UNLIMINT_MERCHANT_ID || !UNLIMINT_API_KEY
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    res.status(500).json({ error: 'Failed to create session' });
  }
});

app.post("/api/bridge/buy", async (req, res) => {
  try {
    const configError = ensureConfigured();
    if (configError) {
      return res.status(400).json({ error: configError });
    }

    const validated = bridgeSchema.parse(req.body || {});
    const { tokenAddress, amount } = validated;

    const { exchange } = getAddresses();
    const decimals = await getTokenDecimals(tokenAddress);
    const parsedAmount = ethers.parseUnits(String(amount), decimals);

    const token = new ethers.Contract(tokenAddress, erc20Abi, signer);
    const exchangeContract = new ethers.Contract(exchange, exchangeAbi, signer);

    const approveTx = await token.approve(exchange, parsedAmount);
    await approveTx.wait();

    const buyTx = await exchangeContract.buy(tokenAddress, parsedAmount);
    await buyTx.wait();

    res.json({
      ok: true,
      approveTxHash: approveTx.hash,
      buyTxHash: buyTx.hash
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    res.status(500).json({ error: error.message });
  }
});

const sellSchema = z.object({
  tokenAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  airzarAmount: z.string().regex(/^\d+(\.\d+)?$/)
});

app.post("/api/bridge/sell", async (req, res) => {
  try {
    const configError = ensureConfigured();
    if (configError) {
      return res.status(400).json({ error: configError });
    }

    const validated = sellSchema.parse(req.body || {});
    const { tokenAddress, airzarAmount } = validated;

    const { airzar, exchange } = getAddresses();
    const parsedAmount = ethers.parseUnits(String(airzarAmount), 18);

    const airzarToken = new ethers.Contract(airzar, erc20Abi, signer);
    const exchangeContract = new ethers.Contract(exchange, exchangeAbi, signer);

    const approveTx = await airzarToken.approve(exchange, parsedAmount);
    await approveTx.wait();

    const sellTx = await exchangeContract.sell(tokenAddress, parsedAmount);
    await sellTx.wait();

    res.json({
      ok: true,
      approveTxHash: approveTx.hash,
      sellTxHash: sellTx.hash
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/bridge/balances", async (req, res) => {
  const configError = ensureConfigured();
  if (configError) {
    res.status(400).json({ error: configError });
    return;
  }

  const { tokenAddress } = req.query || {};
  if (!tokenAddress) {
    res.status(400).json({ error: "tokenAddress is required." });
    return;
  }

  try {
    const { airzar } = getAddresses();
    const walletAddress = await signer.getAddress();
    const token = new ethers.Contract(tokenAddress, erc20Abi, provider);
    const airzarToken = new ethers.Contract(airzar, erc20Abi, provider);
    const [tokenDecimals, tokenBal, airzarBal] = await Promise.all([
      token.decimals(),
      token.balanceOf(walletAddress),
      airzarToken.balanceOf(walletAddress)
    ]);

    res.json({
      ok: true,
      wallet: walletAddress,
      token: ethers.formatUnits(tokenBal, tokenDecimals),
      airzar: ethers.formatUnits(airzarBal, 18)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`AirZAR backend running on http://localhost:${PORT}`);
});
