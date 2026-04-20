// pages/library.js
import { openDB } from '../lib/db.js';

const PHILOSOPHY_QUOTES = {
    'Polity': [
        { text: "Man is by nature a political animal.", author: "Aristotle" },
        { text: "Justice is the first virtue of social institutions.", author: "John Rawls" }
    ],
    'Economy': [
        { text: "The real price of everything is the toil and trouble of acquiring it.", author: "Adam Smith" },
        { text: "In the long run, we are all dead.", author: "John Maynard Keynes" }
    ],
    'History': [
        { text: "Those who cannot remember the past are condemned to repeat it.", author: "George Santayana" },
        { text: "History is a gallery of pictures in which there are few originals and many copies.", author: "Alexis de Tocqueville" }
    ],
    'Geography': [
        { text: "Everything is related to everything else, but near things are more related than distant things.", author: "Waldo Tobler" },
        { text: "The study of geography is more than just memorizing places on a map.", author: "Barack Obama" }
    ],
    'General': [
        { text: "The only true wisdom is in knowing you know nothing.", author: "Socrates" },
        { text: "Knowledge is power.", author: "Francis Bacon" }
    ]
};

document.addEventListener('DOMContentLoaded', async () => {
    const libraryGrid = document.getElementById('library-grid');
    const noLectures = document.getElementById('no-lectures');
    const searchInput = document.getElementById('search-input');
    const filterSubject = document.getElementById('filter-subject');

    let allLectures = [];
    let currentUser = JSON.parse(localStorage.getItem('userProfile') || '{"displayName": "Scholar"}');

    async function loadLibrary() {
        try {
            const db = await openDB();
            const tx = db.transaction('lectures', 'readonly');
            const store = tx.objectStore('lectures');
            
            // Handle request manually since it's an IDBRequest
            const request = store.getAll();
            request.onsuccess = () => {
                allLectures = request.result.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
                renderLibrary(allLectures);
            };
        } catch (err) {
            console.error("Library Load Error:", err);
        }
    }

    function getQuote(subject) {
        const quotes = PHILOSOPHY_QUOTES[subject] || PHILOSOPHY_QUOTES['General'];
        return quotes[Math.floor(Math.random() * quotes.length)];
    }

    function renderLibrary(lectures) {
        libraryGrid.innerHTML = '';
        if (lectures.length === 0) {
            libraryGrid.style.display = 'none';
            noLectures.style.display = 'block';
            return;
        }

        libraryGrid.style.display = 'grid';
        noLectures.style.display = 'none';

        lectures.forEach(lecture => {
            const card = document.createElement('a');
            card.href = `lecture.html?id=${lecture.id}`;
            card.className = 'lecture-card';
            
            const subject = (lecture.tags?.subjects && lecture.tags.subjects[0]) || 'General';
            const quote = getQuote(subject);
            const dateStr = new Date(lecture.createdAt).toLocaleDateString('en-IN', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });

            card.innerHTML = `
                <div class="card-tag">${subject.toUpperCase()} • ${lecture.mode?.toUpperCase() || 'GENERAL'}</div>
                <h3 class="card-title">${lecture.title || 'Untitled Archive'}</h3>
                <div class="card-meta">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                    ${dateStr}
                </div>
                <p style="font-size: 12px; color: var(--text-muted); line-height: 1.4; margin: 0; border-left: 2px solid var(--border); padding-left: 12px;">
                    "${quote.text}" <br>— <span style="font-weight: 700; opacity: 0.8;">${quote.author}</span>
                </p>
                <div class="card-footer">
                    Carefully drafted for ${currentUser.displayName} ❤️
                </div>
            `;
            libraryGrid.appendChild(card);
        });
    }

    function handleFilters() {
        const query = searchInput.value.toLowerCase();
        const subject = filterSubject.value;

        const filtered = allLectures.filter(l => {
            const matchesQuery = (l.title || '').toLowerCase().includes(query) || 
                                 (l.tags?.topics || []).some(t => t.toLowerCase().includes(query));
            const matchesSubject = !subject || (l.tags?.subjects || []).includes(subject);
            return matchesQuery && matchesSubject;
        });

        renderLibrary(filtered);
    }

    searchInput.addEventListener('input', handleFilters);
    filterSubject.addEventListener('change', handleFilters);

    loadLibrary();
});
