// 更新详细设置中的播放列表显示
function updateDetailedPlaylistDisplay() {
    const detailedPlaylistDisplay = document.getElementById('detailed-playlist-display');
    if (!detailedPlaylistDisplay) return;
    
    if (playlistModeVerses.length === 0) {
        detailedPlaylistDisplay.innerHTML = '<div class="text-center text-gray-500 py-4">暂无播放列表，请添加经节</div>';
        return;
    }
    
    let html = '';
    playlistModeVerses.forEach((verse, index) => {
        html += `
            <div class="flex items-center justify-between p-2 bg-white rounded border border-gray-200 mb-2">
                <div class="flex-1">
                    <div class="font-medium text-sm text-gray-800">${verse.book} ${verse.chapter}:${verse.verse}</div>
                    <div class="text-xs text-gray-600 mt-1">${verse.text.substring(0, 40)}${verse.text.length > 40 ? '...' : ''}</div>
                </div>
                <div class="flex items-center space-x-2 ml-4">
                    <div class="text-xs text-blue-600">
                        <input type="number" value="${verse.loopCount || 1}" min="1" max="100" 
                               class="w-12 px-1 py-0.5 text-xs border rounded text-center"
                               onchange="updateVerseLoopCount(${index}, this.value)">
                        次
                    </div>
                    <button onclick="removeFromPlaylistMode(${index})" class="px-2 py-1 bg-red-500 text-white rounded text-xs hover:bg-red-600">删除</button>
                </div>
            </div>
        `;
    });
    
    detailedPlaylistDisplay.innerHTML = html;
}

// 更新经节循环次数
function updateVerseLoopCount(index, newCount) {
    if (index >= 0 && index < playlistModeVerses.length) {
        playlistModeVerses[index].loopCount = parseInt(newCount) || 1;
        // 实时更新主播放列表显示
        updatePlaylistModeDisplay();
        // 实时更新详细设置中的播放列表显示
        updateDetailedPlaylistDisplay();
    }
}

// 初始化播放列表模式设置
function initializePlaylistModeSettings() {
    // 设置默认循环次数按钮事件
    const loopButtons = document.querySelectorAll('#playlist-mode-settings .loop-count-btn');
    loopButtons.forEach(button => {
        button.addEventListener('click', function() {
            // 移除其他按钮的选中状态
            loopButtons.forEach(btn => btn.classList.remove('bg-blue-500', 'text-white'));
            loopButtons.forEach(btn => btn.classList.add('bg-gray-200', 'text-gray-700'));
            
            // 设置当前按钮为选中状态
            this.classList.remove('bg-gray-200', 'text-gray-700');
            this.classList.add('bg-blue-500', 'text-white');
            
            // 更新默认循环次数
            const count = parseInt(this.textContent);
            if (!isNaN(count)) {
                playlistSettings.defaultLoopCount = count;
            }
        });
    });
    
    // 设置自定义循环次数输入框事件
    const customLoopInput = document.getElementById('playlist-custom-loop-count');
    if (customLoopInput) {
        customLoopInput.addEventListener('input', function() {
            const count = parseInt(this.value) || 1;
            playlistSettings.defaultLoopCount = count;
            
            // 取消其他按钮的选中状态
            loopButtons.forEach(btn => btn.classList.remove('bg-blue-500', 'text-white'));
            loopButtons.forEach(btn => btn.classList.add('bg-gray-200', 'text-gray-700'));
        });
    }
    
    // 设置播放模式按钮事件
    const playbackModeRadios = document.querySelectorAll('input[name="playlist-playback-mode"]');
    playbackModeRadios.forEach(radio => {
        radio.addEventListener('change', function() {
            if (this.checked) {
                playlistSettings.playbackMode = this.value;
            }
        });
    });
}