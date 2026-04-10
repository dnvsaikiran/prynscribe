// pages/transcript.js
import { getLecture, getFullTranscript } from '../lib/db.js';
import { renderMindmap } from '../lib/mindmap.js';
import { askLectureBot } from '../lib/ai_service.js';

document.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const lectureId = parseInt(urlParams.get('id')); if (!lectureId) return;

    let lectureData = null;
    let chatHistory = JSON.parse(localStorage.getItem(`pryn-chat-${lectureId}`)) || [];

    // UI Elements
    const tabItems = document.querySelectorAll('.top-nav-item');
    const sections = document.querySelectorAll('.suite-section');
    const mindmapSvg = document.getElementById('mindmap-svg');
    const chatInput = document.getElementById('chat-input');
    const btnSendChat = document.getElementById('btn-send-chat');
    const chatMessages = document.getElementById('chat-messages');
    const fullTranscriptEl = document.getElementById('full-transcript-content');

    // --- THEME PERSISTENCE ---
    const savedTheme = localStorage.getItem('prynscribe-theme') || 'theme-white';
    document.body.className = savedTheme;

    document.querySelectorAll('.theme-btn').forEach(btn => {
        btn.onclick = () => {
            const theme = btn.getAttribute('data-theme');
            document.body.className = theme;
            localStorage.setItem('prynscribe-theme', theme);
            console.log("Applied Theme:", theme);
        };
    });

    // --- TAB SWITCHER LOGIC ---
    tabItems.forEach(item => {
        item.onclick = () => {
            const target = item.getAttribute('data-target');
            tabItems.forEach(t => t.classList.remove('active'));
            sections.forEach(s => s.classList.remove('active'));
            
            item.classList.add('active');
            const targetSection = document.getElementById(target);
            if (targetSection) targetSection.classList.add('active');
            
            if (target === 'section-mindmap' && lectureData?.mindmap_data) {
                renderMindmap(mindmapSvg, lectureData.mindmap_data);
            }
        };
    });

    // --- CHATBOT LOGIC ---
    function renderChat() {
        chatMessages.innerHTML = chatHistory.map(m => `
            <div class="message ${m.role}">${m.content}</div>
        `).join('');
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    btnSendChat.onclick = async () => {
        const query = chatInput.value.trim();
        if (!query) return;

        chatHistory.push({ role: 'user', content: query });
        chatInput.value = '';
        renderChat();

        const transcript = await getFullTranscript(lectureId);
        const response = await askLectureBot(query, transcript, chatHistory.slice(-5));
        
        chatHistory.push({ role: 'bot', content: response });
        localStorage.setItem(`pryn-chat-${lectureId}`, JSON.stringify(chatHistory));
        renderChat();
    };

    chatInput.onkeydown = (e) => { if (e.key === 'Enter') btnSendChat.click(); };

    // --- DATA REFRESH ---
    let refreshAttempts = 0;
    async function refreshData() {
        try {
            lectureData = await getLecture(lectureId); 
            if (!lectureData) {
                console.warn("[Transcript] Lecture not found in DB.");
                return;
            }
        } catch (e) {
            console.error("[Transcript] DB Error:", e);
            return;
        }
        
        const titleEl = document.getElementById('lecture-title-s');
        titleEl.textContent = lectureData.title || "Subject Analysis In Progress...";
        
        // Render Tags
        if (lectureData.tags && lectureData.tags.length) {
            const tagContainer = document.getElementById('lecture-tags');
            tagContainer.innerHTML = lectureData.tags.map(tag => `
                <span style="font-size:10px; font-weight:800; background:var(--border); color:var(--accent); padding:4px 12px; border-radius:99px; text-transform:uppercase; letter-spacing:0.05em;">${tag}</span>
            `).join('');
        }
        
        if (lectureData.targetStyle === 'general') {
            document.body.classList.add('mode-general');
        } else {
            document.body.classList.remove('mode-general');
        }

        if (lectureData.status === 'complete') {
            renderSuite(lectureData);
            document.querySelector('.suite-container').style.opacity = '1';
        } else if (lectureData.status === 'error' || refreshAttempts > 120) { // 6 minutes timeout
            const errorMessage = lectureData.error_message || "Unable to synthesize notes. This usually happens if the recording was too short or API keys are missing.";
            document.getElementById('summary-sheet-content').innerHTML = `
                <div style="padding: 40px; text-align: center; color: #ef4444;">
                    <h3 style="font-size: 24px; font-weight: 900; margin-bottom: 10px;">GENERATION FAILED</h3>
                    <p style="opacity: 0.7;">${errorMessage}</p>
                    <button onclick="location.reload()" style="margin-top:20px; padding:10px 20px; background:var(--accent); color:white; border:none; border-radius:8px; cursor:pointer; font-weight:800;">RETRY SYNC</button>
                </div>
            `;
        } else {
            // HIGH-QUALITY HYBRID LOADING STATE
            if (lectureData.status === 'synthesizing') {
                const summaryEl = document.getElementById('summary-sheet-content');
                if (!summaryEl.innerHTML || summaryEl.innerHTML.includes('spin')) {
                    summaryEl.innerHTML = `
                        <div style="padding: 60px; text-align: center;">
                            <div style="width: 50px; height: 50px; border: 3px solid var(--accent); border-top-color: transparent; border-radius: 50%; margin: 0 auto 20px; animation: spin 1s linear infinite;"></div>
                            <h3 style="font-size: 20px; font-weight: 800; letter-spacing: 0.1em; color: var(--accent); margin-bottom:10px;">ANALYSIS IN PROGRESS</h3>
                            <p style="opacity:0.6; font-size:14px;">The Verbatim Transcript is ready below. AI Synthesis is active.</p>
                        </div>
                        <style>@keyframes spin { to { transform: rotate(360deg); } }</style>
                    `;
                }
            }
            refreshAttempts++;
            setTimeout(refreshData, 3000);
        }

        const rawTranscript = await getFullTranscript(lectureId);
        if (rawTranscript) fullTranscriptEl.textContent = rawTranscript;
    }

    function renderSuite(data) {
        if (data.summary_sheet || data.synthesis) {
            document.getElementById('summary-sheet-content').innerHTML = `
                <div class="summary-sheet-pro" style="font-size: 1.15rem; line-height: 1.8; color: var(--text); padding: 10px;">
                    ${formatMarkdown(data.summary_sheet || data.synthesis)}
                </div>
            `;
        }
        
        // Ensure mindmap is rendered if we are on the mindmap tab
        const activeTab = document.querySelector('.top-nav-item.active');
        if (data.mindmap_data) {
            console.log("[Transcript] Rendering Mindmap...");
            renderMindmap(document.getElementById('mindmap-svg'), data.mindmap_data);
        }
        if (data.analysis) document.getElementById('critical-analysis').innerHTML = formatMarkdown(data.analysis);
        if (data.mains_questions) {
            // Updated Mains logic: Why Expected + Thinking Direction
            const mList = document.getElementById('mains-questions');
            mList.innerHTML = data.mains_questions.map((mq, idx) => `
                <div style="margin-bottom:40px; border-bottom:1px solid var(--border); padding-bottom:30px;">
                    <div style="font-size:18px; font-weight:900; line-height:1.4; margin-bottom:20px; color:var(--text);">Q${idx+1}. ${mq.question}</div>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:20px;">
                        <div style="background:rgba(0,0,0,0.03); padding:20px; border-radius:12px;">
                            <div style="font-size:10px; font-weight:900; color:var(--accent); text-transform:uppercase; letter-spacing:0.1em; margin-bottom:10px;">Why Expected</div>
                            <div style="font-size:13px; line-height:1.6; opacity:0.8;">${mq.why_expected}</div>
                        </div>
                        <div style="background:var(--accent); color:#fff; padding:20px; border-radius:12px;">
                            <div style="font-size:10px; font-weight:900; text-transform:uppercase; letter-spacing:0.1em; margin-bottom:10px;">Thinking Direction</div>
                            <div style="font-size:13px; line-height:1.6; opacity:0.9;">${mq.thinking_direction}</div>
                        </div>
                    </div>
                </div>
            `).join('');
        }
        if (data.history) document.getElementById('history-context').innerHTML = formatMarkdown(data.history);

        // Flashcards
        if (data.flashcards) {
            const list = document.getElementById('flashcard-list');
            list.innerHTML = data.flashcards.map(cf => `
                <div class="flip-card" onclick="this.classList.toggle('flipped')">
                    <div class="flip-card-inner">
                        <div class="flip-card-front">${cf.question}</div>
                        <div class="flip-card-back">${cf.answer}</div>
                    </div>
                </div>
            `).join('');
        }

        // Live MCQ Quiz
        if (data.mcqs) {
            const qList = document.getElementById('quiz-list');
            qList.innerHTML = '';
            data.mcqs.forEach((mcq, idx) => {
                const div = document.createElement('div');
                div.innerHTML = `
                    <div style="font-weight:700; margin-bottom:1rem; font-size:1.1rem;">${idx+1}. ${mcq.question}</div>
                    <div style="display:grid; gap:12px;">
                        ${mcq.options.map((opt, i) => `<div class="quiz-opt" data-ans="${mcq.answer}" data-idx="${i}" style="padding:15px; border:1px solid var(--border); border-radius:8px; cursor:pointer; background: var(--bg); color: var(--text); transition:all 0.2s;">${opt}</div>`).join('')}
                    </div>
                    <div class="mcq-explanation" style="display:none; margin-top:15px; padding:15px; background:rgba(99,102,241,0.1); border-radius:8px; font-size:13px; line-height:1.6; border-left:4px solid var(--accent);">
                        <strong style="display:block; margin-bottom:5px; color:var(--accent);">ANALYSIS</strong>
                        ${mcq.explanation || "No explanation provided."}
                    </div>
                `;
                div.querySelectorAll('.quiz-opt').forEach(opt => {
                    opt.onclick = () => {
                        const isCorrect = (opt.textContent.trim() === mcq.answer.trim() || opt.getAttribute('data-idx') == mcq.answer);
                        if (isCorrect) {
                            opt.style.borderColor = '#10b981'; opt.style.background = 'rgba(16, 185, 129, 0.1)';
                        } else {
                            opt.style.borderColor = '#ef4444'; opt.style.background = 'rgba(239, 68, 68, 0.1)';
                        }
                        div.querySelector('.mcq-explanation').style.display = 'block';
                    };
                });
                qList.appendChild(div);
                if (idx < data.mcqs.length - 1) qList.appendChild(document.createElement('hr'));
            });
        }

        // Mains Questions (The UPSC Thinking Engine Differentiator)
        if (data.mains_questions) {
            const mList = document.getElementById('mains-questions');
            mList.innerHTML = data.mains_questions.map((mq, idx) => `
                <div style="margin-bottom:40px; border-bottom:1px solid var(--border); padding-bottom:30px;">
                    <div style="font-size:18px; font-weight:900; line-height:1.4; margin-bottom:20px; color:var(--text);">Q${idx+1}. ${mq.question}</div>
                    
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:20px;">
                        <div style="background:rgba(0,0,0,0.03); padding:20px; border-radius:12px;">
                            <div style="font-size:10px; font-weight:900; color:var(--accent); text-transform:uppercase; letter-spacing:0.1em; margin-bottom:10px;">Why Expected</div>
                            <div style="font-size:13px; line-height:1.6; opacity:0.8;">${mq.why_expected}</div>
                        </div>
                        <div style="background:var(--accent); color:#fff; padding:20px; border-radius:12px;">
                            <div style="font-size:10px; font-weight:900; text-transform:uppercase; letter-spacing:0.1em; margin-bottom:10px;">Thinking Direction</div>
                            <div style="font-size:13px; line-height:1.6; opacity:0.9;">${mq.thinking_direction}</div>
                        </div>
                    </div>
                </div>
            `).join('');
        }

        // Timeline
        if (data.timeline) {
            const tList = document.getElementById('timeline-list');
            tList.innerHTML = data.timeline.map(item => `
                <div style="display:flex; gap:30px; margin-bottom:30px;">
                    <div style="min-width:120px; text-align:right; font-weight:900; color:var(--accent); font-family:'JetBrains Mono';">${item.event.split(' ')[0]}</div>
                    <div style="flex:1; border-left:2px solid var(--border); padding-left:30px; position:relative;">
                        <div style="width:10px; height:10px; background:var(--accent); border-radius:50%; position:absolute; left:-6px; top:6px;"></div>
                        <div style="font-weight:800; margin-bottom:8px; font-size:1.1rem;">${item.event}</div>
                        <div style="font-size:14px; opacity:0.7; line-height:1.6;">${item.description}</div>
                    </div>
                </div>
            `).join('');
        }

        // Glossary
        if (data.glossary) {
            const gList = document.getElementById('glossary-list');
            gList.innerHTML = data.glossary.map(g => `
                <div style="margin-bottom: 24px;">
                    <strong style="display:block; font-size:18px; color: var(--accent);">${g.term}</strong>
                    <div style="font-size:14px; opacity:0.8; margin:4px 0;">${g.definition}</div>
                    <div style="font-size:12px; font-weight:700;">EX: ${g.example}</div>
                </div>
            `).join('');
        }
    }

    function formatMarkdown(text) {
        return text.replace(/^# (.*)/gm, '<h3>$1</h3>').replace(/^## (.*)/gm, '<h4>$1</h4>').replace(/\n\n/g, '<p></p>');
    }

    // --- EXPORT LOGIC ---
    document.getElementById('export-pdf')?.addEventListener('click', () => {
        window.print();
    });

    document.getElementById('export-notion')?.addEventListener('click', () => {
        const title = document.querySelector('.lecture-title').textContent;
        const summary = document.getElementById('summary-sheet-content').textContent;
        const text = `# ${title}\n\n${summary}`;
        navigator.clipboard.writeText(text).then(() => {
            alert("Notes copied to clipboard! You can now paste them into Notion.");
        });
    });

    document.getElementById('export-notebook')?.addEventListener('click', () => {
        const transcript = document.getElementById('transcript-content').textContent;
        const blob = new Blob([transcript], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `transcript_${Date.now()}.txt`;
        a.click();
    });

    await refreshData();
    renderChat();
});
