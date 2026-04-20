import { getFullTranscript, getLecture, getOutput, getTranscriptBlocks, getAudioChunk } from '../lib/db.js';
import { renderMindmap } from '../lib/viz.js';
import { getExamsForCountry } from '../lib/regional_config.js';
import { askLectureBot } from '../lib/ai_service.js';
import { downloadAnkiDeck } from '../lib/export_utils.js';

document.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const lectureIdRaw = urlParams.get('id');
    if (!lectureIdRaw) return;
    const lectureId = lectureIdRaw.toString(); // DB uses string IDs for session isolation

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
        btn.addEventListener('click', () => {
            const theme = btn.getAttribute('data-theme');
            document.body.className = theme;
            localStorage.setItem('prynscribe-theme', theme);
        });
    });

    // --- TAB SWITCHER LOGIC ---
    tabItems.forEach(item => {
        item.addEventListener('click', () => {
            const target = item.getAttribute('data-target');
            tabItems.forEach(t => t.classList.remove('active'));
            sections.forEach(s => s.classList.remove('active'));
            
            item.classList.add('active');
            const targetSection = document.getElementById(target);
            if (targetSection) targetSection.classList.add('active');
            
            if (target === 'section-mindmap' && lectureData?.mindmap_data) {
                renderMindmap(mindmapSvg, lectureData.mindmap_data);
            }
        });
    });

    // --- CHATBOT LOGIC ---
    function renderChat() {
        if (!chatMessages) return;
        chatMessages.innerHTML = chatHistory.map(m => `
            <div class="message ${m.role}">${m.content}</div>
        `).join('');
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    if (btnSendChat) {
        btnSendChat.addEventListener('click', async () => {
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
        });
    }

    if (chatInput) {
        chatInput.addEventListener('keydown', (e) => { 
            if (e.key === 'Enter') btnSendChat.click(); 
        });
    }

    // --- DATA REFRESH ---
    let refreshAttempts = 0;
    async function refreshData() {
        try {
            // First check if we already have complete data
            lectureData = await getOutput(lectureId);
            
            if (!lectureData) {
                // Check basic lecture status
                lectureData = await getLecture(lectureId); 
            }
        } catch (e) {
            console.error("[Transcript] Data Fetch Error:", e);
        }

        if (!lectureData) {
            console.warn("[Transcript] No data found locally or in cloud. Retrying...");
            if (refreshAttempts < 10) {
                refreshAttempts++;
                setTimeout(refreshData, 2000);
            } else {
                const summaryEl = document.getElementById('summary-sheet-content');
                if (summaryEl) summaryEl.innerHTML = `<div style="padding: 40px; text-align: center; color: var(--muted);">Waiting for session data to sync...</div>`;
            }
            return;
        }
        
        const titleEl = document.getElementById('lecture-title-s');
        if (titleEl) titleEl.textContent = lectureData.title || "Subject Analysis In Progress...";
        
        // Render Tags (Top Right Console)
        if (lectureData.tags && lectureData.tags.length) {
            const tagContainer = document.getElementById('lecture-tags');
            if (tagContainer) {
                tagContainer.innerHTML = lectureData.tags.map(tag => `
                    <span style="font-size:10px; font-weight:900; background:#000; color:#fff; padding:6px 14px; border-radius:4px; text-transform:uppercase; letter-spacing:0.1em; box-shadow:0 4px 10px rgba(0,0,0,0.1);">${tag}</span>
                `).join('');
            }
        }
        
        const mode = lectureData.targetStyle || 'exam';
        if (mode === 'exam') {
            document.querySelectorAll('.mode-exam-only').forEach(el => el.style.display = 'block');
            const navQuiz = document.getElementById('nav-quiz');
            if (navQuiz) navQuiz.textContent = "15-MCQ Evaluation";
        } else {
            document.querySelectorAll('.mode-exam-only').forEach(el => el.style.display = 'none');
            const navQuiz = document.getElementById('nav-quiz');
            if (navQuiz) navQuiz.textContent = "5-MCQ Analysis";
        }

        const blocks = await getTranscriptBlocks(lectureId);
        if (blocks && blocks.length && fullTranscriptEl) {
            renderFullTranscript(blocks, lectureId);
        } else if (fullTranscriptEl) {
            const transcript = await getFullTranscript(lectureId);
            fullTranscriptEl.textContent = transcript || "Waiting for transcription flow...";
        }
        
        if (lectureData.status === 'complete') {
            const hasGoodContent = lectureData.summary_sheet && lectureData.summary_sheet.length > 100;
            
            if (!hasGoodContent) {
                 const summaryEl = document.getElementById('summary-sheet-content');
                 if (summaryEl) {
                     summaryEl.innerHTML = `
                         <div style="padding: 40px; text-align: center; color: #f59e0b; background: rgba(245, 158, 11, 0.05); border: 2px dashed #f59e0b; border-radius: 12px;">
                             <h3 style="font-size: 20px; font-weight: 800; margin-bottom: 15px;">PARTIAL SUMMARY RECOVERY</h3>
                             <p style="opacity: 0.7; max-width: 400px; margin: 0 auto 20px;">The AI synthesized the lecture, but the final artifact is too short or empty (possibly due to API rate limits during a complex 3-hour session).</p>
                             <button id="reprocess-btn" style="padding: 12px 24px; background: #f59e0b; color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 800;">RE-ATTEMPT SYNTHESIS</button>
                         </div>
                     `;
                     document.getElementById('reprocess-btn')?.addEventListener('click', () => location.reload());
                 }
            } else {
                renderSuite(lectureData);
                const container = document.querySelector('.suite-container');
                if (container) container.style.opacity = '1';
            }
        } else if (lectureData.status === 'error' || refreshAttempts > 120) { 
            const errorMessage = lectureData.error_message || "Unable to synthesize notes. Try refreshing the extension.";
            const summaryEl = document.getElementById('summary-sheet-content');
            if (summaryEl) {
                summaryEl.innerHTML = `
                    <div style="padding: 40px; text-align: center; color: #ef4444;">
                        <h3 style="font-size: 24px; font-weight: 900; margin-bottom: 10px;">GENERATION FAILED</h3>
                        <p style="opacity: 0.7;">${errorMessage}</p>
                        <button id="retry-sync-btn" style="margin-top:20px; padding:10px 20px; background:var(--accent); color:white; border:none; border-radius:8px; cursor:pointer; font-weight:800;">RETRY SYNC</button>
                    </div>
                `;
                document.getElementById('retry-sync-btn')?.addEventListener('click', () => location.reload());
            }
        } else {
            // UNIVERSAL LOADING STATE (Prevents Blank Screen)
            const summaryEl = document.getElementById('summary-sheet-content');
            if (summaryEl && (!summaryEl.innerHTML || summaryEl.innerHTML.includes('spin'))) {
                summaryEl.innerHTML = `
                    <div style="padding: 60px; text-align: center;">
                        <div style="width: 50px; height: 50px; border: 3px solid var(--accent); border-top-color: transparent; border-radius: 50%; margin: 0 auto 20px; animation: spin 1s linear infinite;"></div>
                        <h3 style="font-size: 20px; font-weight: 800; letter-spacing: 0.1em; color: var(--accent); margin-bottom:10px;">PROCESSING INTELLIGENCE</h3>
                        <p style="opacity:0.6; font-size:14px;">Status: <span style="text-transform:uppercase; font-weight:900;">${lectureData.status}</span>. Please wait a moment.</p>
                    </div>
                    <style>@keyframes spin { to { transform: rotate(360deg); } }</style>
                `;
            }
            refreshAttempts++;
            setTimeout(refreshData, 3000);
        }

        const blocks = await getTranscriptBlocks(lectureId);
        if (blocks && blocks.length && fullTranscriptEl) {
            renderFullTranscript(blocks, lectureId);
        }
    }

    function renderFullTranscript(blocks, lid) {
        if (!fullTranscriptEl) return;
        fullTranscriptEl.innerHTML = blocks.map(b => `
            <div class="transcript-block" data-chunk="${b.chunkId}" style="margin-bottom:2rem; position:relative; padding-right:40px; group">
                <span class="playback-btn" style="position:absolute; right:0; top:5px; cursor:pointer; opacity:0.3; transition:opacity 0.2s;" title="Play Source Audio">🔊</span>
                <span class="block-text">${b.text}</span>
            </div>
        `).join('');

        fullTranscriptEl.querySelectorAll('.playback-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const chunkId = parseInt(btn.parentElement.getAttribute('data-chunk'));
                const player = document.getElementById('alignment-player');
                
                // Visual feedback
                btn.textContent = '⌛';
                const audioBase64 = await getAudioChunk(lid, chunkId);
                
                if (audioBase64) {
                    player.src = audioBase64;
                    player.play();
                    btn.textContent = '🔊';
                    btn.style.opacity = '1';
                    
                    // Highlight block while playing
                    btn.parentElement.style.background = 'rgba(99,102,241,0.05)';
                    player.onended = () => {
                        btn.parentElement.style.background = 'none';
                        btn.style.opacity = '0.3';
                    };
                } else {
                    btn.textContent = '❌';
                    setTimeout(() => btn.textContent = '🔊', 2000);
                }
            });
        });
    }

    function renderSuite(data) {
        // --- DYNAMIC FEATURE FILTERING BY MODE AND EXAM ---
        const mode = data.mode || 'general';
        const region = data.region || 'GLOBAL';
        console.log(`[Transcript] Mode: ${mode}, Region: ${region}. Filtering features...`);
        
        // Find the specific features for this exam from the regional config
        const exams = getExamsForCountry(region);
        const selectedExam = exams.find(e => e.id === mode) || exams[0];
        const enabledFeatures = selectedExam.features || ['summary-sheet', 'suggestions', 'verbatim-transcript'];

        const tabs = document.querySelectorAll('.nav-tab');
        tabs.forEach(tab => {
            const target = tab.getAttribute('data-target');
            if (enabledFeatures.includes(target)) {
                tab.style.display = 'block';
            } else {
                tab.style.display = 'none';
            }
        });

        try {
            const summaryEl = document.getElementById('summary-sheet-content');
            const summaryText = data.summary_sheet || data.synthesis || data.summary;
            
            if (summaryEl && summaryText) {
                summaryEl.innerHTML = `
                    <div class="summary-sheet-pro" style="font-size: 1.15rem; line-height: 1.8; color: var(--text); padding: 10px;">
                        ${formatMarkdown(summaryText)}
                    </div>
                `;
            } else if (summaryEl) {
                console.warn("[Transcript] No summary found in data object.");
                summaryEl.innerHTML = `<div style="padding: 20px; color: var(--muted); text-align: center;">Synthesis data is incomplete or corrupted.</div>`;
            }
            
            if (data.mindmap_data) {
                renderMindmap(document.getElementById('mindmap-svg'), data.mindmap_data);
            }
            
            const analysisEl = document.getElementById('critical-analysis');
            if (analysisEl && data.analysis) analysisEl.innerHTML = formatMarkdown(data.analysis);

            const historyEl = document.getElementById('history-content');
            if (historyEl && data.history) historyEl.innerHTML = formatMarkdown(data.history);

            const suggestionEl = document.getElementById('suggestions-content');
            if (suggestionEl && data.suggestions) {
                suggestionEl.innerHTML = data.suggestions.map(s => `
                    <div style="background:rgba(99,102,241,0.05); border-left:4px solid var(--accent); padding:20px; margin-bottom:15px; border-radius:0 12px 12px 0;">
                        <span style="font-size:11px; font-weight:900; color:var(--accent); display:block; margin-bottom:5px; text-transform:uppercase;">Recommendation</span>
                        <div style="font-size:14px; line-height:1.6;">${s}</div>
                    </div>
                `).join('');
            }

            const glossaryList = document.getElementById('glossary-list');
            if (glossaryList && data.glossary) {
                glossaryList.innerHTML = data.glossary.map(g => `
                    <div style="margin-bottom:15px; border-bottom:1px solid var(--border); padding-bottom:10px;">
                        <strong style="color:var(--accent);">${g.term}</strong>: ${g.meaning}
                    </div>
                `).join('');
            }

            const quizList = document.getElementById('quiz-list');
            if (quizList && data.mcqs) {
                quizList.innerHTML = '';
                data.mcqs.forEach((mcq, idx) => {
                    const div = document.createElement('div');
                    div.innerHTML = `
                        <div style="font-weight:700; margin-bottom:1rem; font-size:1.1rem;">${idx+1}. ${mcq.question}</div>
                        <div style="display:grid; gap:12px;">
                            ${mcq.options.map((opt, i) => `<div class="quiz-opt" data-idx="${i}" style="padding:15px; border:1px solid var(--border); border-radius:8px; cursor:pointer; background: var(--bg); color: var(--text); transition:all 0.2s;">${opt}</div>`).join('')}
                        </div>
                        <div class="mcq-explanation" style="display:none; margin-top:15px; padding:15px; background:rgba(99,102,241,0.1); border-radius:8px; font-size:13px; line-height:1.6; border-left:4px solid var(--accent);">
                            <strong style="display:block; margin-bottom:5px; color:var(--accent);">ANALYSIS</strong>
                            ${mcq.explanation || "No explanation provided."}
                        </div>
                    `;
                    div.querySelectorAll('.quiz-opt').forEach(opt => {
                        opt.addEventListener('click', () => {
                            const isCorrect = (opt.textContent.trim() === mcq.answer.trim() || opt.getAttribute('data-idx') == mcq.answer);
                            if (isCorrect) {
                                opt.style.borderColor = '#10b981'; opt.style.background = 'rgba(16, 185, 129, 0.1)';
                            } else {
                                opt.style.borderColor = '#ef4444'; opt.style.background = 'rgba(239, 68, 68, 0.1)';
                            }
                            const expl = div.querySelector('.mcq-explanation');
                            if (expl) expl.style.display = 'block';
                        });
                    });
                    quizList.appendChild(div);
                });
            }
        } catch (e) {
            console.error("[Transcript] renderSuite failed:", e);
        }
    }

    function formatMarkdown(text) {
        if (!text) return "";
        // 1. Basic Headers
        let html = text
            .replace(/^# (.*)/gm, '<h3 style="margin-top:2em; color:var(--accent); font-weight:900;">$1</h3>')
            .replace(/^## (.*)/gm, '<h4 style="margin-top:1.5em; font-weight:800; border-bottom:1px solid var(--border); padding-bottom:10px;">$1</h4>')
            .replace(/^### (.*)/gm, '<h5 style="margin-top:1.2em; font-weight:700;">$1</h5>');
            
        // 2. Bold/Italic
        html = html
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>');
            
        // 3. Paragraphs (Split by double newline and wrap in <p>)
        const paragraphs = html.split(/\n\n+/);
        html = paragraphs
            .map(p => {
                if (p.trim().startsWith('<h')) return p; // Don't wrap headers
                return `<p style="margin-bottom:1.5em; opacity:0.9;">${p.trim()}</p>`;
            })
            .join('');
            
        // 4. Line breaks
        html = html.replace(/\n/g, '<br>');
        
        return html;
    }

    // --- EXPORT LOGIC ---
    document.getElementById('export-md')?.addEventListener('click', () => { window.print(); });

    document.getElementById('export-notion')?.addEventListener('click', () => {
        const title = document.querySelector('.lecture-title')?.textContent || "Note";
        const summary = document.getElementById('summary-sheet-content')?.textContent || "";
        const text = `# ${title}\n\n${summary}`;
        navigator.clipboard.writeText(text).then(() => {
            alert("Notes copied to clipboard! You can now paste them into Notion.");
        });
    });

    document.getElementById('export-anki')?.addEventListener('click', () => {
        if (lectureData && lectureData.mcqs) {
            downloadAnkiDeck(lectureData.mcqs, lectureData.title);
        } else {
            alert("No MCQs available to export yet. Wait for synthesis to complete.");
        }
    });

    document.getElementById('export-notebook')?.addEventListener('click', () => {
        const transcript = document.getElementById('full-transcript-content')?.textContent || "";
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
