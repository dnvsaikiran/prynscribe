// pages/library.js
import { openDB } from '../lib/db.js';

document.addEventListener('DOMContentLoaded', async () => {
    const libraryGrid = document.getElementById('library-grid');
    const noLectures = document.getElementById('no-lectures');
    const searchInput = document.getElementById('search-input');
    const filterSubject = document.getElementById('filter-subject');
    const filterMode = document.getElementById('filter-mode');

    let allLectures = [];

    async function loadLibrary() {
        const db = await openDB();
        const tx = db.transaction('lectures', 'readonly');
        const store = tx.objectStore('lectures');
        const request = store.getAll();

        request.onsuccess = () => {
            allLectures = request.result.sort((a, b) => b.createdAt - a.createdAt);
            renderLibrary(allLectures);
        };
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
            const card = document.createElement('div');
            card.className = 'lecture-card';
            
            const statusClass = (lecture.status === 'complete' || lecture.status === 'finalized') ? 'complete' : 'incomplete';
            
            card.innerHTML = `
                <div class="status-badge ${statusClass}">${lecture.status || 'unknown'}</div>
                <div class="card-title">${lecture.title || `Lecture #${lecture.id}`}</div>
                <div class="card-meta">
                    ${new Date(lecture.createdAt).toLocaleDateString()}<br>
                    ${lecture.mode.toUpperCase()} ${lecture.exam ? '• ' + lecture.exam : ''}
                </div>
                <div class="tag-container" style="margin: 0.5rem 0;">
                    ${(lecture.tags?.subjects || []).slice(0, 2).map(t => `<span class="tag" style="margin:2px;">${t}</span>`).join('')}
                </div>
                <div class="card-actions">
                    <button class="open-btn" data-id="${lecture.id}">Open</button>
                    ${lecture.status !== 'complete' ? `<button class="resume-btn" data-id="${lecture.id}" style="background: var(--bg-primary);">Resume</button>` : ''}
                    <button class="delete-btn" data-id="${lecture.id}" style="background: #ef444433; color: #ef4444; border-color: #ef444433;">Delete</button>
                </div>
            `;
            libraryGrid.appendChild(card);
        });

        // Event Listeners for Buttons
        document.querySelectorAll('.open-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                window.location.href = `lecture.html?id=${btn.dataset.id}`;
            });
        });

        // Additional listeners for resume/delete would go here
    }

    // Basic Search/Filter Logic
    function handleFilters() {
        const query = searchInput.value.toLowerCase();
        const subject = filterSubject.value;
        const mode = filterMode.value;

        const filtered = allLectures.filter(l => {
            const matchesQuery = (l.title || '').toLowerCase().includes(query) || 
                                 (l.tags?.topics || []).some(t => t.toLowerCase().includes(query));
            const matchesSubject = !subject || (l.tags?.subjects || []).includes(subject);
            const matchesMode = !mode || l.mode === mode;
            return matchesQuery && matchesSubject && matchesMode;
        });

        renderLibrary(filtered);
    }

    searchInput.addEventListener('input', handleFilters);
    filterSubject.addEventListener('change', handleFilters);
    filterMode.addEventListener('change', handleFilters);

    loadLibrary();
});
