// Global variables
let currentBook = '';
let currentChapter = 1;
let currentTestament = '';
let bibleData = {};
let currentVoice = null;
let isPlaying = false;
let isPaused = false;
let currentUtterance = null;
let playbackMode = 'chapter'; // 'chapter' or 'verse'
let selectedVerses = new Set();
let currentVerseIndex = 0;
let totalVerses = 0;
// Track current playing verse and switching state to avoid stale onend clearing highlight
let currentPlayingVerse = null;
let isSwitchingVerse = false;
// 最新点击播放请求的令牌，用于丢弃过期的并发点击
let latestPlayRequestId = 0;

// 添加随机播放相关的全局状态跟踪变量
let isRandomPlayback = false;
let randomVersePool = [];
let currentRandomVersePlayCount = 0; // 当前随机经节的播放次数
let currentRandomVerse = null; // 当前正在播放的随机经节
let randomPlaybackCount = 0;
let targetRandomPlaybackCount = 0;

// 添加经节循环计数器
let verseLoopCounter = 0;

// 添加章节循环计数器
let chapterLoopCounter = 0;

// 添加章节默认设置跟踪变量
let currentChapterKey = '';
let hasOpenedDetailedSettingsInCurrentChapter = false;

// 协调语音合成引擎的辅助方法：等待引擎空闲，避免新朗读排队或被旧朗读阻塞
function isSpeechIdle() {
    return !speechSynthesis.speaking && !speechSynthesis.pending;
}

async function waitForSpeechIdle(timeout = 1200) {
    const start = Date.now();
    return new Promise(resolve => {
        const check = () => {
            if (isSpeechIdle()) {
                resolve(true);
            } else if (Date.now() - start >= timeout) {
                // 超时也继续后续逻辑，避免因为某些浏览器状态卡住
                resolve(false);
            } else {
                setTimeout(check, 40);
            }
        };
        check();
    });
}

// 强制停止语音：持续调用 cancel 直到空闲或超时
async function forceStopSpeech(timeout = 1000) {
    const start = Date.now();
    speechSynthesis.cancel();
    while (!isSpeechIdle() && Date.now() - start < timeout) {
        await new Promise(r => setTimeout(r, 50));
        speechSynthesis.cancel();
    }
}

// Settings
let settings = {
    volume: 1.0,
    rate: 1.2,
    voice: null,
    displayMode: 'chinese', // 'chinese', 'english', 'bilingual'
    chapterEndAction: 'next', // 'next', 'loop', 'random'
    verseLoopCount: 1,
    infiniteLoop: false,
    versePlaybackMode: 'single-loop', // 'single-loop', 'chapter-random'
    customLoopCount: 1
};

// Verse playlist for verse mode
let versePlaylist = [];
let currentPlaylistIndex = 0;

// Initialize the page
document.addEventListener('DOMContentLoaded', function() {
    loadBibleData();
    setupEventListeners();
    setupVoices();
    loadSettings();

    // 初始化播放模式按钮文字为当前模式
    const currentModeTextEl = document.getElementById('current-mode-text');
    if (currentModeTextEl) {
        const modeLabelMap = {
            'chapter': '章节朗读',
            'verse': '经节朗读',
            'playlist': '自定义列表'
        };
        currentModeTextEl.textContent = modeLabelMap[playbackMode] || '章节朗读';
    }
});

// Load Bible data
async function loadBibleData() {
    try {
        const response = await fetch('bible-data.json');
        bibleData = await response.json();
        
        // Get URL parameters
        const urlParams = new URLSearchParams(window.location.search);
        currentBook = urlParams.get('book');
        currentChapter = parseInt(urlParams.get('chapter')) || 1;
        
        // Determine testament based on actual data structure
        if (currentBook && bibleData) {
            if (bibleData['旧约'] && bibleData['旧约'][currentBook]) {
                currentTestament = '旧约';
            } else if (bibleData['新约'] && bibleData['新约'][currentBook]) {
                currentTestament = '新约';
            }
        }
        
        if (currentBook && currentTestament) {
            displayChapter();
            updateBackToChapterLink();
        }
    } catch (error) {
        console.error('Error loading Bible data:', error);
    }
}

// Display chapter content
function displayChapter() {
    if (!bibleData || !currentTestament || !currentBook || !currentChapter) return;
    
    const bookData = bibleData[currentTestament][currentBook];
    if (!bookData || !bookData[currentChapter]) return;
    
    // 检查是否切换了章节，如果是则重置详细设置状态
    const newChapterKey = `${currentTestament}-${currentBook}-${currentChapter}`;
    if (currentChapterKey !== newChapterKey) {
        currentChapterKey = newChapterKey;
        hasOpenedDetailedSettingsInCurrentChapter = false;
    }
    
    // Update chapter title
    const chapterTitle = document.getElementById('chapter-title');
    if (chapterTitle) {
        if (playbackMode === 'playlist') {
            chapterTitle.textContent = '经节列表播放';
        } else {
            chapterTitle.textContent = `${currentBook} 第${currentChapter}章`;
        }
    }
    
    // Load verses
    loadChapterVerses();
}

// Load chapter verses
function loadChapterVerses() {
    if (!bibleData || !currentTestament || !currentBook || !currentChapter) return;
    
    const verses = bibleData[currentTestament][currentBook][currentChapter];
    const verseList = document.getElementById('verse-list');
    
    if (!verses || !verseList) return;
    
    verseList.innerHTML = '';
    
    Object.keys(verses).forEach(verseNumber => {
        const verseCard = document.createElement('div');
        verseCard.className = 'verse-card p-4 bg-white rounded-lg shadow-md cursor-pointer hover:bg-gray-50 transition-colors border-l-4 border-transparent';
        verseCard.dataset.verse = verseNumber;
        
        let verseText = '';
        const verseData = verses[verseNumber];
        
        // Handle display mode based on actual data structure
        if (settings.displayMode === 'chinese') {
            verseText = verseData.chinese || verseData;
        } else if (settings.displayMode === 'english') {
            verseText = verseData.english || verseData.chinese || verseData;
        } else if (settings.displayMode === 'bilingual') {
            const chineseText = verseData.chinese || verseData;
            const englishText = verseData.english || '';
            verseText = englishText ? `${chineseText}<br><span class="text-gray-600 text-sm">${englishText}</span>` : chineseText;
        }
        
        verseCard.innerHTML = `
            <div class="flex items-start">
                <span class="verse-number text-sm font-bold text-blue-600 mr-3 mt-1 min-w-[2rem]">${verseNumber}</span>
                <span class="verse-text flex-1">${verseText}</span>
            </div>
        `;
        
        verseCard.addEventListener('click', () => handleVerseClick(verseNumber, verseCard));
        verseList.appendChild(verseCard);
    });
    
    // Restore highlight if playback is active
    restorePlayingHighlight();
}

// Update back to chapter link
function updateBackToChapterLink() {
    const backLink = document.getElementById('back-to-chapter');
    if (backLink && currentBook && currentTestament) {
        backLink.href = `chapter.html?testament=${encodeURIComponent(currentTestament)}&book=${encodeURIComponent(currentBook)}`;
    }
}

// Setup event listeners
function setupEventListeners() {
    // Settings toggle
    const settingsToggle = document.getElementById('settings-toggle');
    if (settingsToggle) {
        settingsToggle.addEventListener('click', function() {
            const dropdown = document.getElementById('settings-dropdown');
            if (dropdown) {
                dropdown.classList.toggle('hidden');
            }
        });
    }

    // Close settings dropdown when clicking outside
    document.addEventListener('click', function(event) {
        const settingsToggle = document.getElementById('settings-toggle');
        const settingsDropdown = document.getElementById('settings-dropdown');
        
        if (settingsToggle && settingsDropdown && 
            !settingsToggle.contains(event.target) && !settingsDropdown.contains(event.target)) {
            settingsDropdown.classList.add('hidden');
        }
    });

    // Usage Instructions button
    const usageInstructionsBtn = document.getElementById('usage-instructions-btn');
    if (usageInstructionsBtn) {
        usageInstructionsBtn.addEventListener('click', function() {
            const modal = document.getElementById('usage-instructions-modal');
            if (modal) {
                modal.classList.remove('hidden');
            }
            // Close settings dropdown
            const settingsDropdown = document.getElementById('settings-dropdown');
            if (settingsDropdown) {
                settingsDropdown.classList.add('hidden');
            }
        });
    }

    // Close Usage Instructions modal
    const closeUsageModal = document.getElementById('close-usage-modal');
    if (closeUsageModal) {
        closeUsageModal.addEventListener('click', function() {
            const modal = document.getElementById('usage-instructions-modal');
            if (modal) {
                modal.classList.add('hidden');
            }
        });
    }

    // Close Usage Instructions modal when clicking outside
    const usageModal = document.getElementById('usage-instructions-modal');
    if (usageModal) {
        usageModal.addEventListener('click', function(event) {
            if (event.target === usageModal) {
                usageModal.classList.add('hidden');
            }
        });
    }

    // Display mode change
    const displayMode = document.getElementById('display-mode');
    if (displayMode) {
        displayMode.addEventListener('change', function() {
            settings.displayMode = this.value;
            loadChapterVerses(); // Refresh display
            updatePlaylistModeDisplay(); // 实时更新播放列表显示
            saveSettings();
        });
    }

    // Voice settings
    const voiceSelect = document.getElementById('voice-select');
    if (voiceSelect) {
        voiceSelect.addEventListener('change', function() {
            const voices = speechSynthesis.getVoices();
            const selectedVoice = voices[this.value];
            if (selectedVoice && isValidVoice(selectedVoice)) {
                settings.voice = selectedVoice;
                saveSettings();
            }
        });
    }

    const volumeSlider = document.getElementById('volume-slider');
    if (volumeSlider) {
        volumeSlider.addEventListener('input', function() {
            settings.volume = parseFloat(this.value);
            const volumeValue = document.getElementById('volume-value');
            if (volumeValue) {
                volumeValue.textContent = this.value;
            }
            saveSettings();
        });
    }

    const rateSlider = document.getElementById('rate-slider');
    if (rateSlider) {
        rateSlider.addEventListener('input', function() {
            settings.rate = parseFloat(this.value);
            const rateValue = document.getElementById('rate-value');
            if (rateValue) {
                rateValue.textContent = this.value;
            }
            saveSettings();
        });
    }

    // Playback mode toggle
    const playbackModeToggle = document.getElementById('playback-mode-toggle');
    if (playbackModeToggle) {
        playbackModeToggle.addEventListener('click', function() {
            const dropdown = document.getElementById('playback-mode-dropdown');
            if (dropdown) {
                dropdown.classList.toggle('hidden');
            }
        });
    }

    // Playback mode selection
    document.querySelectorAll('[data-mode]').forEach(button => {
        button.addEventListener('click', function() {
            playbackMode = this.dataset.mode;
            const currentModeText = document.getElementById('current-mode-text');
            if (currentModeText) {
                currentModeText.textContent = this.textContent;
            }
            const dropdown = document.getElementById('playback-mode-dropdown');
            if (dropdown) {
                dropdown.classList.add('hidden');
            }
            updateModeSettings();
        });
    });

    // Detailed settings
    const settingsBtn = document.getElementById('settings-btn');
    console.log('[初始化] 详细设置按钮:', settingsBtn);
    if (settingsBtn) {
        settingsBtn.addEventListener('click', function(event) {
            console.log('[详细设置] ========== 按钮被点击 ==========');
            console.log('[详细设置] Event:', event);
            console.log('[详细设置] 当前播放状态 - isPlaying:', isPlaying, 'currentPlayingVerse:', currentPlayingVerse);
            
            const modal = document.getElementById('detailed-settings-modal');
            if (modal) {
                console.log('[详细设置] 打开模态框');
                modal.classList.remove('hidden');
                updateModeSettings();
                
                // 如果是经节朗读模式且是当前章节第一次打开详细设置，应用默认设置
                if (playbackMode === 'verse' && !hasOpenedDetailedSettingsInCurrentChapter) {
                    applyDefaultVerseSettings();
                    hasOpenedDetailedSettingsInCurrentChapter = true;
                }
            }
            console.log('[详细设置] ========== 处理完成 ==========');
        });
        console.log('[初始化] 详细设置按钮事件监听器已添加');
    } else {
        console.error('[初始化] 找不到详细设置按钮！');
    }

    const closeModal = document.getElementById('close-modal');
    if (closeModal) {
        closeModal.addEventListener('click', function() {
            const modal = document.getElementById('detailed-settings-modal');
            if (modal) {
                modal.classList.add('hidden');
            }
        });
    }

    // Playback controls
    const playPause = document.getElementById('play-pause');
    if (playPause) {
        playPause.addEventListener('click', function() {
            if (isPlaying && !isPaused) {
                pausePlayback();
            } else if (isPaused) {
                resumePlayback();
            } else {
                startPlayback();
            }
        });
    }

    const prevChapter = document.getElementById('prev-chapter');
    if (prevChapter) {
        prevChapter.addEventListener('click', function() {
            navigateChapter(-1);
        });
    }

    const nextChapter = document.getElementById('next-chapter');
    if (nextChapter) {
        nextChapter.addEventListener('click', function() {
            navigateChapter(1);
        });
    }

    // Playlist management
    const addToPlaylist = document.getElementById('add-to-playlist');
    if (addToPlaylist) {
        addToPlaylist.addEventListener('click', function() {
            addSelectedVersesToPlaylist();
        });
    }

    // Verse List Playback button
    const verseListPlayback = document.getElementById('verse-list-playback');
    if (verseListPlayback) {
        verseListPlayback.addEventListener('click', function() {
            const modal = document.getElementById('verse-list-modal');
            if (modal) {
                modal.classList.remove('hidden');
                populateCurrentChapterVerses();
            }
        });
    }

    // Close verse list modal
    const closeVerseListModal = document.getElementById('close-verse-list-modal');
    if (closeVerseListModal) {
        closeVerseListModal.addEventListener('click', function() {
            const modal = document.getElementById('verse-list-modal');
            if (modal) {
                modal.classList.add('hidden');
            }
        });
    }

    const cancelVerseList = document.getElementById('cancel-verse-list');
    if (cancelVerseList) {
        cancelVerseList.addEventListener('click', function() {
            const modal = document.getElementById('verse-list-modal');
            if (modal) {
                modal.classList.add('hidden');
            }
        });
    }

    // Add other verses button
    const addOtherVerses = document.getElementById('add-other-verses');
    if (addOtherVerses) {
        addOtherVerses.addEventListener('click', function() {
            console.log('Add other verses button clicked'); // Debug log
            const bibleNavModal = document.getElementById('bible-navigation-modal');
            if (bibleNavModal) {
                console.log('Bible navigation modal found, showing...'); // Debug log
                bibleNavModal.classList.remove('hidden');
                bibleNavModal.style.zIndex = '9999'; // Force highest z-index
                initializeBibleNavigation();
            } else {
                console.log('Bible navigation modal not found'); // Debug log
            }
        });
    }

    // Bible navigation modal events
    const closeBibleNavigation = document.getElementById('close-bible-navigation');
    if (closeBibleNavigation) {
        closeBibleNavigation.addEventListener('click', function() {
            const modal = document.getElementById('bible-navigation-modal');
            if (modal) {
                modal.classList.add('hidden');
            }
        });
    }

    const cancelBibleNavigation = document.getElementById('cancel-bible-navigation');
    if (cancelBibleNavigation) {
        cancelBibleNavigation.addEventListener('click', function() {
            const modal = document.getElementById('bible-navigation-modal');
            if (modal) {
                modal.classList.add('hidden');
            }
        });
    }

    // Testament selection
    const oldTestamentBtn = document.getElementById('old-testament-btn');
    const newTestamentBtn = document.getElementById('new-testament-btn');
    
    if (oldTestamentBtn) {
        oldTestamentBtn.addEventListener('click', function() {
            selectTestament('旧约', this);
        });
    }
    
    if (newTestamentBtn) {
        newTestamentBtn.addEventListener('click', function() {
            selectTestament('新约', this);
        });
    }

    // Start playlist playback
    const startPlaylistPlayback = document.getElementById('start-playlist-playback');
    if (startPlaylistPlayback) {
        startPlaylistPlayback.addEventListener('click', function() {
            startVerseListPlayback();
        });
    }

    // Save settings button
    const saveSettings = document.getElementById('save-settings');
    if (saveSettings) {
        saveSettings.addEventListener('click', function() {
            saveDetailedSettings();
            const modal = document.getElementById('detailed-settings-modal');
            if (modal) {
                modal.classList.add('hidden');
            }
        });
    }

    // Cancel settings button
    const cancelSettings = document.getElementById('cancel-settings');
    if (cancelSettings) {
        cancelSettings.addEventListener('click', function() {
            const modal = document.getElementById('detailed-settings-modal');
            if (modal) {
                modal.classList.add('hidden');
            }
        });
    }

    // Loop count buttons
    const loopCountButtons = document.querySelectorAll('.loop-count-btn');
    loopCountButtons.forEach(button => {
        button.addEventListener('click', function() {
            const count = this.getAttribute('data-count');
            const customInput = document.getElementById('custom-count-input');
            
            // Remove active class from all buttons
            loopCountButtons.forEach(btn => {
                btn.classList.remove('active', 'bg-blue-500', 'text-white');
                btn.classList.add('bg-gray-200');
            });
            
            // Add active class to clicked button
            this.classList.add('active', 'bg-blue-500', 'text-white');
            this.classList.remove('bg-gray-200');
            
            if (count === 'custom') {
                customInput.classList.remove('hidden');
                settings.infiniteLoop = false;
            } else if (count === 'infinite') {
                customInput.classList.add('hidden');
                settings.infiniteLoop = true;
            } else {
                customInput.classList.add('hidden');
                settings.verseLoopCount = parseInt(count);
                settings.infiniteLoop = false;
            }
        });
    });

    // Custom loop count input
    const customLoopInput = document.getElementById('custom-loop-count');
    if (customLoopInput) {
        customLoopInput.addEventListener('input', function() {
            const value = parseInt(this.value) || 1;
            settings.customLoopCount = value;
            settings.verseLoopCount = value;
            settings.infiniteLoop = false;
        });
    }

    // Update loop count buttons UI
    function updateLoopCountButtons() {
        const loopCountButtons = document.querySelectorAll('.loop-count-btn');
        loopCountButtons.forEach(btn => {
            btn.classList.remove('active', 'bg-blue-500', 'text-white');
            btn.classList.add('bg-gray-200');
        });
        
        // Find and activate the appropriate button
        let targetBtn = null;
        if (settings.infiniteLoop) {
            targetBtn = document.querySelector('[data-count="infinite"]');
        } else if (settings.verseLoopCount === 1) {
            targetBtn = document.querySelector('[data-count="1"]');
        } else if (settings.verseLoopCount === 3) {
            targetBtn = document.querySelector('[data-count="3"]');
        } else if (settings.verseLoopCount === 5) {
            targetBtn = document.querySelector('[data-count="5"]');
        } else if (settings.verseLoopCount === 10) {
            targetBtn = document.querySelector('[data-count="10"]');
        } else {
            targetBtn = document.querySelector('[data-count="custom"]');
            const customInput = document.getElementById('custom-count-input');
            const customLoopInput = document.getElementById('custom-loop-count');
            if (customInput && customLoopInput) {
                customInput.classList.remove('hidden');
                customLoopInput.value = settings.verseLoopCount;
            }
        }
        
        if (targetBtn) {
            targetBtn.classList.add('active', 'bg-blue-500', 'text-white');
            targetBtn.classList.remove('bg-gray-200');
        }
    }

    // Verse playback mode radio buttons
    const versePlaybackModeRadios = document.querySelectorAll('input[name="verse-playback-mode"]');
    versePlaybackModeRadios.forEach(radio => {
        radio.addEventListener('change', function() {
            if (this.checked) {
                settings.versePlaybackMode = this.value;
                
                // 当切换到"当前章节随机播放"时，自动设置为1次并禁用无限循环
                if (this.value === 'chapter-random') {
                    // 设置循环次数为1次
                    settings.verseLoopCount = 1;
                    settings.infiniteLoop = false;
                    
                    // 更新UI显示
                    updateLoopCountButtons();
                    
                    // 禁用无限循环按钮
                    const infiniteLoopBtn = document.getElementById('infinite-loop-btn');
                    if (infiniteLoopBtn) {
                        infiniteLoopBtn.disabled = true;
                        infiniteLoopBtn.classList.add('opacity-50', 'cursor-not-allowed');
                        infiniteLoopBtn.classList.remove('hover:bg-gray-300');
                    }
                } else {
                    // 恢复无限循环按钮
                    const infiniteLoopBtn = document.getElementById('infinite-loop-btn');
                    if (infiniteLoopBtn) {
                        infiniteLoopBtn.disabled = false;
                        infiniteLoopBtn.classList.remove('opacity-50', 'cursor-not-allowed');
                        infiniteLoopBtn.classList.add('hover:bg-gray-300');
                    }
                }
            }
        });
    });

     // Confirm verse selection
     const confirmVerseSelection = document.getElementById('confirm-verse-selection');
     if (confirmVerseSelection) {
         confirmVerseSelection.addEventListener('click', function() {
             confirmNavigationVerseSelection();
         });
     }

     // Playlist mode buttons
     const currentChapterSelection = document.getElementById('current-chapter-selection');
     if (currentChapterSelection) {
         currentChapterSelection.addEventListener('click', function() {
             addCurrentChapterVersesToPlaylist();
         });
     }

     const addOtherVersesPlaylist = document.getElementById('add-other-verses-playlist');
     if (addOtherVersesPlaylist) {
         addOtherVersesPlaylist.addEventListener('click', function() {
             const bibleNavModal = document.getElementById('bible-navigation-modal');
             if (bibleNavModal) {
                 bibleNavModal.classList.remove('hidden');
                 bibleNavModal.style.zIndex = '9999';
                 initializeBibleNavigation();
             }
         });
     }

     const clearPlaylist = document.getElementById('clear-playlist');
     if (clearPlaylist) {
         clearPlaylist.addEventListener('click', function() {
             clearPlaylistMode();
         });
     }

     // Playlist settings buttons
     const playlistLoopButtons = document.querySelectorAll('.playlist-loop-btn');
     playlistLoopButtons.forEach(button => {
         button.addEventListener('click', function() {
             const count = parseInt(this.getAttribute('data-count'));
             playlistSettings.defaultLoopCount = count;
             
             // Update button states
             playlistLoopButtons.forEach(btn => {
                 btn.classList.remove('bg-blue-500', 'text-white');
                 btn.classList.add('bg-gray-200');
             });
             this.classList.add('bg-blue-500', 'text-white');
             this.classList.remove('bg-gray-200');
             
             // Clear custom input
             const customInput = document.getElementById('playlist-custom-loop');
             if (customInput) {
                 customInput.value = '';
             }
         });
     });

     // Custom loop count input
     const playlistCustomLoop = document.getElementById('playlist-custom-loop');
     if (playlistCustomLoop) {
         playlistCustomLoop.addEventListener('input', function() {
             const value = parseInt(this.value) || 1;
             if (value >= 1 && value <= 100) {
                 playlistSettings.defaultLoopCount = value;
                 
                 // Clear button states
                 playlistLoopButtons.forEach(btn => {
                     btn.classList.remove('bg-blue-500', 'text-white');
                     btn.classList.add('bg-gray-200');
                 });
             }
         });
     }

     // Playlist mode radio buttons
     const playlistModeRadios = document.querySelectorAll('input[name="playlist-mode"]');
     playlistModeRadios.forEach(radio => {
         radio.addEventListener('change', function() {
             if (this.checked) {
                 playlistSettings.playbackMode = this.value;
             }
         });
     });

     // Initialize playlist settings UI
     initializePlaylistSettingsUI();
     
     // Initialize playlist mode settings if function exists
     if (typeof initializePlaylistModeSettings === 'function') {
         initializePlaylistModeSettings();
     }
}

// Initialize playlist settings UI state
function initializePlaylistSettingsUI() {
    // Set default loop count button state
    const playlistLoopButtons = document.querySelectorAll('.playlist-loop-btn');
    playlistLoopButtons.forEach(btn => {
        const count = parseInt(btn.getAttribute('data-count'));
        if (count === playlistSettings.defaultLoopCount) {
            btn.classList.add('bg-blue-500', 'text-white');
            btn.classList.remove('bg-gray-200');
        } else {
            btn.classList.remove('bg-blue-500', 'text-white');
            btn.classList.add('bg-gray-200');
        }
    });

    // Set default playback mode radio state
    const playlistModeRadios = document.querySelectorAll('input[name="playlist-mode"]');
    playlistModeRadios.forEach(radio => {
        radio.checked = (radio.value === playlistSettings.playbackMode);
    });
}

// Toggle verse selection
// 处理经节点击事件
async function handleVerseClick(verseNumber, verseCard) {
    // 根据当前播放模式决定行为
    // 如果是章节朗读模式，从该节开始继续章节朗读
    // 如果是经节朗读模式，播放该单节
    
    // 重置循环计数器，开始新的播放
    if (playbackMode === 'verse') {
        verseLoopCounter = 0;
        currentRandomVersePlayCount = 0; // 重置随机播放计数器
    } else {
        // 章节朗读模式下，重置章节循环计数器
        chapterLoopCounter = 0;
    }
    
    // 记录本次点击的令牌，后续流程只响应最新点击
    const requestId = ++latestPlayRequestId;
    
    // 停止当前播放（如果有的话）
    if (isPlaying) {
        // 标记为用户主动切换经节，抑制旧 utterance 的 onend 清理逻辑
        isSwitchingVerse = true;
        // 强制取消旧朗读直到引擎空闲
        await forceStopSpeech(1000);
    }
    
    // 清除所有选中状态和之前的高亮
    clearSelection();
    removePlayingHighlight();
    
    // 立即高亮当前经节，使用多种方法确保立即生效
    verseCard.classList.remove('bg-white', 'bg-gray-50');
    verseCard.classList.add('playing');
    verseCard.style.backgroundColor = '#dcfce7';
    verseCard.style.borderLeft = '4px solid #16a34a';
    verseCard.style.borderColor = '#16a34a';
    
    // 强制浏览器重新计算样式
    verseCard.offsetHeight;
    verseCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
    
    // 如在等待期间出现新的点击，则本次请求作废
    if (requestId !== latestPlayRequestId) return;
    
    // 根据当前播放模式决定播放行为
    if (playbackMode === 'chapter') {
        // 章节朗读模式：从该节开始继续章节朗读
        currentVerseIndex = verseNumber - 1; // 设置当前经节索引
        currentPlayingVerse = verseNumber;
        
        // 开始从该节继续章节朗读
        startChapterPlayback();
    } else {
        // 经节朗读模式：根据当前设置决定播放行为
        console.log('[点击经节] 经节朗读模式，versePlaybackMode:', settings.versePlaybackMode);
        
        if (settings.versePlaybackMode === 'chapter-random') {
            // 当前章节随机播放模式
            console.log('[点击经节] 启动随机播放');
            isPlaying = true;
            isPaused = false;
            updatePlayPauseButton();
            startRandomVersePlayback();
        } else {
            // 单节循环模式
            console.log('[点击经节] 播放单节');
            currentPlayingVerse = verseNumber;
            playSpecificVerseWithLoop(verseNumber, requestId);
        }
    }
}

// 在当前章节中随机播放经节
function startRandomVerseInCurrentChapter() {
    console.log('[随机播放] startRandomVerseInCurrentChapter 被调用');
    if (!bibleData || !currentTestament || !currentBook || !currentChapter) return;
    
    const verses = bibleData[currentTestament][currentBook][currentChapter];
    if (!verses) return;
    
    // 重置随机播放计数器 - 每次选择新经节时都重置
    currentRandomVersePlayCount = 0;
    console.log('[随机播放] 计数器已重置为 0');
    
    // 获取所有经节编号
    const verseNumbers = Object.keys(verses).map(num => parseInt(num));
    if (verseNumbers.length === 0) return;
    
    // 随机选择一个经节
    const randomIndex = Math.floor(Math.random() * verseNumbers.length);
    const randomVerseNumber = verseNumbers[randomIndex];
    
    // 记录当前随机经节
    currentRandomVerse = randomVerseNumber;
    console.log(`[随机播放] 选择了随机经节: ${randomVerseNumber}`);
    
    // 播放随机选择的经节
    setTimeout(() => {
        playSpecificVerseWithLoop(randomVerseNumber);
    }, 500);
}

// 播放指定经节（带循环功能）
async function playSpecificVerseWithLoop(verseNumber, requestId = null) {
    if (!bibleData || !currentTestament || !currentBook || !currentChapter) return;
    
    const verses = bibleData[currentTestament][currentBook][currentChapter];
    if (!verses || !verses[verseNumber]) return;
    
    // 若已不是最新点击请求，直接忽略
    if (requestId !== null && requestId !== latestPlayRequestId) return;
    
    // 更新播放状态
    isPlaying = true;
    isPaused = false;
    updatePlayPauseButton();
    
    // 记录当前播放的经节编号
    currentPlayingVerse = verseNumber;
    
    // 高亮当前播放的经节（仅当本次仍为最新请求）
    if (requestId === null || requestId === latestPlayRequestId) {
        highlightPlayingVerse(verseNumber);
    }
    
    // 获取经节文本
    const verseData = verses[verseNumber];
    let textToSpeak = '';
    
    if (settings.displayMode === 'chinese') {
        textToSpeak = verseData.chinese || '';
    } else if (settings.displayMode === 'english') {
        textToSpeak = verseData.english || '';
    } else if (settings.displayMode === 'bilingual') {
        const chineseText = verseData.chinese || '';
        const englishText = verseData.english || '';
        textToSpeak = chineseText + (englishText ? ' ' + englishText : '');
    }
    
    if (!textToSpeak) return;
    
    // 创建语音合成
    const utterance = new SpeechSynthesisUtterance(textToSpeak);
    utterance.volume = settings.volume;
    utterance.rate = settings.rate;
    
    // 统一使用 settings.voice，避免 currentVoice 为 null 导致未设置语音
    if (settings.voice) {
        utterance.voice = settings.voice;
    }
    
    utterance.onend = () => {
        // 过期请求不做任何处理
        if (requestId !== null && requestId !== latestPlayRequestId) return;
        // 若这是被取消的旧朗读，或正在切换经节，则忽略清理
        if (utterance !== currentUtterance) return;
        if (isSwitchingVerse) return;
        if (currentPlayingVerse !== verseNumber) return;
        
        // 经节播放模式下的循环逻辑
        if (playbackMode === 'verse') {
            if (settings.versePlaybackMode === 'single-loop') {
                // 单经节循环模式
                if (settings.infiniteLoop) {
                    // 无限循环，继续播放同一经节
                    setTimeout(() => {
                        if (requestId === null || requestId === latestPlayRequestId) {
                            playSpecificVerseWithLoop(verseNumber, requestId);
                        }
                    }, 500);
                } else {
                    // 有限循环，需要计数
                    if (!verseLoopCounter) verseLoopCounter = 0;
                    verseLoopCounter++;
                    
                    if (verseLoopCounter < settings.verseLoopCount) {
                        setTimeout(() => {
                            if (requestId === null || requestId === latestPlayRequestId) {
                                playSpecificVerseWithLoop(verseNumber, requestId);
                            }
                        }, 500);
                    } else {
                        // 循环完成，停止播放
                        verseLoopCounter = 0;
                        isPlaying = false;
                        updatePlayPauseButton();
                        removePlayingHighlight();
                    }
                }
            } else if (settings.versePlaybackMode === 'chapter-random') {
                // 当前章节随机播放模式 - 每个经节播放N次后再随机下一个
                currentRandomVersePlayCount++;
                console.log(`[随机播放] 经节 ${verseNumber} 播放次数: ${currentRandomVersePlayCount}/${settings.verseLoopCount}`);
                
                if (currentRandomVersePlayCount < settings.verseLoopCount) {
                    // 还没达到循环次数，继续播放同一经节
                    console.log(`[随机播放] 继续播放经节 ${verseNumber}`);
                    setTimeout(() => {
                        if (requestId === null || requestId === latestPlayRequestId) {
                            playSpecificVerseWithLoop(verseNumber, requestId);
                        }
                    }, 300);
                } else {
                    // 达到循环次数，选择下一个随机经节
                    console.log(`[随机播放] 经节 ${verseNumber} 播放完成，选择下一个随机经节`);
                    currentRandomVersePlayCount = 0;
                    setTimeout(() => {
                        startRandomVerseInCurrentChapter();
                    }, 500);
                }
            }
        } else {
            // 其他模式的处理保持不变
            removePlayingHighlight();
            isPlaying = false;
            updatePlayPauseButton();
        }
    };
    
    // 仅当真正开始朗读后，才解除切换标记，避免 onerror 过早触发导致误清理
    utterance.onstart = () => {
        // 过期请求不解除切换标记
        if (requestId !== null && requestId !== latestPlayRequestId) return;
        isSwitchingVerse = false;
    };

    utterance.onerror = (event) => {
        console.error('Speech synthesis error:', event.error);
        // 过期请求不处理错误 UI
        if (requestId !== null && requestId !== latestPlayRequestId) return;
        
        // 在随机播放模式下，如果出现错误，继续选择下一个随机经节
        if (playbackMode === 'verse' && settings.versePlaybackMode === 'chapter-random') {
            console.log('[随机播放] 播放出错，选择下一个随机经节');
            currentRandomVersePlayCount = 0;
            setTimeout(() => {
                startRandomVerseInCurrentChapter();
            }, 500);
        } else {
            // 其他模式下，错误情况下停止播放
            isPlaying = false;
            updatePlayPauseButton();
        }
    };

    currentUtterance = utterance;
    // 为稳妥起见，快速确认一次空闲状态
    await waitForSpeechIdle(200);
    speechSynthesis.speak(utterance);
}

// 播放指定经节
async function playSpecificVerse(verseNumber, requestId = null) {
    if (!bibleData || !currentTestament || !currentBook || !currentChapter) return;
    
    const verses = bibleData[currentTestament][currentBook][currentChapter];
    if (!verses || !verses[verseNumber]) return;
    // 若已不是最新点击请求，直接忽略
    if (requestId !== null && requestId !== latestPlayRequestId) return;
    
    // 更新播放状态
    isPlaying = true;
    isPaused = false;
    updatePlayPauseButton();
    // 记录当前播放的经节编号
    currentPlayingVerse = verseNumber;
    
    // 高亮当前播放的经节（仅当本次仍为最新请求）
    if (requestId === null || requestId === latestPlayRequestId) {
        highlightPlayingVerse(verseNumber);
    }
    
    // 获取经节文本
    const verseData = verses[verseNumber];
    let textToSpeak = '';
    
    if (settings.displayMode === 'chinese') {
        textToSpeak = verseData.chinese || '';
    } else if (settings.displayMode === 'english') {
        textToSpeak = verseData.english || '';
    } else if (settings.displayMode === 'bilingual') {
        const chineseText = verseData.chinese || '';
        const englishText = verseData.english || '';
        textToSpeak = chineseText + (englishText ? ' ' + englishText : '');
    }
    
    if (!textToSpeak) return;
    
    // 创建语音合成
    const utterance = new SpeechSynthesisUtterance(textToSpeak);
    utterance.volume = settings.volume;
    utterance.rate = settings.rate;
    
    // 统一使用 settings.voice，避免 currentVoice 为 null 导致未设置语音
    if (settings.voice) {
        utterance.voice = settings.voice;
    }
    
    utterance.onend = () => {
        // 过期请求不做任何处理
        if (requestId !== null && requestId !== latestPlayRequestId) return;
        // 若这是被取消的旧朗读，或正在切换经节，则忽略清理
        if (utterance !== currentUtterance) return;
        if (isSwitchingVerse) return;
        if (currentPlayingVerse !== verseNumber) return;
        removePlayingHighlight();
        
        // 如果是章节播放模式，继续播放下一节
        if (playbackMode === 'chapter') {
            const verseNumbers = Object.keys(verses).sort((a, b) => parseInt(a) - parseInt(b));
            const currentIndex = verseNumbers.indexOf(verseNumber.toString());
            
            if (currentIndex < verseNumbers.length - 1) {
                // 播放下一节
                const nextVerseNumber = verseNumbers[currentIndex + 1];
                currentVerseIndex = currentIndex + 1;
                setTimeout(() => playSpecificVerse(nextVerseNumber), 300);
            } else {
                // 章节结束
                isPlaying = false;
                updatePlayPauseButton();
                handleChapterEnd();
            }
        } else {
            // 经节播放模式，播放完成后停止
            isPlaying = false;
            updatePlayPauseButton();
        }
    };

    // 仅当真正开始朗读后，才解除切换标记，避免 onerror 过早触发导致误清理
    utterance.onstart = () => {
        // 过期请求不解除切换标记
        if (requestId !== null && requestId !== latestPlayRequestId) return;
        isSwitchingVerse = false;
    };

    utterance.onerror = (event) => {
        console.error('Speech synthesis error:', event.error);
        // 过期请求不处理错误 UI
        if (requestId !== null && requestId !== latestPlayRequestId) return;
        // 错误情况下保持当前经节的高亮，方便用户感知当前选择
        isPlaying = false;
        updatePlayPauseButton();
    };

    currentUtterance = utterance;
    // 为稳妥起见，快速确认一次空闲状态
    await waitForSpeechIdle(200);
    speechSynthesis.speak(utterance);
}

function toggleVerseSelection(verseNumber, verseCard) {
    if (selectedVerses.has(verseNumber)) {
        selectedVerses.delete(verseNumber);
        verseCard.classList.remove('selected', 'border-orange-500', 'bg-orange-50');
        verseCard.classList.add('border-transparent');
    } else {
        selectedVerses.add(verseNumber);
        verseCard.classList.add('selected', 'border-orange-500', 'bg-orange-50');
        verseCard.classList.remove('border-transparent');
    }
}

// Clear all selections
function clearSelection() {
    selectedVerses.clear();
    document.querySelectorAll('.verse-card').forEach(card => {
        card.classList.remove('selected', 'border-orange-500', 'bg-orange-50');
        card.classList.add('border-transparent');
    });
}

// Setup voices
function setupVoices() {
    const voiceSelect = document.getElementById('voice-select');
    if (!voiceSelect) return;
    
    function populateVoices() {
        const voices = speechSynthesis.getVoices();
        voiceSelect.innerHTML = '';
        
        voices.forEach((voice, index) => {
            const option = document.createElement('option');
            option.value = index;
            option.textContent = `${voice.name} (${voice.lang})`;
            voiceSelect.appendChild(option);
        });
        
        // 验证并设置默认voice
        if (voices.length > 0) {
            if (!settings.voice || !isValidVoice(settings.voice)) {
                // 优先选择Microsoft Kangkang语音
                const kangkangVoice = voices.find(v => v.name.includes('Kangkang'));
                if (kangkangVoice) {
                    settings.voice = kangkangVoice;
                } else {
                    // 如果没有找到Kangkang，则选择其他中文语音
                    const chineseVoice = voices.find(v => v.lang.includes('zh'));
                    settings.voice = chineseVoice || voices[0];
                }
            }
            // 更新UI选择
            const currentVoiceIndex = voices.findIndex(voice => 
                voice.name === settings.voice.name && voice.lang === settings.voice.lang
            );
            if (currentVoiceIndex >= 0) {
                voiceSelect.value = currentVoiceIndex;
            }
        }
    }
    
    populateVoices();
    speechSynthesis.addEventListener('voiceschanged', populateVoices);
}

// 验证voice对象是否有效
function isValidVoice(voice) {
    return voice && 
           typeof voice === 'object' && 
           voice.constructor && 
           voice.constructor.name === 'SpeechSynthesisVoice' &&
           voice.name && 
           voice.lang;
}

// Playback functions
function startPlayback() {
    if (playbackMode === 'chapter') {
        startChapterPlayback();
    } else {
        startVersePlayback();
    }
}

function startChapterPlaybackWithName() {
    if (!bibleData || !currentTestament || !currentBook || !currentChapter) return;
    
    const verses = bibleData[currentTestament][currentBook][currentChapter];
    if (!verses) return;
    
    stopPlayback();
    
    // 清除之前的高亮
    removePlayingHighlight();
    
    isPlaying = true;
    isPaused = false;
    updatePlayPauseButton();
    
    // 先朗读章节名字
    const chapterNameText = `${currentBook} 第${currentChapter}章`;
    const chapterNameUtterance = new SpeechSynthesisUtterance(chapterNameText);
    chapterNameUtterance.volume = settings.volume;
    chapterNameUtterance.rate = settings.rate;
    
    if (settings.voice && isValidVoice(settings.voice)) {
        chapterNameUtterance.voice = settings.voice;
    }
    
    chapterNameUtterance.onend = function() {
        if (!isPlaying) return;
        
        // 章节名字朗读完成后，开始朗读经节
        const verseNumbers = Object.keys(verses).sort((a, b) => parseInt(a) - parseInt(b));
        
        // 重置播放索引
        currentVerseIndex = 0;
        totalVerses = verseNumbers.length;
        
        // 立即高亮第一节
        if (verseNumbers.length > 0) {
            const firstVerseNumber = verseNumbers[currentVerseIndex];
            const firstVerseCard = document.querySelector(`[data-verse="${firstVerseNumber}"]`);
            if (firstVerseCard) {
                firstVerseCard.classList.remove('bg-white', 'bg-gray-50');
                firstVerseCard.classList.add('playing');
                firstVerseCard.style.backgroundColor = '#dcfce7';
                firstVerseCard.style.borderLeft = '4px solid #16a34a';
                firstVerseCard.style.borderColor = '#16a34a';
                
                // 强制浏览器重新计算样式
                firstVerseCard.offsetHeight;
                firstVerseCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
        
        // 延迟500毫秒后开始播放经节
        setTimeout(() => {
            if (isPlaying) {
                playVerseSequence(verseNumbers, currentVerseIndex);
            }
        }, 500);
    };
    
    currentUtterance = chapterNameUtterance;
    speechSynthesis.speak(chapterNameUtterance);
}

function startChapterPlayback() {
    if (!bibleData || !currentTestament || !currentBook || !currentChapter) return;
    
    const verses = bibleData[currentTestament][currentBook][currentChapter];
    if (!verses) return;
    
    stopPlayback();
    
    // 清除之前的高亮
    removePlayingHighlight();
    
    // 重置章节循环计数器，开始新的播放
    chapterLoopCounter = 0;
    
    isPlaying = true;
    isPaused = false;
    updatePlayPauseButton();
    
    const verseNumbers = Object.keys(verses).sort((a, b) => parseInt(a) - parseInt(b));
    
    // 只有在没有设置当前索引或索引超出范围时才重置为0
    // 这样可以保持从指定经节开始播放的功能
    if (currentVerseIndex < 0 || currentVerseIndex >= verseNumbers.length) {
        currentVerseIndex = 0;
    }
    
    totalVerses = verseNumbers.length;
    
    // 立即高亮当前经节，使用多种方法确保立即生效
    if (verseNumbers.length > 0) {
        const currentVerseNumber = verseNumbers[currentVerseIndex];
        const currentVerseCard = document.querySelector(`[data-verse="${currentVerseNumber}"]`);
        if (currentVerseCard) {
            currentVerseCard.classList.remove('bg-white', 'bg-gray-50');
            currentVerseCard.classList.add('playing');
            currentVerseCard.style.backgroundColor = '#dcfce7';
            currentVerseCard.style.borderLeft = '4px solid #16a34a';
            currentVerseCard.style.borderColor = '#16a34a';
            
            // 强制浏览器重新计算样式
            currentVerseCard.offsetHeight;
            currentVerseCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }
    
    playVerseSequence(verseNumbers, currentVerseIndex);
}

function startVersePlayback() {
    console.log('[播放] startVersePlayback 被调用');
    console.log('[播放] versePlaybackMode:', settings.versePlaybackMode);
    console.log('[播放] selectedVerses.size:', selectedVerses.size);
    
    // 检查是否为"当前章节随机播放"模式
    if (settings.versePlaybackMode === 'chapter-random') {
        console.log('[播放] 进入随机播放模式');
        stopPlayback();
        isPlaying = true;
        isPaused = false;
        updatePlayPauseButton();
        startRandomVersePlayback();
        return;
    }
    
    // 其他经节播放模式需要选中经节
    if (selectedVerses.size === 0) {
        alert('请先选择要朗读的经节');
        return;
    }
    
    stopPlayback();
    isPlaying = true;
    isPaused = false;
    updatePlayPauseButton();
    
    const verseNumbers = Array.from(selectedVerses).sort((a, b) => parseInt(a) - parseInt(b));
    currentVerseIndex = 0;
    totalVerses = verseNumbers.length;
    
    playVerseSequence(verseNumbers, 0, settings.infiniteLoop ? Infinity : settings.verseLoopCount);
}

// 随机播放核心函数
function startRandomVersePlayback() {
    console.log('[随机播放] startRandomVersePlayback 被调用');
    // 初始化随机播放状态
    isRandomPlayback = true;
    playbackMode = 'verse'; // 确保设置为经节播放模式
    settings.versePlaybackMode = 'chapter-random'; // 设置为章节随机模式
    
    // 获取当前章节的所有经节
    if (!bibleData || !currentTestament || !currentBook || !currentChapter) {
        console.error('Bible data not available for random playback');
        return;
    }
    
    const verses = bibleData[currentTestament][currentBook][currentChapter];
    if (!verses) {
        console.error('No verses found for current chapter');
        return;
    }
    
    // 重置当前经节播放计数器
    currentRandomVersePlayCount = 0;
    
    // 使用当前章节的所有经节作为随机播放池
    const verseNumbers = Object.keys(verses).map(num => parseInt(num));
    randomVersePool = [...verseNumbers];
    
    console.log(`[随机播放] 初始化完成，每个经节播放 ${settings.verseLoopCount} 次`);
    
    // 开始随机播放
    playRandomVerse();
}

function playRandomVerse() {
    console.log('[随机播放] playRandomVerse 被调用');
    
    // 检查是否应该停止播放
    if (!isPlaying) {
        console.log('[随机播放] isPlaying = false，停止播放');
        stopPlayback();
        return;
    }
    
    // 如果经节池为空，重新填充（确保有经节可播放）
    if (randomVersePool.length === 0) {
        console.log('[随机播放] 经节池为空，重新填充');
        if (!bibleData || !currentTestament || !currentBook || !currentChapter) {
            console.error('Bible data not available for refilling verse pool');
            stopPlayback();
            return;
        }
        
        const verses = bibleData[currentTestament][currentBook][currentChapter];
        if (!verses) {
            console.error('No verses found for refilling pool');
            stopPlayback();
            return;
        }
        
        const verseNumbers = Object.keys(verses).map(num => parseInt(num));
        randomVersePool = [...verseNumbers];
    }
    
    // 随机选择一个经节
    const randomIndex = Math.floor(Math.random() * randomVersePool.length);
    const selectedVerse = randomVersePool[randomIndex];
    
    // 从池中移除已选择的经节（避免连续重复）
    randomVersePool.splice(randomIndex, 1);
    
    // 重置当前经节的播放计数器
    currentRandomVersePlayCount = 0;
    
    console.log(`[随机播放] 选择了经节 ${selectedVerse}，将播放 ${settings.verseLoopCount} 次`);
    
    // 播放选中的经节
    playSpecificRandomVerse(selectedVerse);
}

async function playSpecificRandomVerse(verseNumber) {
    console.log(`[随机播放] playSpecificRandomVerse 被调用，经节: ${verseNumber}`);
    const verses = bibleData[currentTestament][currentBook][currentChapter];
    const verseData = verses[verseNumber];
    
    if (!verseData) {
        // 如果经节不存在，继续下一个随机经节
        console.log(`[随机播放] 经节 ${verseNumber} 不存在，跳过`);
        setTimeout(() => playRandomVerse(), 300);
        return;
    }
    
    // 获取要朗读的文本
    let textToSpeak = '';
    if (settings.displayMode === 'chinese') {
        textToSpeak = verseData.chinese || verseData;
    } else if (settings.displayMode === 'english') {
        textToSpeak = verseData.english || verseData.chinese || verseData;
    } else if (settings.displayMode === 'bilingual') {
        const chineseText = verseData.chinese || verseData;
        const englishText = verseData.english || '';
        textToSpeak = englishText ? `${chineseText}. ${englishText}` : chineseText;
    }
    
    console.log(`[随机播放] 准备播放文本: ${textToSpeak.substring(0, 30)}...`);
    
    // 高亮当前经节
    highlightPlayingVerse(verseNumber);
    
    // 创建语音合成对象
    currentUtterance = new SpeechSynthesisUtterance(textToSpeak);
    currentUtterance.volume = settings.volume;
    currentUtterance.rate = settings.rate;
    
    // 设置语音 - 如果没有设置，使用默认语音
    if (settings.voice && isValidVoice(settings.voice)) {
        currentUtterance.voice = settings.voice;
        console.log(`[随机播放] 使用设置的语音: ${settings.voice.name}`);
    } else {
        // 尝试获取默认中文语音，优先选择Microsoft Kangkang
        const voices = speechSynthesis.getVoices();
        const kangkangVoice = voices.find(v => v.name.includes('Kangkang'));
        if (kangkangVoice) {
            currentUtterance.voice = kangkangVoice;
            console.log(`[随机播放] 使用默认Kangkang语音: ${kangkangVoice.name}`);
        } else {
            const chineseVoice = voices.find(v => v.lang.includes('zh'));
            if (chineseVoice) {
                currentUtterance.voice = chineseVoice;
                console.log(`[随机播放] 使用默认中文语音: ${chineseVoice.name}`);
            } else {
                console.log(`[随机播放] 未找到中文语音，使用浏览器默认语音`);
            }
        }
    }
    
    currentUtterance.onend = function() {
        if (isSwitchingVerse) return;
        
        if (isPlaying && !isPaused && isRandomPlayback) {
            currentRandomVersePlayCount++;
            console.log(`[随机播放] 经节 ${verseNumber} 播放次数: ${currentRandomVersePlayCount}/${settings.verseLoopCount}`);
            
            if (currentRandomVersePlayCount < settings.verseLoopCount) {
                // 还没达到循环次数，继续播放同一经节
                console.log(`[随机播放] 继续播放经节 ${verseNumber}`);
                setTimeout(() => playSpecificRandomVerse(verseNumber), 300);
            } else {
                // 达到循环次数，选择下一个随机经节
                console.log(`[随机播放] 经节 ${verseNumber} 播放完成，选择下一个随机经节`);
                removePlayingHighlight();
                setTimeout(() => playRandomVerse(), 500);
            }
        } else {
            removePlayingHighlight();
        }
    };
    
    currentUtterance.onerror = function(event) {
        console.error('Speech synthesis error:', event);
        if (isSwitchingVerse) return;
        removePlayingHighlight();
        
        if (isPlaying && isRandomPlayback) {
            console.log('[随机播放] 播放出错，选择下一个随机经节');
            setTimeout(() => playRandomVerse(), 500);
        }
    };

    currentUtterance.onstart = function() {
        console.log(`[随机播放] 开始播放经节 ${verseNumber}`);
        isSwitchingVerse = false;
    };
    
    // 直接播放，不等待（因为我们已经在 onend 中处理了延迟）
    console.log(`[随机播放] 调用 speechSynthesis.speak()`);
    speechSynthesis.speak(currentUtterance);
}

async function playVerseSequence(verseNumbers, index, loopCount = 1) {
    if (!isPlaying || index >= verseNumbers.length) {
        if (playbackMode === 'chapter') {
            handleChapterEnd();
        } else {
            if (loopCount > 1 || loopCount === Infinity) {
                // Loop the verses
                const newLoopCount = loopCount === Infinity ? Infinity : loopCount - 1;
                setTimeout(() => playVerseSequence(verseNumbers, 0, newLoopCount), 500);
            } else {
                stopPlayback();
            }
        }
        return;
    }
    
    const verseNumber = verseNumbers[index];
    const verses = bibleData[currentTestament][currentBook][currentChapter];
    const verseData = verses[verseNumber];
    
    if (!verseData) {
        playVerseSequence(verseNumbers, index + 1, loopCount);
        return;
    }
    
    // Get text based on display mode
    let textToSpeak = '';
    if (settings.displayMode === 'chinese') {
        textToSpeak = verseData.chinese || verseData;
    } else if (settings.displayMode === 'english') {
        textToSpeak = verseData.english || verseData.chinese || verseData;
    } else if (settings.displayMode === 'bilingual') {
        const chineseText = verseData.chinese || verseData;
        const englishText = verseData.english || '';
        textToSpeak = englishText ? `${chineseText}. ${englishText}` : chineseText;
    }
    
    // Highlight current verse
    highlightPlayingVerse(verseNumber);
    
    // Create utterance
    currentUtterance = new SpeechSynthesisUtterance(textToSpeak);
    currentUtterance.volume = settings.volume;
    currentUtterance.rate = settings.rate;
    
    if (settings.voice && isValidVoice(settings.voice)) {
        currentUtterance.voice = settings.voice;
    }
    
    currentUtterance.onend = function() {
        // 用户正在切换经节时，不移除高亮且不继续旧序列
        if (isSwitchingVerse) return;
        removePlayingHighlight();
        if (isPlaying && !isPaused) {
            setTimeout(() => playVerseSequence(verseNumbers, index + 1, loopCount), 300);
        }
    };
    
    currentUtterance.onerror = function(event) {
        console.error('Speech synthesis error:', event);
        // 切换经节时的取消也会触发错误，避免误清理与继续旧序列
        if (isSwitchingVerse) return;
        removePlayingHighlight();
        if (isPlaying) {
            setTimeout(() => playVerseSequence(verseNumbers, index + 1, loopCount), 300);
        }
    };

    // 真正开始朗读时，解除切换标记
    currentUtterance.onstart = function() {
        isSwitchingVerse = false;
    };
    
    // 等待引擎空闲，避免上一段朗读尚未完全取消导致排队
    await waitForSpeechIdle(1000);
    speechSynthesis.speak(currentUtterance);
    currentVerseIndex = index;
}

function pausePlayback() {
    if (isPlaying && !isPaused) {
        isPaused = true;
        speechSynthesis.pause();
        updatePlayPauseButton();
    }
}

function resumePlayback() {
    if (isPlaying && isPaused) {
        isPaused = false;
        speechSynthesis.resume();
        updatePlayPauseButton();
    }
}

function stopPlayback() {
    isPlaying = false;
    isPaused = false;
    isRandomPlayback = false; // 重置随机播放状态
    randomPlaybackCount = 0;
    randomVersePool = [];
    currentRandomVerse = null; // 重置当前随机经节
    currentRandomVersePlayCount = 0; // 重置当前经节播放次数
    speechSynthesis.cancel();
    removePlayingHighlight();
    updatePlayPauseButton();
    // 注意：不在这里重置 currentVerseIndex，因为暂停后继续播放需要保持位置
    currentPlayingVerse = null;
}

function updatePlayPauseButton() {
    const playPauseBtn = document.getElementById('play-pause');
    if (playPauseBtn) {
        if (isPlaying && !isPaused) {
            playPauseBtn.textContent = '暂停';
            playPauseBtn.className = 'px-4 py-2 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600';
        } else if (isPaused) {
            playPauseBtn.textContent = '继续';
            playPauseBtn.className = 'px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600';
        } else {
            playPauseBtn.textContent = '播放';
            playPauseBtn.className = 'px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600';
        }
    }
}

function highlightPlayingVerse(verseNumber) {
    removePlayingHighlight();
    const verseCard = document.querySelector(`[data-verse="${verseNumber}"]`);
    if (verseCard) {
        // 使用多种方法确保立即高亮
        verseCard.classList.remove('bg-white', 'bg-gray-50');
        verseCard.classList.add('playing');
        verseCard.style.backgroundColor = '#dcfce7';
        verseCard.style.borderLeft = '4px solid #16a34a';
        verseCard.style.borderColor = '#16a34a';
        
        // 强制浏览器重新计算样式
        verseCard.offsetHeight;
        verseCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

function removePlayingHighlight() {
    console.log('[移除高亮] removePlayingHighlight 被调用');
    console.trace('[移除高亮] 调用堆栈');
    document.querySelectorAll('.verse-card.playing').forEach(card => {
        card.classList.remove('playing', 'border-green-500', 'bg-green-50');
        // 清除内联样式
        card.style.backgroundColor = '';
        card.style.borderLeft = '';
        card.style.borderColor = '';
    });
}

function restorePlayingHighlight() {
    console.log('[恢复高亮] restorePlayingHighlight 被调用');
    console.log('[恢复高亮] isPlaying:', isPlaying, 'currentPlayingVerse:', currentPlayingVerse);
    // Check if playback is active and we have a current verse
    if (isPlaying && currentPlayingVerse) {
        console.log('[恢复高亮] 正在恢复经节', currentPlayingVerse, '的高亮');
        // Use existing highlightPlayingVerse function for consistency
        highlightPlayingVerse(currentPlayingVerse);
    } else {
        console.log('[恢复高亮] 不需要恢复高亮（没有播放或没有当前经节）');
    }
}

function handleChapterEnd() {
    console.log('[章节结束] chapterEndAction:', settings.chapterEndAction);
    
    if (settings.chapterEndAction === 'next') {
        // 顺序到下一章 - 在章节朗读模式下需要自动播放
        console.log('[章节结束] 播放下一章');
        navigateChapter(1, true); // 传入true表示需要自动播放
    } else if (settings.chapterEndAction === 'loop') {
        // 循环朗读本章（无限循环，直到用户手动停止）
        console.log('[章节结束] 循环朗读本章，重置索引为0');
        // 强制重置索引为0，从第一节开始
        currentVerseIndex = 0;
        setTimeout(() => {
            if (isPlaying) {
                startChapterPlayback();
            }
        }, 1000);
    } else if (settings.chapterEndAction === 'random') {
        // 随机跳转到另一章
        console.log('[章节结束] 随机跳转');
        navigateToRandomChapter();
    } else {
        // 默认停止播放
        console.log('[章节结束] 停止播放');
        stopPlayback();
    }
}

function navigateChapter(direction, autoPlay = false) {
    if (!bibleData || !currentTestament || !currentBook) return;
    
    const bookData = bibleData[currentTestament][currentBook];
    const chapters = Object.keys(bookData).map(ch => parseInt(ch)).sort((a, b) => a - b);
    const currentIndex = chapters.indexOf(currentChapter);
    
    let newChapter = currentChapter;
    if (direction > 0 && currentIndex < chapters.length - 1) {
        newChapter = chapters[currentIndex + 1];
    } else if (direction < 0 && currentIndex > 0) {
        newChapter = chapters[currentIndex - 1];
    } else if (direction > 0 && currentIndex === chapters.length - 1) {
        // Move to next book
        navigateToNextBook();
        return;
    } else if (direction < 0 && currentIndex === 0) {
        // Move to previous book
        navigateToPrevBook();
        return;
    }
    
    if (newChapter !== currentChapter) {
        // 停止当前播放并重置播放状态
        stopPlayback();
        
        currentChapter = newChapter;
        
        // 重置详细设置状态
        const newChapterKey = `${currentTestament}-${currentBook}-${currentChapter}`;
        if (currentChapterKey !== newChapterKey) {
            currentChapterKey = newChapterKey;
            hasOpenedDetailedSettingsInCurrentChapter = false;
        }
        
        clearSelection();
        displayChapter();
        
        // Update URL
        const newUrl = `verse.html?book=${encodeURIComponent(currentBook)}&chapter=${currentChapter}`;
        window.history.pushState({}, '', newUrl);
        
        // 重置播放索引，确保下次播放从第一节开始
        currentVerseIndex = 0;
        totalVerses = 0;
        
        // 只有在autoPlay为true时才自动开始播放新章节
        if (autoPlay) {
            setTimeout(() => {
                startChapterPlayback();
            }, 500);
        }
    }
}

function navigateToNextBook() {
    // Implementation for navigating to next book
    console.log('Navigate to next book');
}

function navigateToPrevBook() {
    // Implementation for navigating to previous book
    console.log('Navigate to previous book');
}

function navigateToRandomChapter() {
    if (!bibleData || !currentTestament) return;
    
    // 获取当前约的所有书卷
    const testamentData = bibleData[currentTestament];
    const allBooks = Object.keys(testamentData);
    
    // 收集所有可能的章节组合
    const allChapters = [];
    allBooks.forEach(book => {
        const bookData = testamentData[book];
        const chapters = Object.keys(bookData).map(ch => parseInt(ch));
        chapters.forEach(chapter => {
            // 排除当前章节
            if (!(book === currentBook && chapter === currentChapter)) {
                allChapters.push({ book, chapter });
            }
        });
    });
    
    if (allChapters.length === 0) {
        console.log('没有其他章节可以跳转');
        return;
    }
    
    // 随机选择一个章节
    const randomIndex = Math.floor(Math.random() * allChapters.length);
    const selectedChapter = allChapters[randomIndex];
    
    // 停止当前播放并重置播放状态
    stopPlayback();
    
    // 更新当前书卷和章节
    currentBook = selectedChapter.book;
    currentChapter = selectedChapter.chapter;
    
    // 重置详细设置状态
    const newChapterKey = `${currentBook}-${currentChapter}`;
    if (currentChapterKey !== newChapterKey) {
        currentChapterKey = newChapterKey;
        hasOpenedDetailedSettingsInCurrentChapter = false;
    }
    
    clearSelection();
    displayChapter();
    
    // Update URL
    const newUrl = `verse.html?book=${encodeURIComponent(currentBook)}&chapter=${currentChapter}`;
    window.history.pushState({}, '', newUrl);
    
    // 重置播放索引，确保下次播放从第一节开始
    currentVerseIndex = 0;
    totalVerses = 0;
    
    // 自动开始播放随机章节，并在开始时朗读章节名字
    setTimeout(() => {
        startChapterPlaybackWithName();
    }, 500);
    
    console.log(`随机跳转到 ${currentBook} 第${currentChapter}章`);
}

// Settings management
function updateModeSettings() {
    const chapterSettings = document.getElementById('chapter-mode-settings');
    const verseSettings = document.getElementById('verse-mode-settings');
    const playlistSettings = document.getElementById('playlist-mode-settings');
    const verseListButton = document.getElementById('verse-list-playback');
    const defaultContent = document.getElementById('default-content');
    const playlistContent = document.getElementById('playlist-content');
    
    // 更新详细设置模态框的标题
    const modalTitle = document.querySelector('#detailed-settings-modal h2');
    if (modalTitle) {
        const titleMap = {
            'chapter': '章节朗读设置',
            'verse': '经节朗读设置', 
            'playlist': '播放列表设置'
        };
        modalTitle.textContent = titleMap[playbackMode] || '详细设置';
    }
    
    if (chapterSettings && verseSettings && playlistSettings) {
        if (playbackMode === 'chapter') {
            chapterSettings.classList.remove('hidden');
            verseSettings.classList.add('hidden');
            playlistSettings.classList.add('hidden');
            // 隐藏经节列表播放按钮
            if (verseListButton) {
                verseListButton.classList.add('hidden');
            }
            // 显示默认内容，隐藏播放列表内容
            if (defaultContent) defaultContent.classList.remove('hidden');
            if (playlistContent) playlistContent.classList.add('hidden');
        } else if (playbackMode === 'verse') {
            chapterSettings.classList.add('hidden');
            verseSettings.classList.remove('hidden');
            playlistSettings.classList.add('hidden');
            // 隐藏经节列表播放按钮 - 用户要求删除此按钮
            if (verseListButton) {
                verseListButton.classList.add('hidden');
            }
            // 显示默认内容，隐藏播放列表内容
            if (defaultContent) defaultContent.classList.remove('hidden');
            if (playlistContent) playlistContent.classList.add('hidden');
        } else if (playbackMode === 'playlist') {
            chapterSettings.classList.add('hidden');
            verseSettings.classList.add('hidden');
            playlistSettings.classList.remove('hidden');
            // 隐藏经节列表播放按钮
            if (verseListButton) {
                verseListButton.classList.add('hidden');
            }
            // 隐藏默认内容，显示播放列表内容
            if (defaultContent) defaultContent.classList.add('hidden');
            if (playlistContent) playlistContent.classList.remove('hidden');
            
            // 更新播放列表显示
            updatePlaylistModeDisplay();
            updateDetailedPlaylistDisplay();
        }
    }
    
    // 只更新标题文本，不重新渲染经节列表
    const chapterTitle = document.getElementById('chapter-title');
    if (chapterTitle) {
        if (playbackMode === 'playlist') {
            chapterTitle.textContent = '经节列表播放';
        } else {
            chapterTitle.textContent = `${currentBook} 第${currentChapter}章`;
        }
    }
}

function saveDetailedSettings() {
    // Save chapter end action
    const chapterEndAction = document.querySelector('input[name="chapter-end-action"]:checked');
    if (chapterEndAction) {
        settings.chapterEndAction = chapterEndAction.value;
    }
    
    // Save verse playback mode
    const versePlaybackMode = document.querySelector('input[name="verse-playback-mode"]:checked');
    if (versePlaybackMode) {
        settings.versePlaybackMode = versePlaybackMode.value;
    }
    
    // Save playlist playback mode
    const playlistPlaybackMode = document.querySelector('input[name="detailed-playlist-mode"]:checked');
    if (playlistPlaybackMode) {
        playlistSettings.playbackMode = playlistPlaybackMode.value;
        console.log('[设置] 播放列表模式已保存:', playlistSettings.playbackMode);
    }
    
    // Save loop settings - infinite loop is now handled by button clicks
    // The infiniteLoop setting is already updated when buttons are clicked
    
    // Save custom loop count if applicable
    const customLoopInput = document.getElementById('custom-loop-count');
    if (customLoopInput && !settings.infiniteLoop) {
        const customValue = parseInt(customLoopInput.value) || 1;
        settings.customLoopCount = customValue;
        if (settings.verseLoopCount === settings.customLoopCount) {
            settings.verseLoopCount = customValue;
        }
    }
    
    saveSettings();
    // alert('设置已保存'); // 移除弹窗提示
}

// 应用经节朗读模式的默认设置
function applyDefaultVerseSettings() {
    // 设置默认为单经节循环
    const singleLoopRadio = document.querySelector('input[name="verse-playback-mode"][value="single-loop"]');
    if (singleLoopRadio) {
        singleLoopRadio.checked = true;
        settings.versePlaybackMode = 'single-loop';
    }
    
    // 设置默认为无限循环
    const infiniteLoopBtn = document.getElementById('infinite-loop-btn');
    if (infiniteLoopBtn) {
        // 清除其他按钮的选中状态
        const loopButtons = document.querySelectorAll('.loop-count-btn');
        loopButtons.forEach(btn => {
            btn.classList.remove('bg-blue-500', 'text-white');
            btn.classList.add('bg-gray-200', 'text-gray-700');
        });
        
        // 设置无限循环按钮为选中状态
        infiniteLoopBtn.classList.remove('bg-gray-200', 'text-gray-700');
        infiniteLoopBtn.classList.add('bg-blue-500', 'text-white');
        
        // 更新设置
        settings.infiniteLoop = true;
        settings.verseLoopCount = Infinity;
    }
    
    console.log('[默认设置] 应用经节朗读模式默认设置：单经节循环+无限');
}

function addSelectedVersesToPlaylist() {
    if (selectedVerses.size === 0) {
        alert('请先选择要添加的经节');
        return;
    }
    
    selectedVerses.forEach(verseNumber => {
        const verseData = bibleData[currentTestament][currentBook][currentChapter][verseNumber];
        if (verseData) {
            const verseText = verseData.chinese || verseData;
            versePlaylist.push({
                book: currentBook,
                chapter: currentChapter,
                verse: verseNumber,
                text: verseText,
                loopCount: 1
            });
        }
    });
    
    updatePlaylistDisplay();
    clearSelection();
}

function updatePlaylistDisplay() {
    const playlistContainer = document.getElementById('verse-playlist');
    if (!playlistContainer) return;
    
    playlistContainer.innerHTML = '';
    
    versePlaylist.forEach((item, index) => {
        const playlistItem = document.createElement('div');
        playlistItem.className = 'flex items-center justify-between p-2 bg-gray-50 rounded text-sm';
        playlistItem.innerHTML = `
            <span>${item.book} ${item.chapter}:${item.verse}</span>
            <div class="flex items-center space-x-2">
                <input type="number" min="1" value="${item.loopCount}" class="w-12 px-1 py-0 text-xs border rounded" 
                       onchange="updatePlaylistItemLoop(${index}, this.value)">
                <button onclick="removeFromPlaylist(${index})" class="text-red-500 hover:text-red-700">×</button>
            </div>
        `;
        playlistContainer.appendChild(playlistItem);
    });
}

function updatePlaylistItemLoop(index, loopCount) {
    if (versePlaylist[index]) {
        versePlaylist[index].loopCount = parseInt(loopCount) || 1;
    }
}

function removeFromPlaylist(index) {
    versePlaylist.splice(index, 1);
    updatePlaylistDisplay();
}

function saveSettings() {
    // 创建设置副本，排除voice属性
    const { voice, ...settingsToSave } = settings;
    localStorage.setItem('bibleReaderSettings', JSON.stringify(settingsToSave));
}

function loadSettings() {
    const savedSettings = localStorage.getItem('bibleReaderSettings');
    if (savedSettings) {
        const parsedSettings = JSON.parse(savedSettings);
        // 过滤掉voice属性，因为它不能被序列化/反序列化
        const { voice, ...otherSettings } = parsedSettings;
        settings = { ...settings, ...otherSettings };
    }
    
    // Apply loaded settings to UI
    const displayModeSelect = document.getElementById('display-mode');
    if (displayModeSelect) {
        displayModeSelect.value = settings.displayMode;
    }
    
    const volumeSlider = document.getElementById('volume-slider');
    const volumeValue = document.getElementById('volume-value');
    if (volumeSlider && volumeValue) {
        volumeSlider.value = settings.volume;
        volumeValue.textContent = settings.volume.toFixed(1);
    }
    
    const rateSlider = document.getElementById('rate-slider');
    const rateValue = document.getElementById('rate-value');
    if (rateSlider && rateValue) {
        rateSlider.value = settings.rate;
        rateValue.textContent = settings.rate.toFixed(1);
    }
    
    // Apply chapter end action
    const chapterEndActionRadio = document.querySelector(`input[name="chapter-end-action"][value="${settings.chapterEndAction}"]`);
    if (chapterEndActionRadio) {
        chapterEndActionRadio.checked = true;
    }
    
    // Apply verse playback mode
    const versePlaybackModeRadio = document.querySelector(`input[name="verse-playback-mode"][value="${settings.versePlaybackMode}"]`);
    if (versePlaybackModeRadio) {
        versePlaybackModeRadio.checked = true;
    }
    
    // Apply loop settings
    const infiniteLoopCheckbox = document.getElementById('infinite-loop');
    if (infiniteLoopCheckbox) {
        infiniteLoopCheckbox.checked = settings.infiniteLoop;
    }
    
    // Update loop count buttons
    const loopCountButtons = document.querySelectorAll('.loop-count-btn');
    loopCountButtons.forEach(btn => {
        btn.classList.remove('active', 'bg-blue-500', 'text-white');
        btn.classList.add('bg-gray-200');
    });
    
    if (settings.infiniteLoop) {
        const infiniteBtn = document.querySelector('[data-count="infinite"]');
        if (infiniteBtn) {
            infiniteBtn.classList.add('active', 'bg-blue-500', 'text-white');
            infiniteBtn.classList.remove('bg-gray-200');
        }
    } else {
        // Find the appropriate button based on current loop count
        let targetBtn = null;
        if (settings.verseLoopCount === 3) {
            targetBtn = document.querySelector('[data-count="3"]');
        } else if (settings.verseLoopCount === 5) {
            targetBtn = document.querySelector('[data-count="5"]');
        } else if (settings.verseLoopCount === 10) {
            targetBtn = document.querySelector('[data-count="10"]');
        } else {
            targetBtn = document.querySelector('[data-count="custom"]');
            const customInput = document.getElementById('custom-count-input');
            const customLoopInput = document.getElementById('custom-loop-count');
            if (customInput && customLoopInput) {
                customInput.classList.remove('hidden');
                customLoopInput.value = settings.verseLoopCount;
            }
        }
        
        if (targetBtn) {
            targetBtn.classList.add('active', 'bg-blue-500', 'text-white');
            targetBtn.classList.remove('bg-gray-200');
        }
    }
}

// Verse List Playback Functions
function populateCurrentChapterVerses() {
    const chapterVersesList = document.getElementById('chapter-verses-list');
    const currentChapterTitle = document.getElementById('current-chapter-title');
    
    if (!chapterVersesList || !currentChapterTitle) return;
    
    currentChapterTitle.textContent = `${currentBook} 第${currentChapter}章 经节`;
    chapterVersesList.innerHTML = '';
    
    if (!bibleData || !currentTestament || !currentBook || !currentChapter) return;
    
    const verses = bibleData[currentTestament][currentBook][currentChapter];
    if (!verses) return;
    
    Object.keys(verses).forEach(verseNumber => {
        const verseData = verses[verseNumber];
        let verseText = '';
        
        // 根据显示模式获取经节文本
        if (settings.displayMode === 'chinese') {
            verseText = verseData.chinese || (typeof verseData === 'string' ? verseData : '');
        } else if (settings.displayMode === 'english') {
            verseText = verseData.english || (typeof verseData === 'string' ? verseData : '');
        } else if (settings.displayMode === 'bilingual') {
            const chineseText = verseData.chinese || '';
            const englishText = verseData.english || '';
            verseText = chineseText + (englishText ? ' ' + englishText : '');
        } else {
            // 默认显示中文
            if (typeof verseData === 'string') {
                verseText = verseData;
            } else if (verseData.chinese) {
                verseText = verseData.chinese;
            }
        }
        
        // 根据文本长度决定显示方式，最大显示50个字符
        const maxLength = 50;
        const displayText = verseText.length > maxLength ? verseText.substring(0, maxLength) + '...' : verseText;
        
        // 检查是否已在播放列表中
        const isInPlaylist = playlistModeVerses.some(v => 
            v.book === currentBook && v.chapter === currentChapter && v.verse === verseNumber
        );
        
        const verseButton = document.createElement('button');
        verseButton.className = `text-left p-2 rounded text-sm border w-full flex items-start transition-colors ${
            isInPlaylist 
                ? 'bg-blue-200 border-blue-500 text-blue-800' 
                : 'bg-gray-100 hover:bg-gray-200 border-gray-300'
        }`;
        verseButton.innerHTML = `<div class="w-full"><span class="font-semibold text-blue-600">${verseNumber}.</span> <span class="${isInPlaylist ? 'text-blue-800' : 'text-gray-800'}">${displayText}</span></div>`;
        verseButton.onclick = () => toggleCurrentChapterVerse(currentBook, currentChapter, verseNumber, verseText, verseButton);
        
        chapterVersesList.appendChild(verseButton);
    });
}

function toggleCurrentChapterVerse(book, chapter, verse, text, button) {
    // 检查是否已在播放列表中
    const existingIndex = playlistModeVerses.findIndex(v => 
        v.book === book && v.chapter === chapter && v.verse === verse
    );
    
    if (existingIndex >= 0) {
        // 从播放列表中移除
        playlistModeVerses.splice(existingIndex, 1);
        button.className = 'text-left p-2 rounded text-sm border w-full flex items-start transition-colors bg-gray-100 hover:bg-gray-200 border-gray-300';
        button.innerHTML = `<div class="w-full"><span class="font-semibold text-blue-600">${verse}.</span> <span class="text-gray-800">${text.length > 50 ? text.substring(0, 50) + '...' : text}</span></div>`;
        updatePlaylistModeDisplay();
    } else {
        // 添加到播放列表
        addVerseToPlaylistMode(book, chapter, verse, text);
        button.className = 'text-left p-2 rounded text-sm border w-full flex items-start transition-colors bg-blue-200 border-blue-500 text-blue-800';
        button.innerHTML = `<div class="w-full"><span class="font-semibold text-blue-600">${verse}.</span> <span class="text-blue-800">${text.length > 50 ? text.substring(0, 50) + '...' : text}</span></div>`;
    }
}

function addVerseToPlaylist(book, chapter, verse, text) {
    // 检查是否已经在播放列表中
    const exists = versePlaylist.some(item => 
        item.book === book && item.chapter === chapter && item.verse === verse
    );
    
    if (!exists) {
        versePlaylist.push({
            book: book,
            chapter: chapter,
            verse: verse,
            text: text,
            loopCount: 1
        });
        updateSelectedPlaylist();
    }
}

function updateSelectedPlaylist() {
    const playlistContainer = document.getElementById('selected-verses-playlist');
    if (!playlistContainer) return;
    
    playlistContainer.innerHTML = '';
    
    if (versePlaylist.length === 0) {
        playlistContainer.innerHTML = '<p class="text-gray-500 text-sm">暂无选择的经节</p>';
        return;
    }
    
    versePlaylist.forEach((item, index) => {
        const playlistItem = document.createElement('div');
        playlistItem.className = 'flex items-center justify-between p-2 bg-white rounded border text-sm';
        
        const shortText = item.text.length > 30 ? item.text.substring(0, 30) + '...' : item.text;
        
        playlistItem.innerHTML = `
            <span class="flex-1">${item.book} ${item.chapter}:${item.verse} - ${shortText}</span>
            <button onclick="removeFromVersePlaylist(${index})" class="text-red-500 hover:text-red-700 ml-2">×</button>
        `;
        playlistContainer.appendChild(playlistItem);
    });
}

function removeFromVersePlaylist(index) {
    versePlaylist.splice(index, 1);
    updateSelectedPlaylist();
}

// Bible Navigation Functions
let selectedTestament = '旧约';
let selectedBook = '';
let selectedChapter = 1;
let navigationVerses = [];

function initializeBibleNavigation() {
    selectedTestament = '旧约';
    selectedBook = '';
    selectedChapter = 1;
    navigationVerses = [];
    
    // 重置UI状态
    const chaptersSection = document.getElementById('chapters-section');
    const versesSection = document.getElementById('verses-section');
    const booksContent = document.getElementById('books-content');
    const booksArrow = document.getElementById('books-arrow');
    const chaptersContent = document.getElementById('chapters-content');
    const chaptersArrow = document.getElementById('chapters-arrow');

    if (chaptersSection) chaptersSection.style.display = 'none';
    if (versesSection) versesSection.style.display = 'none';

    // 保证每次打开都恢复到“书卷展开”状态
    if (booksContent) booksContent.style.display = 'flex';
    if (booksArrow) booksArrow.classList.add('rotate-180');

    // 将章节区恢复为折叠状态
    if (chaptersContent) chaptersContent.style.display = 'none';
    if (chaptersArrow) chaptersArrow.classList.remove('rotate-180');
    
    // 设置默认选中旧约
    selectTestament('旧约', document.getElementById('old-testament-btn'));
}

function selectTestament(testament, button) {
    selectedTestament = testament;
    
    // 更新按钮状态
    document.querySelectorAll('#old-testament-btn, #new-testament-btn').forEach(btn => {
        btn.classList.remove('bg-blue-500', 'text-white');
        btn.classList.add('bg-gray-300', 'text-gray-700');
    });
    
    button.classList.remove('bg-gray-300', 'text-gray-700');
    button.classList.add('bg-blue-500', 'text-white');
    
    // 重置选择状态
    selectedBook = '';
    selectedChapter = 1;
    document.getElementById('chapters-section').style.display = 'none';
    document.getElementById('verses-section').style.display = 'none';
    
    // 填充书卷
    populateBooks();
}

function populateBooks() {
    const booksGrid = document.getElementById('books-grid');
    if (!booksGrid || !bibleData || !bibleData[selectedTestament]) return;
    
    booksGrid.innerHTML = '';
    
    Object.keys(bibleData[selectedTestament]).forEach(bookName => {
        const bookButton = document.createElement('button');
        bookButton.className = 'p-2 bg-gray-100 hover:bg-gray-200 rounded text-sm border text-center transition-colors';
        bookButton.textContent = bookName;
        bookButton.onclick = () => selectBook(bookName, bookButton);
        
        booksGrid.appendChild(bookButton);
    });
}

function selectBook(bookName, button) {
    selectedBook = bookName;
    selectedChapter = 1;
    
    // 更新书卷按钮状态
    document.querySelectorAll('#books-grid button').forEach(btn => {
        btn.classList.remove('bg-blue-500', 'text-white');
        btn.classList.add('bg-gray-100', 'text-gray-700');
    });
    
    button.classList.remove('bg-gray-100', 'text-gray-700');
    button.classList.add('bg-blue-500', 'text-white');
    
    // 自动折叠书卷选择区域
    toggleSection('books');
    
    // 显示章节选择
    document.getElementById('chapters-section').style.display = 'block';
    document.getElementById('verses-section').style.display = 'none';

    // 强制将章节内容区展开，并同步箭头状态
    const chaptersContent = document.getElementById('chapters-content');
    const chaptersArrow = document.getElementById('chapters-arrow');
    if (chaptersContent) {
        chaptersContent.style.display = 'flex';
    }
    if (chaptersArrow) {
        chaptersArrow.classList.add('rotate-180');
    }
    
    populateChapters();
}

function populateChapters() {
    const chaptersGrid = document.getElementById('chapters-grid');
    if (!chaptersGrid || !bibleData || !bibleData[selectedTestament] || !bibleData[selectedTestament][selectedBook]) return;
    
    chaptersGrid.innerHTML = '';
    
    const bookData = bibleData[selectedTestament][selectedBook];
    Object.keys(bookData).forEach(chapterNumber => {
        const chapterButton = document.createElement('button');
        chapterButton.className = 'p-2 bg-gray-100 hover:bg-gray-200 rounded text-sm border text-center transition-colors';
        chapterButton.textContent = chapterNumber;
        chapterButton.onclick = () => selectChapter(parseInt(chapterNumber), chapterButton);
        
        chaptersGrid.appendChild(chapterButton);
    });
}

function selectChapter(chapterNumber, button) {
    selectedChapter = chapterNumber;
    
    // 更新章节按钮状态
    document.querySelectorAll('#chapters-grid button').forEach(btn => {
        btn.classList.remove('bg-blue-500', 'text-white');
        btn.classList.add('bg-gray-100', 'text-gray-700');
    });
    
    button.classList.remove('bg-gray-100', 'text-gray-700');
    button.classList.add('bg-blue-500', 'text-white');
    
    // 自动折叠章节选择区域
    toggleSection('chapters');
    
    // 显示经节选择
    document.getElementById('verses-section').style.display = 'block';
    
    populateNavigationVerses();
}

function populateNavigationVerses() {
    const versesGrid = document.getElementById('navigation-verses-grid');
    if (!versesGrid) return;
    
    versesGrid.innerHTML = '';
    
    if (!bibleData || !bibleData[selectedTestament] || !bibleData[selectedTestament][selectedBook] || !bibleData[selectedTestament][selectedBook][selectedChapter]) return;
    
    const verses = bibleData[selectedTestament][selectedBook][selectedChapter];
    
    Object.keys(verses).forEach(verseNumber => {
        const verseData = verses[verseNumber];
        let verseText = '';
        
        // 根据显示模式获取经节文本
        if (settings.displayMode === 'chinese') {
            verseText = verseData.chinese || (typeof verseData === 'string' ? verseData : '');
        } else if (settings.displayMode === 'english') {
            verseText = verseData.english || (typeof verseData === 'string' ? verseData : '');
        } else if (settings.displayMode === 'bilingual') {
            const chineseText = verseData.chinese || '';
            const englishText = verseData.english || '';
            verseText = chineseText + (englishText ? ' ' + englishText : '');
        } else {
            // 默认显示中文
            if (typeof verseData === 'string') {
                verseText = verseData;
            } else if (verseData.chinese) {
                verseText = verseData.chinese;
            }
        }
        
        // 根据文本长度决定显示方式，最大显示60个字符
        const maxLength = 60;
        const displayText = verseText.length > maxLength ? verseText.substring(0, maxLength) + '...' : verseText;
        
        const verseButton = document.createElement('button');
        
        // 检查经节是否已在播放列表中
        const verseKey = `${selectedBook}-${selectedChapter}-${verseNumber}`;
        const isInPlaylist = playlistModeVerses.some(v => v.key === verseKey);
        
        // 根据是否在播放列表中设置样式
        if (isInPlaylist) {
            verseButton.className = 'text-left p-3 bg-blue-200 border-blue-500 hover:bg-blue-300 rounded text-sm border-2 w-full min-h-[60px] flex items-start';
            verseButton.innerHTML = `<div class="w-full"><span class="font-semibold text-blue-800">${verseNumber}.</span> <span class="text-blue-900">${displayText}</span></div>`;
        } else {
            verseButton.className = 'text-left p-3 bg-gray-100 hover:bg-gray-200 rounded text-sm border w-full min-h-[60px] flex items-start';
            verseButton.innerHTML = `<div class="w-full"><span class="font-semibold text-blue-600">${verseNumber}.</span> <span class="text-gray-800">${displayText}</span></div>`;
        }
        
        verseButton.onclick = () => toggleNavigationVerse(verseNumber, verseText, verseButton);
        
        versesGrid.appendChild(verseButton);
    });
}

function toggleNavigationVerse(verseNumber, verseText, button) {
    const verseKey = `${selectedBook}-${selectedChapter}-${verseNumber}`;
    const existingIndex = playlistModeVerses.findIndex(v => v.key === verseKey);
    
    if (existingIndex >= 0) {
        // 从播放列表中移除
        playlistModeVerses.splice(existingIndex, 1);
        
        // 更新按钮样式为灰色
        button.className = 'text-left p-3 bg-gray-100 hover:bg-gray-200 rounded text-sm border w-full min-h-[60px] flex items-start';
        const maxLength = 60;
        const displayText = verseText.length > maxLength ? verseText.substring(0, maxLength) + '...' : verseText;
        button.innerHTML = `<div class="w-full"><span class="font-semibold text-blue-600">${verseNumber}.</span> <span class="text-gray-800">${displayText}</span></div>`;
        
        // 实时更新播放列表显示
        updatePlaylistModeDisplay();
    } else {
        // 添加到播放列表
        addVerseToPlaylistMode(selectedBook, selectedChapter, verseNumber, verseText);
        
        // 更新按钮样式为蓝色
        button.className = 'text-left p-3 bg-blue-200 border-blue-500 hover:bg-blue-300 rounded text-sm border-2 w-full min-h-[60px] flex items-start';
        const maxLength = 60;
        const displayText = verseText.length > maxLength ? verseText.substring(0, maxLength) + '...' : verseText;
        button.innerHTML = `<div class="w-full"><span class="font-semibold text-blue-800">${verseNumber}.</span> <span class="text-blue-900">${displayText}</span></div>`;
    }
}

 function confirmNavigationVerseSelection() {
    // 由于现在是实时添加，这里只需要关闭弹窗，不显示任何提示
    const bibleNavModal = document.getElementById('bible-navigation-modal');
    if (bibleNavModal) {
        bibleNavModal.classList.add('hidden');
    }
    
    // 清空选择状态，但保留已添加到播放列表的经节
    navigationVerses = [];
}

 function startVerseListPlayback() {
     if (versePlaylist.length === 0) {
         alert('播放列表为空，请先添加经节');
         return;
     }
     
     // 停止当前播放
     if (isPlaying) {
         speechSynthesis.cancel();
         removePlayingHighlight();
     }
     
     // 设置播放模式为经节模式
     playbackMode = 'verse';
     currentPlaylistIndex = 0;
     
     // 关闭经节列表模态框
     const verseListModal = document.getElementById('verse-list-modal');
     if (verseListModal) {
         verseListModal.classList.add('hidden');
     }
     
     // 开始播放列表
     playVerseFromPlaylist(0);
 }

 function playVerseFromPlaylist(index) {
     if (index >= versePlaylist.length) {
         // 播放列表结束
         isPlaying = false;
         updatePlayPauseButton();
         return;
     }
     
     const verseItem = versePlaylist[index];
     currentPlaylistIndex = index;
     
     // 更新播放状态
     isPlaying = true;
     isPaused = false;
     updatePlayPauseButton();
     
     // 创建语音合成
     const utterance = new SpeechSynthesisUtterance(verseItem.text);
     utterance.volume = settings.volume;
     utterance.rate = settings.rate;
     
     if (currentVoice) {
         utterance.voice = currentVoice;
     }
     
     utterance.onend = () => {
         // 播放下一个经节
         setTimeout(() => playVerseFromPlaylist(index + 1), 300);
     };
     
     utterance.onerror = (event) => {
         console.error('Speech synthesis error:', event.error);
         isPlaying = false;
         updatePlayPauseButton();
     };
     
     currentUtterance = utterance;
     speechSynthesis.speak(utterance);
 }

 // 折叠/展开功能
 function toggleSection(sectionName) {
     const content = document.getElementById(`${sectionName}-content`);
     const arrow = document.getElementById(`${sectionName}-arrow`);
     if (!content || !arrow) return;
     
     if (content.style.display === 'none') {
         // 展开时显示上箭头（rotate-180），符合“展开/收起图标互换”需求
         content.style.display = 'flex';
         arrow.classList.add('rotate-180');
     } else {
         // 收起时显示下箭头
         content.style.display = 'none';
         arrow.classList.remove('rotate-180');
     }
 }

// 播放列表模式相关变量
let playlistModeVerses = [];
let playlistSettings = {
    defaultLoopCount: 1,
    playbackMode: 'loop' // 'sequential', 'loop', 'random' - 默认为列表循环
};

function updatePlaylistModeDisplay() {
    const playlistDisplay = document.getElementById('playlist-display');
    if (!playlistDisplay) return;
    
    if (playlistModeVerses.length === 0) {
        playlistDisplay.innerHTML = '<div class="text-center text-gray-500 py-8">暂无播放列表，请添加经节</div>';
        return;
    }
    
    let html = '';
    playlistModeVerses.forEach((verse, index) => {
        const isCurrentlyPlaying = isPlaying && currentPlaylistIndex === index;
        
        // 根据显示模式获取经节文本
        let displayText = '';
        if (bibleData && bibleData[currentTestament] && bibleData[currentTestament][verse.book] && bibleData[currentTestament][verse.book][verse.chapter] && bibleData[currentTestament][verse.book][verse.chapter][verse.verse]) {
            const verseData = bibleData[currentTestament][verse.book][verse.chapter][verse.verse];
            
            if (settings.displayMode === 'chinese') {
                displayText = verseData.chinese || verse.text;
            } else if (settings.displayMode === 'english') {
                displayText = verseData.english || verse.text;
            } else if (settings.displayMode === 'bilingual') {
                const chineseText = verseData.chinese || '';
                const englishText = verseData.english || '';
                displayText = chineseText + (englishText ? ' ' + englishText : '');
            }
        } else {
            displayText = verse.text;
        }
        
        // 新布局：
        // - 第一行左侧显示出处，右侧竖排显示循环次数（更小）和删除“×”按钮
        // - 第二行经文字体占满整行
        html += `
            <div class="p-3 bg-white rounded-lg border ${isCurrentlyPlaying ? 'border-blue-500 bg-blue-50' : 'border-gray-200'} hover:border-gray-300 cursor-pointer" onclick="playPlaylistVerse(${index})">
                <div class="flex items-center justify-between">
                    <div class="flex-1">
                        <div class="font-medium text-sm text-gray-800">${verse.book} ${verse.chapter}:${verse.verse}</div>
                    </div>
                    <div class="flex items-center gap-2 ml-2 shrink-0 whitespace-nowrap">
                        <div class="text-xs text-blue-600 px-1 py-0.5 bg-blue-100 rounded">${verse.loopCount || 1}次</div>
                        <button onclick="event.stopPropagation(); removeFromPlaylistMode(${index})" class="text-red-500 hover:text-red-700 text-sm leading-none font-semibold" aria-label="删除">×</button>
                    </div>
                </div>
                <div class="mt-2 text-base text-gray-700 whitespace-pre-wrap">${displayText}</div>
            </div>
        `;
    });
    
    playlistDisplay.innerHTML = html;
}

function addCurrentChapterVersesToPlaylist() {
    // 打开当前章节经节选择弹窗
    const modal = document.getElementById('verse-list-modal');
    if (modal) {
        populateCurrentChapterVerses();
        modal.classList.remove('hidden');
    }
}

function addVerseToPlaylistMode(book, chapter, verse, text, loopCount = null) {
    // Use default loop count if not specified
    const actualLoopCount = loopCount || playlistSettings.defaultLoopCount;
    
    const newVerse = {
        book: book,
        chapter: chapter,
        verse: verse,
        text: text,
        loopCount: actualLoopCount,
        key: `${book}-${chapter}-${verse}` // 添加唯一标识符
    };
    
    // 检查是否已存在
    const exists = playlistModeVerses.some(v => 
        v.book === book && v.chapter === chapter && v.verse === verse
    );
    
    if (!exists) {
        playlistModeVerses.push(newVerse);
        updatePlaylistModeDisplay();
        // 实时更新详细设置中的播放列表显示
        if (typeof updateDetailedPlaylistDisplay === 'function') {
            updateDetailedPlaylistDisplay();
        }
    }
}

function removeFromPlaylistMode(index) {
    playlistModeVerses.splice(index, 1);
    updatePlaylistModeDisplay();
    // 实时更新详细设置中的播放列表显示
    if (typeof updateDetailedPlaylistDisplay === 'function') {
        updateDetailedPlaylistDisplay();
    }
    // 如果当前正在显示添加其他经节界面，需要刷新显示
    const versesGrid = document.getElementById('navigation-verses-grid');
    if (versesGrid && !document.getElementById('bible-navigation-modal').classList.contains('hidden')) {
        populateNavigationVerses();
    }
}

function clearPlaylistMode() {
    playlistModeVerses = [];
    updatePlaylistModeDisplay();
    // 如果当前正在显示添加其他经节界面，需要刷新显示
    const versesGrid = document.getElementById('navigation-verses-grid');
    if (versesGrid && !document.getElementById('bible-navigation-modal').classList.contains('hidden')) {
        populateNavigationVerses();
    }
    // 实时更新详细设置中的播放列表显示
    if (typeof updateDetailedPlaylistDisplay === 'function') {
        updateDetailedPlaylistDisplay();
    }
}

function playPlaylistVerse(index) {
    if (index >= 0 && index < playlistModeVerses.length) {
        currentPlaylistIndex = index;
        const verse = playlistModeVerses[index];
        
        // 停止当前播放
        stopPlayback();
        
        // 开始播放选中的经节
        isPlaying = true;
        updatePlayPauseButton();
        updatePlaylistModeDisplay();
        
        // 播放经节
        playPlaylistSequence(index);
    }
}

function playPlaylistSequence(startIndex) {
    if (!isPlaying || startIndex >= playlistModeVerses.length) {
        return;
    }
    
    const verse = playlistModeVerses[startIndex];
    const text = `${verse.book} 第${verse.chapter}章 第${verse.verse}节 ${verse.text}`;
    
    currentUtterance = new SpeechSynthesisUtterance(text);
    if (settings.voice && isValidVoice(settings.voice)) {
        currentUtterance.voice = settings.voice;
    }
    currentUtterance.volume = settings.volume;
    currentUtterance.rate = settings.rate;
    
    let currentLoop = 0;
    const maxLoops = verse.loopCount || 1;
    
    function playLoop() {
        if (!isPlaying || currentLoop >= maxLoops) {
            // 播放下一个经节
            playNextInPlaylist(startIndex);
            return;
        }
        
        currentUtterance.onend = function() {
            currentLoop++;
            if (currentLoop < maxLoops && isPlaying) {
                setTimeout(playLoop, 100);
            } else {
                // 播放下一个经节
                playNextInPlaylist(startIndex);
            }
        };
        
        speechSynthesis.speak(currentUtterance);
    }
    
    playLoop();
}

function playNextInPlaylist(currentIndex) {
    console.log('[播放列表] playNextInPlaylist 被调用，currentIndex:', currentIndex);
    console.log('[播放列表] playbackMode:', playlistSettings.playbackMode);
    console.log('[播放列表] 列表长度:', playlistModeVerses.length);
    
    const playbackMode = playlistSettings.playbackMode;
    let nextIndex;
    
    switch (playbackMode) {
        case 'sequential':
            console.log('[播放列表] 顺序播放模式');
            nextIndex = currentIndex + 1;
            if (nextIndex >= playlistModeVerses.length) {
                // 顺序播放完成，停止播放
                console.log('[播放列表] 顺序播放完成，停止');
                isPlaying = false;
                updatePlayPauseButton();
                updatePlaylistModeDisplay();
                return;
            }
            break;
            
        case 'loop':
            console.log('[播放列表] 列表循环模式');
            nextIndex = currentIndex + 1;
            if (nextIndex >= playlistModeVerses.length) {
                // 列表循环，重新开始
                console.log('[播放列表] 列表播放完毕，重新开始，nextIndex = 0');
                nextIndex = 0;
            }
            break;
            
        case 'random':
            console.log('[播放列表] 随机播放模式');
            // 随机播放
            if (playlistModeVerses.length > 1) {
                do {
                    nextIndex = Math.floor(Math.random() * playlistModeVerses.length);
                } while (nextIndex === currentIndex);
                console.log('[播放列表] 随机选择了索引:', nextIndex);
            } else {
                nextIndex = 0;
            }
            break;
            
        default:
            console.log('[播放列表] 默认模式（顺序）');
            nextIndex = currentIndex + 1;
            if (nextIndex >= playlistModeVerses.length) {
                isPlaying = false;
                updatePlayPauseButton();
                updatePlaylistModeDisplay();
                return;
            }
    }
    
    console.log('[播放列表] 下一个索引:', nextIndex);
    currentPlaylistIndex = nextIndex;
    updatePlaylistModeDisplay();
    playPlaylistSequence(nextIndex);
}