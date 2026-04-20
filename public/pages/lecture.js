// pages/lecture.js
import { getLecture, getChunk } from '../lib/db.js';

document.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const lectureId = parseInt(urlParams.get('id'));

    if (!lectureId) {
        alert('No lecture ID provided.');
        window.location.href = 'library.html';
        return;
    }

    // Tab Switching Logic
    const tabs = document.querySelectorAll('.tab');
    const contents = document.querySelectorAll('.tab-content');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.getAttribute('data-tab');
            
            tabs.forEach(t => t.classList.remove('active'));
            contents.forEach(c => c.classList.remove('active'));
            
            tab.classList.add('active');
            document.getElementById(target).classList.add('active');
        });
    });

    // Load Data
    try {
        const lecture = await getLecture(lectureId);
        if (!lecture) throw new Error('Lecture not found');

        // Update Header
        document.getElementById('lecture-title-display').textContent = lecture.title || `Lecture #${lectureId}`;
        document.getElementById('lecture-meta').textContent = `${new Date(lecture.createdAt).toLocaleDateString()} • ${lecture.mode.toUpperCase()}${lecture.exam ? ' • ' + lecture.exam : ''}`;

        // Show/Hide Exam Tabs
        if (lecture.mode === 'exam') {
            document.getElementById('tab-flashcards').style.display = '';
            document.getElementById('tab-mcqs').style.display = '';
        }

        // Render Tags
        const tagContainer = document.getElementById('tag-display');
        if (lecture.tags) {
            const allTags = [
                ...(lecture.tags.subjects || []),
                ...(lecture.tags.topics || []),
                ...(lecture.tags.entities || []),
                lecture.tags.difficulty
            ].filter(Boolean);

            allTags.forEach(tag => {
                const span = document.createElement('span');
                span.className = 'tag';
                span.textContent = tag;
                tagContainer.appendChild(span);
            });
        }

        // Fetch Knowledge and Output from DB (Assumes these are stored in respective stores)
        // For simplicity, we'll check if they are part of the lecture object or separate
        // Based on lib/db.js, they are in 'output' and 'knowledge' stores.
        
        // Mocking content for now until DB fetching is fully wired for generation
        document.getElementById('notes-content').innerHTML = lecture.notes || "<p>Notes will appear here after generation.</p>";
        document.getElementById('glossary-content').innerHTML = lecture.glossary || "<p>Glossary will appear here after generation.</p>";
        document.getElementById('mcqs-content').innerHTML = lecture.mcqs || "<p>MCQs will appear here after generation.</p>";
        
        // Load Transcript
        // This usually requires fetching all chunks for the lecture
        document.getElementById('transcript-content').textContent = "Transcript loading logic goes here...";

    } catch (error) {
        console.error('Error loading lecture:', error);
        document.getElementById('notes-content').textContent = "Error loading lecture details.";
    }
});
