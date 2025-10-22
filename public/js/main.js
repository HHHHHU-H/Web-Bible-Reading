document.addEventListener('DOMContentLoaded', () => {
    const oldTestamentContainer = document.getElementById('old-testament');
    const newTestamentContainer = document.getElementById('new-testament');

    fetch('bible-data.json')
        .then(response => response.json())
        .then(data => {
            const oldTestamentBooks = Object.keys(data['旧约']);
            const newTestamentBooks = Object.keys(data['新约']);

            populateBookList(oldTestamentContainer, oldTestamentBooks, '旧约', data);
            populateBookList(newTestamentContainer, newTestamentBooks, '新约', data);
        })
        .catch(error => console.error('Error loading Bible data:', error));
});

function populateBookList(container, books, testament, data) {
    books.forEach(book => {
        const chapterCount = Object.keys(data[testament][book]).length;
        const bookElement = document.createElement('a');
        bookElement.href = `chapter.html?testament=${testament}&book=${book}`;
        bookElement.className = 'p-4 bg-white rounded-lg shadow-md text-center hover:bg-gray-200';
        bookElement.innerHTML = `<span class="font-semibold">${book}</span><br><span class="text-sm text-gray-600">(${chapterCount}章)</span>`;
        container.appendChild(bookElement);
    });
}