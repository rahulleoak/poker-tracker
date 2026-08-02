import { useState } from 'react';
import { Play, Pause, ChevronLeft, ChevronRight, RotateCcw, HelpCircle, Flame, Coins, Trophy } from 'lucide-react';

const SAMPLE_HANDS = [
  {
    id: 1,
    title: "Pocket Aces vs Pocket Kings",
    description: "A legendary clash between the two top starting hands in Hold'em with an action-packed runout.",
    stakes: "$1/$2 No Limit Hold'em",
    heroCards: ["A♥", "A♦"],
    villainCards: ["K♠", "K♣"],
    steps: [
      {
        stage: "Pre-Flop",
        pot: "$3",
        description: "Hero (Small Blind) is dealt A♥ A♦. Villain (Big Blind) is dealt K♠ K♣. Button folds. Action is on Hero.",
        board: [],
        heroAction: "Raise to $6",
        villainAction: "3-Bet to $18",
        extraAction: "Hero calls $18.",
        activePlayer: "Hero"
      },
      {
        stage: "Flop",
        pot: "$36",
        description: "The dealer spreads the flop: A♠ K♥ 2♦. Hero flops top set (Aces), Villain flops middle set (Kings). Absolute monster scenario!",
        board: ["A♠", "K♥", "2♦"],
        heroAction: "Check",
        villainAction: "Bet $20",
        extraAction: "Hero calls $20.",
        activePlayer: "Villain"
      },
      {
        stage: "Turn",
        pot: "$76",
        description: "The turn is the J♣. No straight draws completed. Both players keep their monster hands.",
        board: ["A♠", "K♥", "2♦", "J♣"],
        heroAction: "Check",
        villainAction: "Bet $45",
        extraAction: "Hero raises to $110. Villain calls.",
        activePlayer: "Hero"
      },
      {
        stage: "River",
        pot: "$296",
        description: "The river is the J♦, pairing the board! Hero improves to Aces Full of Jacks, Villain improves to Kings Full of Jacks.",
        board: ["A♠", "K♥", "2♦", "J♣", "J♦"],
        heroAction: "Shoves All-In ($250)",
        villainAction: "Calls All-In ($250)",
        extraAction: "Showdown! Hero wins with Aces Full of Jacks.",
        activePlayer: "Showdown"
      }
    ]
  },
  {
    id: 2,
    title: "The Ultimate Stone Bluff",
    description: "Hero misses a massive straight flush draw on the river and fires a triple-barrel bluff to steal the pot.",
    stakes: "$2/$5 No Limit Hold'em",
    heroCards: ["J♠", "10♠"],
    villainCards: ["A♣", "Q♥"],
    steps: [
      {
        stage: "Pre-Flop",
        pot: "$7",
        description: "Hero is dealt J♠ 10♠ on the Button. Action folds to Hero who raises to $15. Villain calls from the Big Blind.",
        board: [],
        heroAction: "Raise to $15",
        villainAction: "Calls $15",
        extraAction: "",
        activePlayer: "Hero"
      },
      {
        stage: "Flop",
        pot: "$32",
        description: "The flop is Q♠ 9♠ 2♦. Villain flops top pair. Hero flops a monster open-ended straight flush draw! Hero continuous bets.",
        board: ["Q♠", "9♠", "2♦"],
        heroAction: "Bet $20",
        villainAction: "Calls $20",
        extraAction: "",
        activePlayer: "Hero"
      },
      {
        stage: "Turn",
        pot: "$72",
        description: "The turn is the 5♥. Brick card. Villain checks. Hero double-barrels for raw equity pressure.",
        board: ["Q♠", "9♠", "2♦", "5♥"],
        heroAction: "Bet $50",
        villainAction: "Calls $50",
        extraAction: "",
        activePlayer: "Hero"
      },
      {
        stage: "River",
        pot: "$172",
        description: "The river is the 2♣. Hero completely misses all draws. Villain checks. Hero fires a massive polar bluff of $145!",
        board: ["Q♠", "9♠", "2♦", "5♥", "2♣"],
        heroAction: "Bet $145",
        villainAction: "Folds!",
        extraAction: "Hero successfully bluffs Villain and takes down the pot with Jack-high!",
        activePlayer: "Villain"
      }
    ]
  }
];

export default function HandReplayer() {
  const [selectedHandIdx, setSelectedHandIdx] = useState(0);
  const [currentStepIdx, setCurrentStepIdx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playInterval, setPlayInterval] = useState(null);

  const activeHand = SAMPLE_HANDS[selectedHandIdx];
  const activeStep = activeHand.steps[currentStepIdx];

  const handleNext = () => {
    if (currentStepIdx < activeHand.steps.length - 1) {
      setCurrentStepIdx(currentStepIdx + 1);
    } else {
      handlePause();
    }
  };

  const handlePrev = () => {
    if (currentStepIdx > 0) {
      setCurrentStepIdx(currentStepIdx - 1);
    }
  };

  const handleReset = () => {
    setCurrentStepIdx(0);
    handlePause();
  };

  const handlePlay = () => {
    if (isPlaying) return;
    setIsPlaying(true);
    const interval = setInterval(() => {
      setCurrentStepIdx((prev) => {
        if (prev < activeHand.steps.length - 1) {
          return prev + 1;
        } else {
          clearInterval(interval);
          setIsPlaying(false);
          return prev;
        }
      });
    }, 3000);
    setPlayInterval(interval);
  };

  const handlePause = () => {
    if (playInterval) {
      clearInterval(playInterval);
      setPlayInterval(null);
    }
    setIsPlaying(false);
  };

  const renderCard = (cardStr, isDimmed = false) => {
    if (!cardStr) return null;
    const value = cardStr.slice(0, -1);
    const suit = cardStr.slice(-1);
    const isRed = suit === '♥' || suit === '♦';

    return (
      <div className={`w-12 h-16 rounded-lg bg-white text-slate-900 border-2 font-bold flex flex-col justify-between p-1.5 shadow-md transform hover:-translate-y-1 transition-all select-none ${
        isRed ? 'border-rose-400 text-rose-600' : 'border-slate-300 text-slate-800'
      } ${isDimmed ? 'opacity-30' : 'opacity-100 scale-105 shadow-xl border-emerald-500'}`}>
        <div className="text-xs leading-none">{value}</div>
        <div className="text-center text-lg leading-none mt-1">{suit}</div>
        <div className="text-right text-xs leading-none transform rotate-180">{value}</div>
      </div>
    );
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      
      {/* Header and Hand Selector */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-xl">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 text-xs font-semibold border border-emerald-500/20">
              <Flame className="w-3.5 h-3.5" /> Replayer Prototype
            </span>
            <span className="text-slate-500 text-xs">Pre-flop & Post-flop Analysis</span>
          </div>
          <h2 className="text-2xl font-bold text-slate-100">Visual Hand Replayer</h2>
          <p className="text-slate-400 text-sm">Review, step through, and analyze historical major hands on our custom virtual felt.</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {SAMPLE_HANDS.map((hand, idx) => (
            <button
              key={hand.id}
              onClick={() => {
                setSelectedHandIdx(idx);
                setCurrentStepIdx(0);
                handlePause();
              }}
              className={`px-4 py-2.5 rounded-xl text-xs font-bold border transition-all duration-300 ${
                selectedHandIdx === idx
                  ? 'bg-emerald-600/10 border-emerald-500 text-emerald-400 shadow-lg shadow-emerald-500/5'
                  : 'bg-slate-800/50 border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-slate-300'
              }`}
            >
              Hand {idx + 1}: {hand.title}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Virtual Felt Table Card */}
        <div className="lg:col-span-2 bg-slate-900/60 border border-slate-800/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col min-h-[460px]">
          
          {/* Virtual Felt Table Area */}
          <div className="p-8 flex-1 flex flex-col justify-center items-center relative bg-gradient-to-b from-slate-950 to-slate-900 border-b border-slate-800/80">
            
            {/* Table Felt Background */}
            <div className="w-full max-w-lg aspect-[2/1] rounded-[120px] bg-gradient-to-b from-emerald-800 to-emerald-950 border-[10px] border-amber-900/80 shadow-[inset_0_0_50px_rgba(0,0,0,0.8),0_15px_30px_rgba(0,0,0,0.5)] flex flex-col items-center justify-between p-6 relative">
              
              {/* Outer Golden Trim Accent */}
              <div className="absolute inset-0.5 rounded-[112px] border border-amber-500/30 pointer-events-none"></div>

              {/* Pot Display */}
              <div className="absolute top-[38%] left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-black/60 border border-amber-500/30 px-3 py-1.5 rounded-full flex items-center gap-1.5 shadow-md">
                <Coins className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-xs text-slate-400 font-medium">Pot:</span>
                <span className="text-xs text-amber-400 font-bold">{activeStep.pot}</span>
              </div>

              {/* Seated Players: Hero SB (Bottom) */}
              <div className="absolute bottom-[-16px] left-1/2 transform -translate-x-1/2 flex flex-col items-center gap-1 z-10">
                <div className={`px-3 py-1.5 rounded-xl border flex flex-col items-center shadow-lg transition-all duration-300 ${
                  activeStep.activePlayer === "Hero"
                    ? 'bg-emerald-500/15 border-emerald-400 shadow-emerald-500/20 scale-105'
                    : 'bg-slate-950/90 border-slate-800'
                }`}>
                  <span className="text-[10px] font-bold uppercase text-emerald-400 tracking-wider">Hero (SB)</span>
                  <span className="text-xs text-slate-300 font-medium">$250 Stack</span>
                </div>
                <div className="flex gap-1.5 mt-1">
                  {activeHand.heroCards.map(c => renderCard(c, activeStep.stage === "Pre-Flop" && activeStep.activePlayer !== "Hero"))}
                </div>
              </div>

              {/* Seated Players: Villain BB (Top) */}
              <div className="absolute top-[-20px] left-1/2 transform -translate-x-1/2 flex flex-col items-center gap-1 z-10">
                <div className="flex gap-1.5 mb-1">
                  {activeHand.villainCards.map(c => renderCard(c, activeStep.stage !== "River"))}
                </div>
                <div className={`px-3 py-1.5 rounded-xl border flex flex-col items-center shadow-lg transition-all duration-300 ${
                  activeStep.activePlayer === "Villain"
                    ? 'bg-rose-500/15 border-rose-400 shadow-rose-500/20 scale-105'
                    : 'bg-slate-950/90 border-slate-800'
                }`}>
                  <span className="text-[10px] font-bold uppercase text-rose-400 tracking-wider">Villain (BB)</span>
                  <span className="text-xs text-slate-300 font-medium">$250 Stack</span>
                </div>
              </div>

              {/* Community Cards Felt Container */}
              <div className="w-full flex justify-center items-center gap-2 mt-auto mb-auto h-20">
                {activeStep.board.length === 0 ? (
                  <div className="text-emerald-500/30 text-xs font-bold tracking-widest uppercase border border-dashed border-emerald-500/20 rounded-xl px-6 py-4">
                    Waiting for Flop...
                  </div>
                ) : (
                  <div className="flex gap-1.5 animate-in zoom-in-95 duration-300">
                    {/* Flop */}
                    {activeStep.board.slice(0, 3).map(c => renderCard(c))}
                    {/* Turn */}
                    {activeStep.board[3] ? renderCard(activeStep.board[3]) : (
                      <div className="w-12 h-16 rounded-lg border-2 border-dashed border-emerald-500/20 flex items-center justify-center text-emerald-500/20 font-bold">?</div>
                    )}
                    {/* River */}
                    {activeStep.board[4] ? renderCard(activeStep.board[4]) : (
                      <div className="w-12 h-16 rounded-lg border-2 border-dashed border-emerald-500/20 flex items-center justify-center text-emerald-500/20 font-bold">?</div>
                    )}
                  </div>
                )}
              </div>

            </div>
          </div>

          {/* Player Felt Controller */}
          <div className="p-4 bg-slate-900 border-t border-slate-800 flex justify-between items-center gap-4">
            <div className="flex gap-1.5">
              <button
                onClick={handleReset}
                className="p-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 rounded-xl transition-colors"
                title="Restart Hand"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 p-1.5 rounded-xl">
              <button
                onClick={handlePrev}
                disabled={currentStepIdx === 0}
                className="p-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <div className="px-4 text-xs font-bold text-slate-300 select-none">
                Step {currentStepIdx + 1} of {activeHand.steps.length}
              </div>

              <button
                onClick={handleNext}
                disabled={currentStepIdx === activeHand.steps.length - 1}
                className="p-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            <button
              onClick={isPlaying ? handlePause : handlePlay}
              className={`px-5 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow ${
                isPlaying
                  ? 'bg-amber-600 hover:bg-amber-500 text-white shadow-amber-900/20'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-900/20'
              }`}
            >
              {isPlaying ? (
                <>
                  <Pause className="w-3.5 h-3.5" /> Pause
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5" /> Autoplay
                </>
              )}
            </button>
          </div>

        </div>

        {/* Hand Timeline and Analysis Panel */}
        <div className="space-y-6">
          
          {/* Timeline Stepper Box */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-5">
            <h3 className="font-bold text-slate-100 flex items-center gap-2">
              <Trophy className="w-5 h-5 text-amber-500" />
              Hand Stages
            </h3>
            
            {/* Horizontal Timeline Stepper */}
            <div className="relative flex justify-between">
              {/* Stepper bar line */}
              <div className="absolute top-[14px] left-0 right-0 h-0.5 bg-slate-800"></div>
              <div
                className="absolute top-[14px] left-0 h-0.5 bg-emerald-500 transition-all duration-300"
                style={{ width: `${(currentStepIdx / (activeHand.steps.length - 1)) * 100}%` }}
              ></div>

              {activeHand.steps.map((step, idx) => {
                const isCompleted = idx <= currentStepIdx;
                const isCurrent = idx === currentStepIdx;

                return (
                  <button
                    key={idx}
                    onClick={() => {
                      setCurrentStepIdx(idx);
                      handlePause();
                    }}
                    className="flex flex-col items-center relative z-10 group"
                  >
                    <div className={`w-7.5 h-7.5 rounded-full border-2 flex items-center justify-center text-[10px] font-bold transition-all duration-300 ${
                      isCurrent
                        ? 'bg-emerald-600 border-emerald-400 text-white scale-115 shadow-lg shadow-emerald-500/20'
                        : isCompleted
                        ? 'bg-slate-950 border-emerald-500 text-emerald-400'
                        : 'bg-slate-950 border-slate-800 text-slate-500 hover:border-slate-700'
                    }`}>
                      {idx + 1}
                    </div>
                    <span className={`text-[10px] mt-1.5 font-bold transition-colors ${
                      isCurrent ? 'text-emerald-400 font-extrabold' : isCompleted ? 'text-slate-300' : 'text-slate-500'
                    }`}>
                      {step.stage}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Action Log Card */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl flex flex-col min-h-[250px]">
            <div className="p-4 bg-slate-950/50 border-b border-slate-800">
              <h3 className="font-bold text-slate-200 text-sm flex items-center gap-2">
                <HelpCircle className="w-4 h-4 text-emerald-400" />
                Action Log & Commentary
              </h3>
            </div>
            
            <div className="p-6 flex-1 flex flex-col justify-between gap-6">
              <div className="space-y-4">
                <div className="bg-slate-950/40 p-4 border border-slate-800/60 rounded-xl">
                  <p className="text-slate-300 text-sm leading-relaxed">
                    {activeStep.description}
                  </p>
                </div>

                {/* Specific actions highlights */}
                <div className="grid grid-cols-2 gap-3 text-xs">
                  {activeStep.heroAction && (
                    <div className="p-3 bg-emerald-500/5 border border-emerald-500/10 rounded-lg">
                      <span className="block text-emerald-400 font-bold mb-1">Hero Action:</span>
                      <span className="text-slate-300 font-medium">{activeStep.heroAction}</span>
                    </div>
                  )}
                  {activeStep.villainAction && (
                    <div className="p-3 bg-rose-500/5 border border-rose-500/10 rounded-lg">
                      <span className="block text-rose-400 font-bold mb-1">Villain Action:</span>
                      <span className="text-slate-300 font-medium">{activeStep.villainAction}</span>
                    </div>
                  )}
                </div>

                {activeStep.extraAction && (
                  <div className="p-3 bg-slate-950/60 border border-slate-800/80 rounded-lg text-xs font-semibold text-slate-200 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full"></span>
                    {activeStep.extraAction}
                  </div>
                )}
              </div>

              <div className="text-[10px] text-slate-500 flex items-center gap-1.5 justify-center mt-2">
                <span>Interactive pre-flop / post-flop replayer. Stake: {activeHand.stakes}</span>
              </div>
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}
