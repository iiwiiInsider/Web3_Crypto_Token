const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

const TOKENS = [
  { name: "USD Coin", symbol: "USDC", decimals: 6, zarPerToken: "18" },
  { name: "Tether", symbol: "USDT", decimals: 6, zarPerToken: "18" },
  { name: "Dai", symbol: "DAI", decimals: 18, zarPerToken: "18" },
  { name: "Wrapped Ether", symbol: "WETH", decimals: 18, zarPerToken: "35000" },
  { name: "Wrapped Bitcoin", symbol: "WBTC", decimals: 8, zarPerToken: "700000" }
];

function toWei(amount) {
  return hre.ethers.parseUnits(amount, 18);
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  const MockERC20 = await hre.ethers.getContractFactory("MockERC20");
  const AirZAR = await hre.ethers.getContractFactory("AirZAR");
  const AirZARExchange = await hre.ethers.getContractFactory("AirZARExchange");

  const airzar = await AirZAR.deploy(deployer.address);
  await airzar.waitForDeployment();

  const exchange = await AirZARExchange.deploy(await airzar.getAddress(), deployer.address);
  await exchange.waitForDeployment();

  await airzar.transferOwnership(await exchange.getAddress());

  const deployedTokens = [];

  for (const token of TOKENS) {
    const mock = await MockERC20.deploy(token.name, token.symbol, token.decimals);
    await mock.waitForDeployment();

    await exchange.setTokenConfig(await mock.getAddress(), true, toWei(token.zarPerToken));

    const mintAmount = hre.ethers.parseUnits("1000000", token.decimals);
    await mock.mint(deployer.address, mintAmount);

    const fundAmount = hre.ethers.parseUnits("500000", token.decimals);
    await mock.approve(await exchange.getAddress(), fundAmount);
    await exchange.fundLiquidity(await mock.getAddress(), fundAmount);

    deployedTokens.push({
      name: token.name,
      symbol: token.symbol,
      decimals: token.decimals,
      address: await mock.getAddress(),
      zarPerToken: toWei(token.zarPerToken).toString()
    });
  }

  const deployment = {
    network: hre.network.name,
    airzar: await airzar.getAddress(),
    exchange: await exchange.getAddress(),
    treasury: deployer.address,
    tokens: deployedTokens
  };

  const outPath = path.join(__dirname, "..", "..", "frontend", "src", "config", "deployments.json");
  fs.writeFileSync(outPath, JSON.stringify(deployment, null, 2));

  console.log("Deployed:", deployment);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
