# AirZAR DeFi App

A minimal DeFi demo with:
- AirZAR ERC-20 token (pegged 1:1 to ZAR via a placeholder oracle)
- Exchange contract with 0.5% platform fee
- Frontend UI with common tokens and buy/sell actions

## Overview
- Buy: user deposits a supported token, 0.5% fee to platform treasury, remaining value mints AirZAR.
- Sell: user burns AirZAR, receives the chosen token minus 0.5% fee.
- AirZAR peg: contract uses a placeholder price feed. Replace with a real oracle before production.

## Quick Start
1. Install dependencies:
   - From project root, run: npm install
2. Configure backend env:
   - Copy backend/.env.example to backend/.env and set DEPLOYER_PRIVATE_KEY
3. Start local chain and deploy:
   - Run: npx hardhat node (in one terminal, from contracts)
   - Run: npm run deploy (from project root)
4. Run backend bridge + ramp stub:
   - Run: npm run dev:api (from project root)
5. Run frontend:
   - Run: npm run dev (from project root)

## Notes
- Token addresses are written to frontend config during deploy.
- Liquidity is mocked by minting tokens to the deployer and funding the exchange.
- Replace placeholder price logic with a proper oracle for production.
- The backend uses a server wallet to simulate web2-to-web3 actions for testing.
- Configure backend environment in backend/.env (see backend/.env.example).
