# 圣经朗读应用（Bible Reader）项目说明

本项目是一个基于浏览器语音合成（Web Speech API）的圣经朗读应用，提供章节朗读、经节朗读、以及自定义播放列表等功能。本文档详细说明项目的算法实现、功能设计、UI 布局、文件结构、JSON 数据读取与使用方式，以及运行方法与扩展建议。

## 功能总览
- 章节朗读：从指定章节按顺序朗读全部经节，支持章节结束后的行为配置（继续下一章、循环本章、随机跳转）。
- 经节朗读：支持单节循环朗读、当前章节内随机朗读。3
- 自定义播放列表：可将多个经节加入列表，设置每个经节的循环次数，按顺序播放。
- 显示模式：中文 / 英文 / 中英双语三种显示与朗读组合。
- 播放控制：播放 / 暂停 / 继续、上一章 / 下一章导航、返回章节 / 返回总览。
- 设置管理：详细设置面板支持播放模式切换与参数配置，设置持久化（localStorage）。

## 核心算法与实现

### 1. 语音合成与并发控制
- 使用 `SpeechSynthesisUtterance` 创建朗读对象，并设置 `volume`、`rate`、`voice`。
- 通过 `onstart`、`onend`、`onerror` 事件驱动下一步播放逻辑，并处理 UI 高亮。
- 使用 `waitForSpeechIdle()` 等待引擎空闲，避免取消旧朗读时产生排队与交叉触发。
- 使用 `latestPlayRequestId` 丢弃过期的点击请求，避免快速点击产生的并发问题。
- 使用 `isSwitchingVerse` 在切换经节过程中屏蔽旧的 `onend/onerror` 清理与续播，保证高亮与序列的正确性。

相关位置：`js/verse.js` 中的 `playSpecificVerseWithLoop()`、`playSpecificVerse()`、`playVerseSequence()`、`waitForSpeechIdle()`、`forceStopSpeech()` 等。

### 2. 章节朗读算法
- 入口函数：`startChapterPlayback()` 或带章节名的 `startChapterPlaybackWithName()`。
- 流程：
  - 停止当前播放、清理高亮、重置章节循环计数器。
  - 朗读章节名（可选），然后调用 `playVerseSequence(verseNumbers, startIndex, loopCount)` 按序播放。
  - 在 `playSpecificVerse()` 的 `onend` 中，依据当前经节位置继续下一节；到达章节尾部时，调用 `handleChapterEnd()`。
- 章节结束行为：
  - `settings.chapterEndAction === 'next'`：顺序到下一章朗读（跨书卷自动导航）。
  - `settings.chapterEndAction === 'loop'`：循环本章（可受 `settings.infiniteLoop` 与 `settings.verseLoopCount` 控制循环次数）。
  - `settings.chapterEndAction === 'random'`：随机跳转到随机章节。

相关位置：`js/verse.js` 的 `startChapterPlaybackWithName()`、`playSpecificVerse()`、`handleChapterEnd()`、`navigateChapter()`、`navigateToNextBook()`、`navigateToPrevBook()`、`navigateToRandomChapter()`。

### 3. 经节朗读算法（循环与随机）
- 单节循环：
  - 入口：`playSpecificVerseWithLoop(verseNumber)`。
  - 逻辑：在 `onend` 中根据 `settings.infiniteLoop` 与 `settings.verseLoopCount` 控制重复播放；循环结束后停止并清理高亮。
- 当前章节随机朗读：
  - 入口：`startRandomVersePlayback()`（会将播放模式设置为经节模式，且 `settings.versePlaybackMode = 'chapter-random'`）。
  - 随机策略：
    - 初始化 `randomVersePool = [当前章节的所有经节号]`。
    - `playRandomVerse()` 每次从池中等概率选择一个经节，选择后从池中移除，避免立即重复。
    - 当池为空时，自动重新填充，确保持续可播。
    - 通过 `randomPlaybackCount` 与 `targetRandomPlaybackCount` 控制随机播放次数（受 `settings.infiniteLoop/verseLoopCount` 影响）。
  - 错误容忍：若某经节不存在或出现错误，则短暂延时后继续随机播放下一个。

相关位置：`js/verse.js` 的 `startRandomVersePlayback()`、`playRandomVerse()`、`playSpecificRandomVerse()`、`startRandomVerseInCurrentChapter()`。

### 4. 播放列表算法（Playlist）
- 数据结构：`playlistModeVerses = [{ book, chapter, verse, text, loopCount, key }, ...]`。
- 播放：`playPlaylistSequence(startIndex)` 以顺序模式播放当前列表；每个经节按其 `loopCount` 播放若干次后进入下一个。
- 列表管理：支持添加当前章节经节、从其它章节选择经节、删除、清空，UI 中提供循环次数设置与显示。
- 模式设置：`playlistSettings.playbackMode = 'sequential' | 'loop' | 'random'`，目前核心顺序播放已实现，模式选项在设置面板中准备好，后续可扩展为循环/随机策略。

相关位置：`js/verse.js` 的 `updatePlaylistModeDisplay()`、`addCurrentChapterVersesToPlaylist()`、`addVerseToPlaylistMode()`、`removeFromPlaylistMode()`、`clearPlaylistMode()`；`js/verse_detailed_playlist.js` 的 `updateDetailedPlaylistDisplay()`、`initializePlaylistModeSettings()`。

### 5. 点击经节的行为与模式保持
- 在“章节朗读模式”点击某一经节：不会改变播放模式；应用从该经节开始继续章节朗读（保持顺序直至本章结束）。
- 在“经节朗读模式”点击某一经节：播放该单节（遵循单节循环或章节随机设置）。
- 关键点：移除了点击时强制 `playbackMode = 'verse'` 的旧逻辑，确保“播放模式只能手动切换”。同时调整 `startChapterPlayback()` 以尊重外部设置的 `currentVerseIndex`，保证能从点击的经节开始。

相关位置：`js/verse.js` 的 `handleVerseClick()` 与 `startChapterPlayback()`。

## UI 布局与交互

### 1. 首页（`index.html`）
- 布局：左右两列分别展示旧约、新约的书卷卡片，使用 Tailwind CSS 样式。
- 数据：`js/main.js` 读取 `bible-data.json`，统计各书卷的章数并生成链接。

### 2. 章节选择页（`chapter.html`）
- 顶部：返回总览按钮、居中书卷标题。
- 主体：章节网格列表（数字顺序），点击进入经节朗读页。
- 数据：`js/chapter.js` 根据 `testament` 与 `book` 参数读取 `bible-data.json` 并渲染。

### 3. 经节朗读页（`verse.html`）
- 顶部第一行（导航与标题）：返回总览、返回章节按钮；章节标题；“设置”按钮。
- 顶部第二行（控制区）：
  - 播放模式下拉：`章节朗读 / 经节朗读 / 自定义列表`。
  - 详细设置按钮：打开设置面板（根据不同模式显示不同设置块）。
- 详细设置模态框：
  - 章节模式设置：章节结束行为（下一章/循环/随机）。
  - 经节模式设置：单节循环次数、是否无限循环、当前章节随机播放。
  - 播放列表设置：默认循环次数、播放模式（预留）。
  - 详细播放列表：实时显示已添加的播放列表项，支持删除、调整循环次数。
- 主内容区：
  - 默认内容：当前章节的经节列表卡片，点击可播放或选择。
  - 播放列表内容：展示播放列表并可点击播放指定项。
- 其它弹窗：圣经导航弹窗（选择其它书卷/章节/经节加入播放列表）。
- 样式：Tailwind CSS + `css/styles.css` 的适配与缩小规则，保证在移动端的紧凑展示。

## 文件结构
```
websj1.1/
├── bible-data.json               # 圣经数据（旧约/新约 → 书卷 → 章节 → 经节）
├── index.html                    # 首页：旧约/新约书卷总览
├── chapter.html                  # 章节选择页
├── verse.html                    # 经节朗读页（核心）
├── js/
│   ├── main.js                   # 首页数据加载与书卷列表渲染
│   ├── chapter.js                # 章节页数据加载与章节列表渲染
│   ├── verse.js                  # 朗读逻辑、播放模式与详细设置、列表管理
│   └── verse_detailed_playlist.js# 详细播放列表 UI 与设置事件
├── css/
│   └── styles.css                # 细粒度样式调整（移动端适配、控件缩小等）
├── verse-list-modal.html         # 当前章节经节选择弹窗模板
├── 圣经朗读应用开发文档.md       # 开发文档与设计说明
└── 圣经经节.txt                   # 文本资源（可选）
```

## JSON 数据结构与读取使用

### 数据结构（示例）
```json
{
  "旧约": {
    "创世记": {
      "1": {
        "1": { "chinese": "起初…", "english": "In the beginning…" },
        "2": { "chinese": "…", "english": "…" }
      }
    }
  },
  "新约": { /* 同上结构 */ }
}
```
- 层级为 `约别 → 书卷 → 章节 → 经节 → 文本对象`。
- 文本对象通常含 `chinese`/`english` 字段；在某些情况下可能直接是字符串（代码已兼容）。

### 读取与使用
- 首页：`js/main.js` 在 `DOMContentLoaded` 后 `fetch('bible-data.json')`，读取后遍历书卷生成链接。
- 章节页：`js/chapter.js` 读取 `URLSearchParams` 中的 `testament` 与 `book`，再 `fetch('bible-data.json')` 并渲染章节列表（按数字排序）。
- 经节页：`js/verse.js` 读取 `book`、`chapter` 参数，并根据实际数据结构判定 `currentTestament`（旧约/新约），随后渲染经节卡片，驱动朗读逻辑。
- 显示模式：在 `loadChapterVerses()` / `playSpecificVerse*()` 等函数中，根据 `settings.displayMode` 动态选择 `chinese/english/bilingual` 文本。

## 设置与持久化
- 设置对象：
  - `volume`（音量，默认 1.0）、`rate`（语速，默认 1.2）、`voice`（朗读声音）。
  - `displayMode`：`'chinese' | 'english' | 'bilingual'`。
  - `chapterEndAction`：`'next' | 'loop' | 'random'`。
  - `versePlaybackMode`：`'single-loop' | 'chapter-random'`。
  - `verseLoopCount`、`infiniteLoop`、`customLoopCount`。
- 持久化：`saveSettings()` / `loadSettings()` 将设置保存到 `localStorage`（排除 `voice` 字段，因为它不可序列化）。

## 运行与调试
- 启动本地服务器（Windows）：在项目根目录执行：
  - `python -m http.server 8000`
- 打开浏览器访问：
  - 首页：`http://localhost:8000/index.html`
  - 章节页：`http://localhost:8000/chapter.html?testament=旧约&book=创世记`
  - 经节页：`http://localhost:8000/verse.html?book=创世记&chapter=1`
- 浏览器要求：支持 Web Speech API（如最新版 Chrome）。首次加载可能需调用 `speechSynthesis.getVoices()` 后短暂等待可用声音列表。

## 重要交互与边界处理
- 模式保持：点击经节不会自动改变播放模式；模式只可通过顶部模式下拉手动切换。
- 高亮控制：在播放开始高亮当前经节，结束或错误时清理；切换经节期间避免误清理。
- 并发点击与取消：最新点击拥有令牌，旧点击会被忽略；停止播放时强制取消旧 `utterance` 并等待引擎空闲。
- 随机播放容错：经节缺失或合成报错会自动尝试下一个随机经节。

## 可扩展性建议
- 播放列表模式：完善 `loop` 与 `random` 两种列表播放策略（目前核心实现为顺序）。
- 语音选择：在设置中提供声音列表下拉；记住用户选择并在可用时自动回填。
- 数据扩展：在 `bible-data.json` 增加更多元数据（小标题、注释），并在 UI 中提供可选显示。
- 国际化：增强 UI 文本的 i18n 支持（目前以中文为主）。

## 变更与修复摘要（近期）
- 修复“章节朗读模式下点击经节会切到经节模式”的问题：改为保持当前模式，并从点击的经节继续章节朗读。
- 调整 `startChapterPlayback()`：仅在无索引或越界时重置为 0，保留从指定经节开始的能力。
- 简化随机播放错误处理：保留高亮与播放状态的一致性，错误后继续随机选择。

---
如需进一步了解具体实现细节，请直接浏览 `js/verse.js`、`js/chapter.js`、`js/main.js` 与 `js/verse_detailed_playlist.js` 中的对应函数。若你希望新增功能，我可根据以上结构快速扩展并保持代码风格一致。