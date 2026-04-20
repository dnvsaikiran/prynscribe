// pages/library.js
import { openDB } from '../lib/db.js';

const EXAM_SUBJECTS = {
    'UPSC': ['Polity', 'Economy', 'History', 'Geography', 'Ethics', 'IR', 'Current Affairs'],
    'JEE': ['Physics', 'Chemistry', 'Mathematics'],
    'NEET': ['Biology', 'Physics', 'Chemistry'],
    'CA': ['Financial Reporting', 'Law', 'Taxation', 'Audit', 'Costing'],
    'MBA': ['Marketing', 'Finance', 'Strategy', 'Economics', 'Management', 'Soft Skills'],
    'SSC': ['Quantitative Aptitude', 'Reasoning', 'English', 'General Awareness'],
    'OTHER': ['General', 'Philosophy', 'Research']
};

const PHILOSOPHY_QUOTES = {
    'Polity': [
        { text: "Man is by nature a political animal.", author: "Aristotle" },
        { text: "The end of law is not to abolish or restrain, but to preserve and enlarge freedom.", author: "John Locke" }
    ],
    'Economy': [
        { text: "The real price of everything is the toil and trouble of acquiring it.", author: "Adam Smith" },
        { text: "The difficulty lies not so much in developing new ideas as in escaping from old ones.", author: "John Maynard Keynes" }
    ],
    'History': [
        { text: "Those who cannot remember the past are condemned to repeat it.", author: "George Santayana" },
        { text: "History is a set of lies agreed upon.", author: "Napoleon Bonaparte" }
    ],
    'Geography': [
        { text: "Everything is related to everything else, but near things are more related than distant things.", author: "Waldo Tobler" },
        { text: "The study of geography is more than just memorizing places on a map.", author: "Barack Obama" }
    ],
    'Philosophy': [
        { text: "The unexamined life is not worth living.", author: "Socrates" },
        { text: "I think, therefore I am.", author: "René Descartes" }
    ],
    'General': [
        { text: "Knowledge is power.", author: "Francis Bacon" },
        { text: "Education is the most powerful weapon.", author: "Nelson Mandela" }
    ],
    'Physics': [{ text: "Look deep into nature, and then you will understand everything better.", author: "Albert Einstein" }],
    'Chemistry': [{ text: "The meeting of two personalities is like the contact of two chemical substances.", author: "C.G. Jung" }],
    'Biology': [{ text: "Biology is the most powerful technology ever created.", author: "Ray Kurzweil" }],
    'Law': [{ text: "The law is reason free from passion.", author: "Aristotle" }],
    'Marketing': [{ text: "Great marketing makes the customer feel smart.", author: "Joe Chernov" }],
    'Finance': [{ text: "Price is what you pay. Value is what you get.", author: "Warren Buffett" }],
    'Strategy': [{ text: "The essence of strategy is choosing what not to do.", author: "Michael Porter" }],
    'Management': [{ text: "Management is doing things right; leadership is doing the right things.", author: "Peter Drucker" }],
    'Soft Skills': [{ text: "People will never forget how you made them feel.", author: "Maya Angelou" }],
    'Economics': [{ text: "The dismal science is only dismal to those who don't understand it.", author: "Alfred Marshall" }]
};

document.addEventListener('DOMContentLoaded', async () => {
    const archiveGrid = document.getElementById('archive-grid');
    const emptyState = document.getElementById('empty-state');
    const searchArchive = document.getElementById('search-archive');
    const filterSubject = document.getElementById('filter-subject');
    const userContextSubtitle = document.getElementById('user-context-subtitle');

    let allLectures = [];
    let currentUser = null;

    async function loadUserProfile() {
        return new Promise((resolve) => {
            chrome.storage.local.get(['userProfile'], (result) => {
                currentUser = result.userProfile || { displayName: 'Scholar', email: 'Guest' };
                if (userContextSubtitle) {
                    userContextSubtitle.textContent = `Welcome back, ${currentUser.displayName}. Browsing your intellectual archives...`;
                }

                // --- DYNAMIC SUBJECT INJECTION ---
                const exam = currentUser.exam_goal || 'UPSC'; // Default to UPSC
                const subjects = EXAM_SUBJECTS[exam] || EXAM_SUBJECTS['OTHER'];
                
                if (filterSubject) {
                    filterSubject.innerHTML = '<option value="">All Subjects</option>';
                    subjects.forEach(sub => {
                        const opt = document.createElement('option');
                        opt.value = sub;
                        opt.textContent = sub;
                        filterSubject.appendChild(opt);
                    });
                }

                resolve(currentUser);
            });
        });
    }

    async function loadLibrary() {
        try {
            const db = await openDB();
            const tx = db.transaction('lectures', 'readonly');
            const store = tx.objectStore('lectures');
            const request = store.getAll();

            request.onsuccess = () => {
                allLectures = request.result.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
                renderLibrary(allLectures);
            };
        } catch (e) {
            console.error("Failed to load library:", e);
            if (emptyState) {
                emptyState.style.display = 'block';
                emptyState.querySelector('.empty-text').textContent = "Vault synchronization failed.";
            }
        }
    }

    function getRandomQuote(subject) {
        const quotes = PHILOSOPHY_QUOTES[subject] || PHILOSOPHY_QUOTES['General'];
        return quotes[Math.floor(Math.random() * quotes.length)];
    }

    function renderLibrary(lectures) {
        if (!archiveGrid || !emptyState) return;
        
        archiveGrid.innerHTML = '';
        if (lectures.length === 0) {
            archiveGrid.style.display = 'none';
            emptyState.style.display = 'block';
            return;
        }

        archiveGrid.style.display = 'grid';
        emptyState.style.display = 'none';

        lectures.forEach(lecture => {
            const card = document.createElement('div');
            card.className = 'archive-card';
            
            const dateStr = new Date(lecture.createdAt || Date.now()).toLocaleDateString('en-US', { 
                weekday: 'short', month: 'short', day: 'numeric' 
            });
            const timeStr = new Date(lecture.createdAt || Date.now()).toLocaleTimeString('en-US', { 
                hour: '2-digit', minute: '2-digit' 
            });

            const subject = (lecture.tags?.subjects && lecture.tags.subjects[0]) || 'General';
            const quote = getRandomQuote(subject);
            
            card.innerHTML = `
                <div class="card-status">${(lecture.status || 'Archived').toUpperCase()}</div>
                <div class="card-title">${lecture.title || 'Untitled Session'}</div>
                
                <div class="card-meta">
                    <span>${dateStr}</span>
                    <span>${timeStr}</span>
                    <span>${(lecture.mode || 'exam').toUpperCase()}</span>
                </div>

                <div class="tag-cloud">
                    ${(lecture.tags?.subjects || []).map(t => `<span class="tag">${t}</span>`).join('')}
                    ${(lecture.tags?.topics || []).slice(0, 2).map(t => `<span class="tag">#${t}</span>`).join('')}
                </div>

                <div class="quote-box">
                    "${quote.text}"
                    <div style="font-size: 10px; margin-top: 4px; opacity: 0.6;">— ${quote.author}</div>
                </div>

                <div class="card-footer">
                    <div class="author-tag">Vault item for ${currentUser.displayName}</div>
                    <div style="display:flex; gap:10px;">
                        <button class="btn-open view-btn" data-id="${lecture.lectureId || lecture.id}">Open</button>
                        <button class="btn-open delete-btn" data-id="${lecture.lectureId || lecture.id}" style="background:transparent; border:1px solid #333; color:#ef4444;">Delete</button>
                    </div>
                </div>
            `;
            archiveGrid.appendChild(card);
        });

        // Event Listeners for Dynamic Buttons
        archiveGrid.querySelectorAll('.view-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-id');
                window.location.href = `transcript.html?id=${id}`;
            });
        });

        archiveGrid.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (confirm("Permanently remove this archive from your local vault?")) {
                    const id = btn.getAttribute('data-id');
                    const db = await openDB();
                    const tx = db.transaction('lectures', 'readwrite');
                    tx.objectStore('lectures').delete(id.toString());
                    tx.oncomplete = () => loadLibrary();
                }
            });
        });
    }

    function handleFilters() {
        const query = searchArchive?.value.toLowerCase() || "";
        const subject = filterSubject?.value || "";

        const filtered = allLectures.filter(l => {
            const matchesQuery = (l.title || '').toLowerCase().includes(query) || 
                                 (l.tags?.topics || []).some(t => t.toLowerCase().includes(query));
            const matchesSubject = !subject || (l.tags?.subjects || []).includes(subject);
            return matchesQuery && matchesSubject;
        });

        renderLibrary(filtered);
    }

    searchArchive?.addEventListener('input', handleFilters);
    filterSubject?.addEventListener('change', handleFilters);

    await loadUserProfile();
    loadLibrary();
});
