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

### 📂 Drag-and-Drop CSV Importer & Game Editor Hand Logs
* Clean drag-and-drop zone to drop PokerNow CSV logs directly, or upload hand history logs (.csv, .txt) directly inside the Game Editor.
* Instantly parses logs, validates structure, and automatically populates session data and player statistics (VPIP, PFR, 3Bet).
* Fallback file explorer browsing for ease of use.

### 🃏 Interactive Hand Replayer
* Fully visual hand replayer mimicking a real physical table with an elegant virtual green felt.
* Displays player pocket cards (Hero/Villain), community cards (Flop/Turn/River), and real-time pot size calculations.
* **Playback Controls**: Step through manually (Next/Prev), restart, or use the automated autoplay feature to watch the action unfold.
* Complete live action log and hand commentary panels for key stage breakdowns.

### 🔐 Supabase User Authentication
* Secure sign-in and account creation via Email/Password, Magic Link tokens, or OAuth providers (Google, Discord).
* User profiles with customizable avatars and display names.

### 🔗 External Player ID Linking & Ledger Backfilling
* Claim and link external player handles across platforms (PokerNow, ClubGG, PokerStars).
* Automatic backfilling of historical ledger stats to your authenticated profile upon claiming an ID.

### 🛡️ Row-Level Security (RLS) & Session Privacy
* Database-level security ensuring sessions and hands are private to participants, group members, or owners.

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

2. Configure Supabase Environment Variables:
   Create a `.env` file in the root directory with your Supabase project credentials:
   ```env
   VITE_SUPABASE_URL=your_supabase_project_url
   VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
   ```
   *(Note: The app features robust local-first session persistence using `localStorage` with automatic background sync when Supabase variables are configured, and runs fully offline when omitted.)*

3. Database Setup:
   Run the SQL migration script located in `supabase_schema.sql` on your Supabase project database to set up profiles, external player IDs, aliases, and Row-Level Security (RLS) policies.

4. Run the development server:
   ```bash
   npm run dev
   ```
   The application will be accessible at `http://localhost:5173`.

### Code Quality

Run the ESLint linter to check for syntax and style issues:
```bash
npm run lint
```
