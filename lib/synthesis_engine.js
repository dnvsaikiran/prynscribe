// lib/synthesis_engine.js — Elite Mode System v2
// 10 distinct AI synthesis modes with full prompt templates, auto-routing, and XP calculation.

// ==================================================
// MASCOT REGISTRY (10 Distinct Icons per Mode)
// ==================================================
export const MODE_CONFIG = {
    exam: {
        label: "Exam Mode",
        emoji: "🏆",
        mascot: "/assets/mascots/exam_griffin.png",
        tier: "pro",
        category: "master",
        tagline: "Deep Academic Mastery",
        accent: "hsl(252, 90%, 68%)"
    },
    summary: {
        label: "Summary Mode",
        emoji: "⚡",
        mascot: "/assets/mascots/summary_owl.png",
        tier: "free",
        category: "learn",
        tagline: "Fast Recap & Insight",
        accent: "hsl(210, 90%, 68%)"
    },
    podcast: {
        label: "Podcast Mode",
        emoji: "🎙️",
        mascot: "/assets/mascots/podcast_fox.png",
        tier: "free",
        category: "learn",
        tagline: "Narrative & Story Flow",
        accent: "hsl(30, 90%, 65%)"
    },
    memory: {
        label: "Memory Mode",
        emoji: "🧠",
        mascot: "/assets/mascots/memory_elephant.png",
        tier: "pro",
        category: "master",
        tagline: "Long-Term Retention",
        accent: "hsl(170, 80%, 55%)"
    },
    problem_solving: {
        label: "Problem Solving",
        emoji: "🔬",
        mascot: "/assets/mascots/problem_wolf.png",
        tier: "pro",
        category: "master",
        tagline: "Formulas & Logic Mastery",
        accent: "hsl(190, 90%, 60%)"
    },
    interview: {
        label: "Interview Mode",
        emoji: "💼",
        mascot: "/assets/mascots/interview_lion.png",
        tier: "elite",
        category: "career",
        tagline: "Career & Viva Prep",
        accent: "hsl(45, 100%, 60%)"
    },
    notes: {
        label: "Notes Mode",
        emoji: "📋",
        mascot: "/assets/mascots/notes_raven.png",
        tier: "pro",
        category: "pro",
        tagline: "Clean Cornell Notes",
        accent: "hsl(280, 70%, 65%)"
    },
    productivity: {
        label: "Productivity Mode",
        emoji: "🚀",
        mascot: "/assets/mascots/productivity_hawk.png",
        tier: "elite",
        category: "career",
        tagline: "Meetings & Action Items",
        accent: "hsl(350, 80%, 65%)"
    },
    research: {
        label: "Research Mode",
        emoji: "🔭",
        mascot: "/assets/mascots/research_dragon.png",
        tier: "elite",
        category: "pro",
        tagline: "Advanced Synthesis",
        accent: "hsl(155, 75%, 55%)"
    },
    auto: {
        label: "Auto Mode",
        emoji: "✨",
        mascot: "/assets/mascots/auto_phoenix.png",
        tier: "free",
        category: "smart",
        tagline: "AI Chooses Best Mode",
        accent: "hsl(320, 85%, 70%)"
    }
};

// ==================================================
// TIER DEFINITIONS
// ==================================================
export const TIER_LIMITS = {
    free:  ["summary", "podcast", "auto"],
    pro:   ["summary", "podcast", "auto", "exam", "memory", "problem_solving", "notes"],
    elite: Object.keys(MODE_CONFIG)
};

export function canUserUseMode(mode, userTier = "free") {
    return TIER_LIMITS[userTier]?.includes(mode) ?? false;
}

// ==================================================
// XP ENGINE
// ==================================================
export function calculateXP(transcriptLength, streakDays = 0) {
    const base = 50;
    const depthBonus = Math.floor(transcriptLength / 100);
    const rawXP = base + depthBonus;
    let multiplier = 1.0;
    if (streakDays >= 7) multiplier = 1.5;
    else if (streakDays >= 3) multiplier = 1.2;
    return Math.round(rawXP * multiplier);
}

export function calculateLevel(totalXP) {
    // log-based leveling: Level 1 = 0 XP, Level 10 = 1000XP, Level 50 = ~25000 XP
    return Math.floor(Math.log2(totalXP / 50 + 1)) + 1;
}

// ==================================================
// SYNTHESIS ENGINE CLASS
// ==================================================
export class SynthesisEngine {
    constructor(examPath, goal, outputLanguage = 'English', userTier = 'free') {
        this.examPath = examPath || 'General';
        this.goal = goal || 'Learning';
        this.outputLanguage = outputLanguage;
        this.userTier = userTier;
        this.persona = this._getPersona(examPath);
    }

    _getPersona(path) {
        const p = (path || '').toLowerCase();
        if (p.includes('mcat') || p.includes('usmle') || p.includes('neet') || p.includes('medical') || p.includes('plab')) return 'The Physician';
        if (p.includes('lsat') || p.includes('bar') || p.includes('law') || p.includes('sqe')) return 'The Jurist';
        if (p.includes('cfa') || p.includes('cpa') || p.includes('ca') || p.includes('finance') || p.includes('acca')) return 'The Strategic Analyst';
        if (p.includes('gre') || p.includes('gmat') || p.includes('sat') || p.includes('oxbridge') || p.includes('admissions')) return 'The Admissions Expert';
        if (p.includes('jee') || p.includes('gate') || p.includes('hacker') || p.includes('coding')) return 'The Systems Architect';
        if (p.includes('upsc') || p.includes('ias') || p.includes('policy')) return 'The Policy Oracle';
        if (p.includes('podcast') || p.includes('narrative')) return 'The Master Storyteller';
        return 'The Academic Mentor';
    }

    // ==================================================
    // AUTO-ROUTER: Detects correct mode from transcript
    // ==================================================
    detectMode(transcriptSnippet, userPath) {
        const text = (transcriptSnippet || '').toLowerCase();
        // Professional meeting detection
        if (['action items', 'deadline', 'follow up', 'agenda', 'attendees'].some(k => text.includes(k))) return 'productivity';
        // Research/Academic detection
        if (['methodology', 'hypothesis', 'literature review', 'citation', 'framework'].some(k => text.includes(k))) return 'research';
        // Problem solving (formulas, equations)
        if (['equation', 'formula', '=', 'derive', 'solve for', 'proof'].some(k => text.includes(k))) return 'problem_solving';
        // Interview prep detection
        if (['interview', 'tell me about yourself', 'strengths', 'weakness'].some(k => text.includes(k))) return 'interview';
        // Default: If user is on UPSC/JEE/NEET path → exam. Otherwise → summary.
        const examPaths = ['upsc', 'jee', 'neet', 'mcat', 'lsat', 'bar', 'cfa', 'ca', 'gate', 'cat'];
        if (examPaths.some(p => (userPath || '').toLowerCase().includes(p))) return 'exam';
        return 'summary';
    }

    // ==================================================
    // SYSTEM PROMPT FACTORY (10 MODES)
    // ==================================================
    getSystemPrompt(mode = 'exam') {
        const base = `You are ${this.persona}, a world-class expert in ${this.examPath}.
Your student is preparing for: ${this.goal}.
LANGUAGE RULE: ALL output — every field, key, value — MUST be written in ${this.outputLanguage}.
ANTI-HALLUCINATION: Only synthesize what exists in the transcript. Never invent facts.
OUTPUT: Always return STRICTLY valid JSON. No markdown fences, no prose outside the JSON object.`;

        const templates = {

            exam: `${base}
TASK: Generate a Master Exam Study Artifact for ${this.examPath}.
Return this EXACT JSON schema:
{
  "mode": "exam",
  "title": "string",
  "summary": "2-sentence session overview",
  "master_summary_sheet": "dense technical prose min 600 words covering all concepts",
  "exam_criticality": ["Top exam question 1", "Top exam question 2", "Top exam question 3"],
  "mcqs": [{"question": "string", "options": ["A","B","C","D"], "answerIndex": 0, "explanation": "string"}],
  "flashcards": [{"question": "string", "answer": "string"}],
  "glossary": [{"term": "string", "definition": "string"}],
  "concept_analysis": "deep dive into hardest concept, min 200 words",
  "revision_notes": ["bullet 1", "bullet 2"],
  "tags": ["tag1"],
  "quality_score": 95,
  "estimated_reading_time": 8
}
Generate 15 MCQs and 10 flashcards.`,

            summary: `${base}
TASK: Generate a Rapid Insight Recap.
Return this EXACT JSON schema:
{
  "mode": "summary",
  "title": "string",
  "summary": "string",
  "rapid_summary": "clear overview under 300 words",
  "key_points": ["point 1", "point 2"],
  "blind_spots": ["gap 1", "gap 2", "gap 3"],
  "high_yield_facts": ["fact 1"],
  "quick_revision": "60-second elevator pitch in 3-4 sentences",
  "tags": ["tag1"],
  "quality_score": 90,
  "estimated_reading_time": 3
}
Generate at least 10 key_points and 5 high_yield_facts.`,

            podcast: `${base}
TASK: Convert this transcript into an engaging Narrative Audio Script.
STRICT RULE: NO bullet points, NO tables, NO lists anywhere.
Return this EXACT JSON schema:
{
  "mode": "podcast",
  "title": "string",
  "summary": "1 sentence",
  "narrative_script": "smooth flowing story, 500-800 words, conversational, no bullets",
  "hook": "one compelling opening sentence to grab attention",
  "key_takeaway": "one powerful closing insight",
  "tags": ["tag1"],
  "quality_score": 88,
  "estimated_reading_time": 5
}`,

            memory: `${base}
TASK: Generate a Long-Term Retention System.
Return this EXACT JSON schema:
{
  "mode": "memory",
  "title": "string",
  "summary": "string",
  "mnemonics": [{"concept": "string", "mnemonic": "string", "explanation": "string"}],
  "spaced_repetition": [{"card": "string", "answer": "string", "difficulty": "easy|medium|hard"}],
  "memory_ladder": ["Step 1 - simplest concept", "Step 2", "Step 3 - hardest concept"],
  "recall_plan": {"24_hours": "what to review", "7_days": "what to review", "30_days": "what to review"},
  "priority_facts": {"core": ["fact1"], "peripheral": ["fact1"]},
  "tags": ["tag1"],
  "quality_score": 92,
  "estimated_reading_time": 6
}
Generate at least 8 mnemonics and 10 spaced repetition cards.`,

            problem_solving: `${base}
TASK: Generate a Logical Mastery Framework.
Return this EXACT JSON schema:
{
  "mode": "problem_solving",
  "title": "string",
  "summary": "string",
  "formulas": [{"formula": "string", "meaning": "string", "when_to_use": "string"}],
  "step_by_step": [{"step": 1, "action": "string", "why": "string"}],
  "worked_examples": [{"problem": "string", "solution": "string"}],
  "common_mistakes": ["mistake 1", "mistake 2"],
  "shortcuts": ["trick 1", "trick 2"],
  "practice_set": [{"question": "string", "answer": "string"}],
  "tags": ["tag1"],
  "quality_score": 93,
  "estimated_reading_time": 7
}
Generate 2 worked examples and 5 practice questions.`,

            interview: `${base}
TASK: Generate a Career Preparation Suite.
Return this EXACT JSON schema:
{
  "mode": "interview",
  "title": "string",
  "summary": "string",
  "technical_questions": [{"question": "string", "model_answer": "string"}],
  "hr_behavioral": [{"question": "string", "star_answer": {"situation": "string", "task": "string", "action": "string", "result": "string"}}],
  "communication_tips": ["tip 1", "tip 2"],
  "confidence_boosters": ["strength 1", "strength 2", "strength 3"],
  "vocabulary_upgrade": [{"old_phrase": "string", "elite_phrase": "string"}],
  "tags": ["tag1"],
  "quality_score": 91,
  "estimated_reading_time": 6
}
Generate 5 technical questions and 3 HR questions.`,

            notes: `${base}
TASK: Generate Clean Professional Documentation.
Return this EXACT JSON schema:
{
  "mode": "notes",
  "title": "string",
  "summary": "string",
  "cornell_notes": {"cues": ["cue 1"], "notes": "structured notes body", "summary_block": "bottom summary"},
  "heading_structure": [{"heading": "string", "subheadings": ["string"], "content": "string"}],
  "printable_one_pager": "ultra-dense single-page text summary under 400 words",
  "revision_sheet": ["one-sentence section summary 1"],
  "tags": ["tag1"],
  "quality_score": 89,
  "estimated_reading_time": 4
}`,

            productivity: `${base}
TASK: Generate an Executive Meeting Summary.
Return this EXACT JSON schema:
{
  "mode": "productivity",
  "title": "string",
  "summary": "string",
  "decisions_made": ["decision 1", "decision 2"],
  "action_items": [{"task": "string", "owner": "string", "priority": "high|medium|low"}],
  "deadlines": [{"item": "string", "date": "string"}],
  "executive_summary": "3-paragraph BLUF summary",
  "follow_up_tasks": ["task 1"],
  "key_takeaways": ["takeaway 1"],
  "tags": ["tag1"],
  "quality_score": 94,
  "estimated_reading_time": 4
}`,

            research: `${base}
TASK: Generate an Academic Research Synthesis.
Return this EXACT JSON schema:
{
  "mode": "research",
  "title": "string",
  "summary": "string",
  "core_arguments": ["argument 1", "argument 2"],
  "opposing_viewpoints": ["counterpoint 1"],
  "frameworks_used": [{"name": "string", "description": "string"}],
  "deeper_insights": ["insight 1", "insight 2"],
  "research_directions": ["direction 1", "direction 2", "direction 3"],
  "citation_map": [{"name_or_concept": "string", "significance": "string"}],
  "knowledge_gaps": ["gap 1"],
  "tags": ["tag1"],
  "quality_score": 96,
  "estimated_reading_time": 9
}`,

            auto: `${base}
TASK: First, analyze the transcript and select the SINGLE BEST mode from: [exam, summary, podcast, memory, problem_solving, interview, notes, productivity, research].
Then generate the full artifact for that mode.
Add a field "auto_selected_mode" at the top of the JSON with your choice and 1-sentence reason.
Then include ALL fields required for that mode.`
        };

        return templates[mode] || templates.exam;
    }

    wrapTranscript(transcript) {
        const snippet = transcript.substring(0, 500);
        return `PATH: ${this.examPath} | PERSONA: ${this.persona} | GOAL: ${this.goal}
---TRANSCRIPT START---
${transcript}
---TRANSCRIPT END---
Process the above transcript completely and thoroughly as ${this.persona}.`;
    }
}
