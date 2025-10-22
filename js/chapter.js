document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const testament = urlParams.get('testament');
    const book = urlParams.get('book');

    const bookTitle = document.getElementById('book-title');
    const chapterList = document.getElementById('chapter-list');

    if (testament && book) {
        bookTitle.textContent = `${testament} · ${book}`;
    } else {
        bookTitle.textContent = '加载中...';
        console.error('Missing testament or book parameter');
        return;
    }

    fetch('bible-data.json')
        .then(response => response.json())
        .then(data => {
            if (data && data[testament] && data[testament][book]) {
                const chapters = Object.keys(data[testament][book]);
                // 按数字排序章节
                chapters.sort((a, b) => parseInt(a) - parseInt(b));
                
                chapters.forEach(chapter => {
                    const chapterElement = document.createElement('a');
                    chapterElement.href = `verse.html?testament=${testament}&book=${book}&chapter=${chapter}`;
                    chapterElement.className = 'p-4 bg-white rounded-lg shadow-md text-center hover:bg-gray-200';
                    chapterElement.textContent = `第${chapter}章`;
                    chapterList.appendChild(chapterElement);
                });
            } else {
                console.error('Invalid data structure or missing book data');
                bookTitle.textContent = '数据加载失败';
            }
        })
        .catch(error => {
            console.error('Error loading chapter data:', error);
            bookTitle.textContent = '数据加载失败';
        });
});