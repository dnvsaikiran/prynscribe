/**
 * PrynScribe Export Utilities
 * Handles conversion of AI artifacts to various study formats.
 */

/**
 * Generates and triggers a download for an Anki-compatible TSV file.
 * @param {Array} flashcards - Array of {q, a} or {question, answer} objects.
 * @param {string} lectureTitle - Title of the lecture for the filename.
 */
export function downloadAnkiDeck(flashcards, lectureTitle = 'PrynScribe_Deck') {
    if (!flashcards || !Array.isArray(flashcards) || flashcards.length === 0) {
        console.warn("No valid flashcards found to export.");
        return;
    }

    // TSV Format: Question <TAB> Answer
    // We escape tabs and newlines to preserve Anki's delicate import structure
    const tsvLines = flashcards.map(card => {
        let q = (card.question || card.q || '').trim();
        let a = (card.answer || card.a || card.explanation || '').trim();
        
        // Convert internal newlines to HTML breaks for Anki cards
        q = q.replace(/\t/g, ' ').replace(/\n/g, '<br>');
        a = a.replace(/\t/g, ' ').replace(/\n/g, '<br>');
        
        return `${q}\t${a}`;
    });

    const tsvContent = tsvLines.join('\r\n');
    const blob = new Blob([tsvContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    
    // Create hidden download link
    const link = document.createElement('a');
    link.style.display = 'none';
    link.href = url;
    link.download = `${lectureTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_anki_deck.txt`;
    
    document.body.appendChild(link);
    link.click();
    
    // Cleanup
    setTimeout(() => {
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
    }, 100);
}
