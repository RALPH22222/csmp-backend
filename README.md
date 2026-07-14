<div align="center">
  <h1>BayanIpon - Backend API & Services</h1>
  <p><strong>The Bridge Between Web2 and Web3</strong></p>
</div>

---

## 📖 Overview

This repository contains the Node.js/Express backend that powers the **BayanIpon** ecosystem. It serves as the vital bridging layer that connects our mobile and web frontends to the Stellar blockchain, ensuring a seamless, gasless experience for our unbanked users.

## ✨ Core Features

- **Fee-Bump Transaction Sponsoring:** 
  To provide a true Web2-like experience, users (wet market vendors) should not need to hold or understand XLM for gas fees. This backend wraps signed user transactions into *Fee-Bump Transactions*, paying the network fee via a centralized sponsor account.
- **Off-Chain Indexing & State Management:** 
  Listens to on-chain Soroban events and indexes data into **Supabase (PostgreSQL)**. This allows for lightning-fast frontend queries regarding user profiles, active pools, and historical transactions without throttling the Stellar RPC nodes.
- **SEP-24 Anchor Orchestration:** 
  Integrates with local Stellar Anchors (fiat gateways) to handle Cash-In and Cash-Out flows, allowing users to move funds between fiat (e.g., GCash, Maya) and stablecoins (USDC) securely.
- **Cron Jobs & Notifications:** 
  Runs automated daily jobs to evaluate pool cycles, trigger automatic payouts on the smart contract, and send SMS/Push notifications reminding users of their daily contributions.

## 🛠️ Tech Stack

- **Runtime:** Node.js
- **Framework:** Express.js, TypeScript
- **Database:** Supabase (PostgreSQL)
- **Blockchain SDK:** `@stellar/stellar-sdk`

## 🚀 Getting Started

### Prerequisites
- Node.js (v18+)
- npm or yarn
- Supabase Project URL & API Keys

### Installation

1. Clone the repository and install dependencies:
   ```bash
   npm install
   ```

2. Configure your Environment Variables by creating a `.env` file:
   ```env
   PORT=3000
   SUPABASE_URL=your_supabase_url
   SUPABASE_ANON_KEY=your_supabase_anon_key
   STELLAR_NETWORK=TESTNET
   STELLAR_RPC_URL=https://soroban-testnet.stellar.org
   SPONSOR_SECRET_KEY=your_sponsor_wallet_secret
   ```

### Running the Server

Start the development server:
```bash
npm run dev
```

Build for production:
```bash
npm run build
npm start
```

---
*Built for the Stellar Blockchain Hackathon - Local Finance & Real World Access Track.*
