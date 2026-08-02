# Premium Poker Session Tracker

A premium, interactive poker session tracker featuring a sleek, dark card-based theme to easily analyze games, track player stats, import logs, and replay key hands on a virtual felt.

## Features

### 🌟 Premium Dark Theme & Responsive Layout
* Designed with a high-end, dark card-based aesthetic using Tailwind CSS.
* Fluid animations, glowing border interactions, and polished typography.
* Built to be fully responsive, scaling seamlessly from mobile screens to desktop monitors.

### 🏆 Hall of Fame Podiums
* **Top Shark**: Prominent dashboard card highlighting the player with the highest all-time net profit.
* **Biggest Donor**: High-impact card acknowledging the player with the largest all-time contribution, keeping the games alive.
* Interactive cards that allow clicking through to view detailed individual player profiles.

### 📂 Drag-and-Drop CSV Importer
* Clean drag-and-drop zone to drop PokerNow CSV logs directly.
* Instantly parses logs, validates structure, and automatically populates session data.
* Fallback file explorer browsing for ease of use.

### 🃏 Interactive Hand Replayer
* Fully visual hand replayer mimicking a real physical table with an elegant virtual green felt.
* Displays player pocket cards (Hero/Villain), community cards (Flop/Turn/River), and real-time pot size calculations.
* **Playback Controls**: Step through manually (Next/Prev), restart, or use the automated autoplay feature to watch the action unfold.
* Complete live action log and hand commentary panels for key stage breakdowns.

---

## Getting Started

### Prerequisites
* [Node.js](https://nodejs.org/) (v18 or higher recommended)
* npm or yarn

### Installation

1. Install dependencies:
   ```bash
   npm install
   ```

2. Run the development server:
   ```bash
   npm run dev
   ```
   The application will be accessible at `http://localhost:5173`.

### Code Quality

Run the ESLint linter to check for syntax and style issues:
```bash
npm run lint
```
