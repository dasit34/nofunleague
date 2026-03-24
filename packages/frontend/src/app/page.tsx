'use client';
import Link from 'next/link';

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-[#0a0a0a] flex flex-col">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-4 border-b border-white/10">
        <div className="flex items-center gap-2">
          <span className="text-gold-500 font-black text-2xl tracking-tighter">NFL</span>
          <span className="text-white/30 text-sm">The No Fun League</span>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/login" className="text-white/70 hover:text-white text-sm transition-colors">Sign In</Link>
          <Link href="/register" className="btn-gold text-sm py-2 px-4">Join the League</Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="flex-1 flex flex-col items-center justify-center text-center px-4 py-20">
        <div className="inline-flex items-center gap-2 bg-gold/10 border border-gold/30 rounded-full px-4 py-2 mb-8">
          <span className="w-2 h-2 bg-gold rounded-full animate-pulse"></span>
          <span className="text-gold text-sm font-semibold">AI-Powered Fantasy Football</span>
        </div>

        <h1 className="text-6xl md:text-8xl font-black text-white mb-4 tracking-tighter leading-none">
          THE NO FUN
          <br />
          <span className="text-gold">LEAGUE</span>
        </h1>

        <p className="text-white/60 text-lg md:text-xl max-w-2xl mb-4">
          Where trash talk is automated, chaos is guaranteed, and your team's embarrassing losses get roasted by AI in real time.
        </p>

        <p className="text-gold/80 text-sm font-semibold mb-10 uppercase tracking-widest">
          Powered by Claude AI + Sleeper API
        </p>

        <div className="flex flex-col sm:flex-row gap-4">
          <Link href="/register" className="btn-gold text-lg py-4 px-8">
            Start Dominating
          </Link>
          <Link href="/login" className="btn-outline-gold text-lg py-4 px-8">
            Sign In
          </Link>
        </div>
      </section>

      {/* Feature Grid */}
      <section className="px-4 pb-20 max-w-6xl mx-auto w-full">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            {
              icon: '🤖',
              title: 'AI Trash Talk',
              desc: 'CHAOS, your AI commissioner, automatically roasts your losses with surgical precision.',
            },
            {
              icon: '📰',
              title: 'Weekly Recaps',
              desc: 'Every week gets a savage AI-written recap. No mercy for the weak.',
            },
            {
              icon: '⚡',
              title: 'Live Sleeper Sync',
              desc: 'Connect your Sleeper league. Scores, rosters, and matchups — all live.',
            },
            {
              icon: '💬',
              title: 'League Chat',
              desc: 'AI drops trash talk directly into your league chat. Human trash talk optional.',
            },
            {
              icon: '🏆',
              title: 'Trade Reactions',
              desc: 'Every trade gets an AI verdict. Who got robbed? CHAOS will tell you.',
            },
            {
              icon: '🔥',
              title: 'Chaos Mode',
              desc: 'Phase 2: Enable full chaos — AI lineup sabotage, fake injuries, and more.',
            },
          ].map((f) => (
            <div key={f.title} className="card hover:border-gold/30 transition-colors">
              <div className="text-3xl mb-3">{f.icon}</div>
              <h3 className="text-white font-bold text-lg mb-2">{f.title}</h3>
              <p className="text-white/50 text-sm leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/10 px-6 py-6 text-center">
        <p className="text-white/30 text-sm">
          The No Fun League &mdash; Built on Claude AI + Sleeper API
          <span className="mx-2 text-gold">|</span>
          <span className="text-gold/50">No quarterbacks were harmed in the making of this app.</span>
        </p>
      </footer>
    </main>
  );
}
