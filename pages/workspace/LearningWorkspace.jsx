import React, { useState, useEffect } from 'react';

/**
 * PrynScribe Premium Learning Workspace
 * A high-end 3-column learning environment inspired by Notion/Perplexity.
 */

const LearningWorkspace = ({ lectureData, onAskAI }) => {
  const [activeTab, setActiveTab] = useState('summary_sheet');
  const [focusMode, setFocusMode] = useState(false);
  const [revisionMode, setRevisionMode] = useState(false);
  const [chatQuery, setChatQuery] = useState('');

  // Sidebar Items
  const navItems = [
    { id: 'summary_sheet', label: 'Summary Sheet', icon: '📝' },
    { id: 'mindmap', label: 'Concept Map', icon: '🕸️' },
    { id: 'quiz', label: 'Recall Quiz', icon: '📝' },
    { id: 'flashcards', label: 'Flashcards', icon: '🃏' },
    { id: 'timeline', label: 'Timeline', icon: '⏳' },
    { id: 'analysis', label: 'Analysis', icon: '⚖️' },
  ];

  return (
    <div className={`flex h-screen ${focusMode ? 'overflow-hidden' : ''} bg-[#f8fafc] font-sans antialiased text-[#1e293b]`}>
      
      {/* 1. LEFT SIDEBAR (Dynamic Navigation) */}
      {!focusMode && (
        <aside className="w-64 border-r border-slate-200 bg-white flex flex-col p-6 transition-all duration-300">
          <div className="flex items-center gap-3 mb-10 px-2">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-bold">P</div>
            <h1 className="text-lg font-extrabold tracking-tight text-slate-900">PrynScribe</h1>
          </div>

          <nav className="flex-1 space-y-1">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-2 mb-4">Study Suite</p>
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                  activeTab === item.id 
                    ? 'bg-indigo-50 text-indigo-600 shadow-sm' 
                    : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <span>{item.icon}</span>
                {item.label}
              </button>
            ))}
          </nav>

          <div className="mt-auto pt-6 border-t border-slate-100">
            <button 
                onClick={() => setRevisionMode(!revisionMode)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-bold transition-colors ${revisionMode ? 'bg-amber-50 text-amber-600' : 'text-slate-400 hover:bg-slate-50'}`}
            >
              REVISION MODE
              <div className={`w-8 h-4 rounded-full relative transition-colors ${revisionMode ? 'bg-amber-400' : 'bg-slate-200'}`}>
                <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${revisionMode ? 'left-4.5' : 'left-0.5'}`} />
              </div>
            </button>
          </div>
        </aside>
      )}

      {/* 2. MAIN CONTENT (Learning Focus) */}
      <main className="flex-1 overflow-y-auto px-12 py-10 relative">
        {/* Focus Mode Toggle */}
        <button 
          onClick={() => setFocusMode(!focusMode)}
          className="absolute top-8 right-8 text-slate-400 hover:text-indigo-600 p-2 transition-colors"
          title="Toggle Focus Mode"
        >
          {focusMode ? '📁' : '🔲'}
        </button>

        <div className="max-w-3xl mx-auto space-y-12">
          {/* Header */}
          <header className="space-y-4">
            <div className="flex items-center gap-2 text-[10px] font-bold text-indigo-600 uppercase tracking-[0.2em]">
                {lectureData?.status || 'Active Analysis'} • PRYNSCRIBE INSIGHT
            </div>
            <h2 className="text-4xl font-black text-slate-900 leading-tight">
              {lectureData?.title || 'Lecture Intelligence Artifact'}
            </h2>
          </header>

          {/* Highlights Section */}
          <section className="bg-white border border-indigo-100 rounded-2xl p-8 shadow-sm relative overflow-hidden group">
            <div className="absolute top-0 left-0 w-1 h-full bg-indigo-500" />
            <h3 className="text-xs font-extrabold text-indigo-500 uppercase tracking-widest mb-6">Execution Summary</h3>
            <p className="text-lg text-slate-700 leading-relaxed font-medium italic">
                {lectureData?.summary || 'The AI is currently architecting your session summary. Key conceptual movements will appear here shortly...'}
            </p>
          </section>

          {/* Dynamic Content Cards */}
          <div className="space-y-8 pb-32">
            {activeTab === 'summary_sheet' && (
                <div className="bg-white rounded-2xl p-10 shadow-sm border border-slate-100 prose prose-slate max-w-none">
                    <h3 className="text-xl font-bold mb-8">Academic Summary Sheet</h3>
                    <div className="text-slate-600 leading-8 space-y-6">
                        {/* Render Summary Sheet Markdown here */}
                        {lectureData?.summary_sheet || lectureData?.synthesis || <div className="h-64 bg-slate-50 animate-pulse rounded-xl" />}
                    </div>
                </div>
            )}
            {/* Other tab content sections here... */}
          </div>
        </div>
      </main>

      {/* 3. RIGHT PANEL (AI Sidekick) */}
      {!focusMode && (
        <aside className="w-80 border-l border-slate-200 bg-white flex flex-col transition-all duration-300">
           <div className="p-6 border-b border-slate-100">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Neural Consultant</h3>
              <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 h-64 overflow-y-auto space-y-3 mb-4 text-xs">
                 <div className="bg-white p-3 rounded-lg shadow-sm text-slate-600 border border-slate-100">
                    Hello! I've indexed the entire lecture. Ask me specifically about the conceptual gaps or historical context.
                 </div>
              </div>
              <div className="relative">
                 <input 
                   type="text" 
                   value={chatQuery}
                   onChange={(e) => setChatQuery(e.target.value)}
                   placeholder="Ask Intelligence..." 
                   className="w-full bg-slate-50 border border-slate-100 rounded-xl px-4 py-3 text-sm outline-none focus:border-indigo-300 transition-colors"
                 />
                 <button className="absolute right-3 top-2.5 p-1 text-indigo-600 hover:bg-indigo-50 rounded-lg">➡️</button>
              </div>
           </div>

           <div className="flex-1 p-6 space-y-8 overflow-y-auto">
              <div>
                 <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4">Key Terms</h4>
                 <div className="flex flex-wrap gap-2">
                    {['Sovereignty', 'Legislature', 'Ambit'].map(term => (
                        <span key={term} className="px-3 py-1 bg-indigo-50 text-indigo-600 rounded-full text-[10px] font-bold border border-indigo-100 cursor-help">
                            {term}
                        </span>
                    ))}
                 </div>
              </div>

              <div className="bg-slate-900 rounded-2xl p-6 text-white">
                 <h4 className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest mb-4">AI Pro Insight</h4>
                 <p className="text-xs leading-5 text-slate-300 italic">
                    "This lecture places heavy emphasis on the interplay between Constitutional Law and Executive Power. Focus specifically on Section 02 in your synthesis."
                 </p>
              </div>
           </div>
        </aside>
      )}
    </div>
  );
};

export default LearningWorkspace;
