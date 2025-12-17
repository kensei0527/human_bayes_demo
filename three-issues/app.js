/**
 * アプリケーションメインスクリプト（3論点版）
 * UI制御とゲームロジックの連携
 */

// =============================================================================
// UX設定
// =============================================================================

// 【仕様1】スライダーを離した時にアプライ（ベイズ更新も実行）
const APPLY_MODE = 'ON_RELEASE';

// グローバル変数
let game;
let thetaChart;
let wChart;
let posteriorVisible = true;  // 事後分布表示のON/OFF状態

// アイテム絵文字（3論点）
const ITEM_ICONS = ['🍎', '🍋', '🍇'];

// w成分の色定義（tab10カラーマップ）
const W_COLORS = [
    { line: '#1f77b4', fill: 'rgba(31, 119, 180, 0.3)' },   // w1: 青
    { line: '#ff7f0e', fill: 'rgba(255, 127, 14, 0.3)' },   // w2: オレンジ
    { line: '#2ca02c', fill: 'rgba(44, 160, 44, 0.3)' }     // w3: 緑
];

// 感情ラベルマッピング
const EMOTION_LABELS = {
    '-1': { label: '😠', fullLabel: '😠 ANGER', class: 'anger' },
    '0': { label: '😐', fullLabel: '😐 NEUTRAL', class: 'neutral' },
    '1': { label: '🙂', fullLabel: '🙂 JOY 1', class: 'joy1' },
    '2': { label: '😊', fullLabel: '😊 JOY 2', class: 'joy2' },
    '3': { label: '😄', fullLabel: '😄 JOY 3', class: 'joy3' },
    '4': { label: '😁', fullLabel: '😁 JOY 4', class: 'joy4' },
    '5': { label: '🤩', fullLabel: '🤩 JOY 5', class: 'joy5' },
    '6': { label: '🥳', fullLabel: '🥳 JOY 6', class: 'joy6' },
    '7': { label: '🎉', fullLabel: '🎉 JOY 7', class: 'joy7' }
};

// =============================================================================
// 初期化
// =============================================================================

document.addEventListener('DOMContentLoaded', () => {
    initGame();
    setupEventListeners();
    initCharts();
    updateItemDisplays();
    updateWSelfDisplays();
    createWLegend();
});

function initGame() {
    game = new NegotiationGame();
    document.getElementById('roundNumber').textContent = game.round;
    document.getElementById('revealArea').classList.add('hidden');
    
    // 感情表示をリセット
    const emotionContainer = document.getElementById('emotionContainer');
    const emotionDisplay = document.getElementById('emotionDisplay');
    emotionContainer.className = 'emotion-container neutral';
    emotionDisplay.className = 'emotion-display neutral';
    emotionDisplay.querySelector('.emotion-icon').textContent = '😐';
    document.getElementById('emotionText').textContent = 'NEUTRAL';
    
    // 履歴をクリア
    document.getElementById('historyLog').innerHTML = '<p class="history-placeholder">まだオファーがありません...</p>';
    
    // アイテム表示を初期化
    updateItemDisplays();
    
    // チャートをリセット
    if (thetaChart && wChart) {
        resetCharts();
    }
}

function setupEventListeners() {
    // 縦スライダーイベント（3論点）
    for (let i = 1; i <= 3; i++) {
        const slider = document.getElementById(`slider${i}`);
        
        // スライド中に表示を更新
        slider.addEventListener('input', () => {
            updateItemDisplays();
            
            // リアルタイムプレビューモード
            if (APPLY_MODE === 'REALTIME_PREVIEW') {
                previewEmotion();
            }
        });
        
        // スライダーを離した時にアプライ
        slider.addEventListener('change', () => {
            applyOffer();
        });
    }
    
    // W_SELFスライダーイベント（3論点）
    for (let i = 1; i <= 3; i++) {
        const slider = document.getElementById(`wself${i}`);
        slider.addEventListener('input', () => updateWSelfDisplays());
    }
    
    // W_SELF適用ボタン
    document.getElementById('applyWselfBtn').addEventListener('click', applyWSelf);
    
    // New Gameボタン
    document.getElementById('newGameBtn').addEventListener('click', () => {
        initGame();
        resetSliders();
    });
    
    // 正解を見るボタン
    document.getElementById('revealBtn').addEventListener('click', revealAnswer);
    
    // 事後分布表示切替ボタン
    document.getElementById('togglePosteriorBtn').addEventListener('click', togglePosterior);
}

// =============================================================================
// アイテム表示の更新（3論点用）
// =============================================================================

function updateItemDisplays() {
    const Q = CONFIG.Q;
    
    for (let i = 1; i <= 3; i++) {
        const slider = document.getElementById(`slider${i}`);
        const sliderVal = parseInt(slider.value);
        // スライダーを上に動かすとselfが増える（反転）
        const selfVal = Q[i - 1] - sliderVal;
        const otherVal = sliderVal;
        
        // カウント表示を更新
        document.getElementById(`selfCount${i}`).textContent = selfVal;
        document.getElementById(`otherCount${i}`).textContent = otherVal;
        
        // アイテムアイコンを更新
        updateItemIcons(`selfItems${i}`, selfVal, ITEM_ICONS[i - 1]);
        updateItemIcons(`otherItems${i}`, otherVal, ITEM_ICONS[i - 1]);
    }
}

function updateItemIcons(containerId, count, icon) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    
    for (let j = 0; j < count; j++) {
        const span = document.createElement('span');
        span.className = 'item-icon';
        span.textContent = icon;
        span.style.animationDelay = `${j * 0.05}s`;
        container.appendChild(span);
    }
}

function resetSliders() {
    for (let i = 1; i <= 3; i++) {
        const slider = document.getElementById(`slider${i}`);
        // 初期状態：全部相手側（スライダー最大値）
        slider.value = slider.max;
    }
    updateItemDisplays();
}

function getCurrentOffer() {
    const Q = CONFIG.Q;
    return [
        Q[0] - parseInt(document.getElementById('slider1').value),
        Q[1] - parseInt(document.getElementById('slider2').value),
        Q[2] - parseInt(document.getElementById('slider3').value)
    ];
}

// =============================================================================
// W_SELF スライダー制御
// =============================================================================

function updateWSelfDisplays() {
    for (let i = 1; i <= 3; i++) {
        const slider = document.getElementById(`wself${i}`);
        const value = parseInt(slider.value);
        document.getElementById(`wself${i}-display`).textContent = value;
    }
}

function getCurrentWSelf() {
    return [
        parseInt(document.getElementById('wself1').value),
        parseInt(document.getElementById('wself2').value),
        parseInt(document.getElementById('wself3').value)
    ];
}

function applyWSelf() {
    const newWSelf = getCurrentWSelf();
    game.updateWSelf(newWSelf);
    
    // UIをリセット
    document.getElementById('roundNumber').textContent = game.round;
    document.getElementById('revealArea').classList.add('hidden');
    
    // 感情表示をリセット
    const emotionDisplay = document.getElementById('emotionDisplay');
    emotionDisplay.className = 'emotion-display neutral';
    emotionDisplay.querySelector('.emotion-icon').textContent = '😐';
    
    // 履歴をクリア
    document.getElementById('historyLog').innerHTML = '<p class="history-placeholder">W_SELFを更新しました</p>';
    
    // チャートをリセット
    resetCharts();
    resetSliders();
}

function createWLegend() {
    const legendContainer = document.getElementById('wLegend');
    legendContainer.innerHTML = '';
    
    const labels = ['w1 (🍎)', 'w2 (🍋)', 'w3 (🍇)'];
    
    for (let i = 0; i < 3; i++) {
        const item = document.createElement('div');
        item.className = 'w-legend-item';
        item.innerHTML = `
            <div class="w-legend-color" style="background-color: ${W_COLORS[i].line}"></div>
            <span>${labels[i]}</span>
        `;
        legendContainer.appendChild(item);
    }
}

// =============================================================================
// 事後分布表示の切り替え
// =============================================================================

function togglePosterior() {
    posteriorVisible = !posteriorVisible;
    const content = document.getElementById('posteriorContent');
    const btn = document.getElementById('togglePosteriorBtn');
    
    if (posteriorVisible) {
        content.classList.remove('hidden');
        btn.textContent = '🙈 隠す';
        btn.classList.remove('hidden-mode');
    } else {
        content.classList.add('hidden');
        btn.textContent = '👁 表示';
        btn.classList.add('hidden-mode');
    }
}

// =============================================================================
// オファー適用
// =============================================================================

function previewEmotion() {
    const offer = getCurrentOffer();
    const emotion = game.engine.computeTrueEmotion(offer, game.trueTheta, game.trueW);
    updateEmotionDisplay(emotion, true);
}

function applyOffer() {
    const offer = getCurrentOffer();
    const result = game.applyOffer(offer);
    
    // ラウンド表示更新
    document.getElementById('roundNumber').textContent = result.round;
    
    // 感情表示更新
    updateEmotionDisplay(result.emotion, false);
    
    // 履歴更新
    addHistoryEntry(result.round, offer, result.emotion);
    
    // チャート更新
    updateCharts(result);
    
    // 統計表示更新
    document.getElementById('thetaEstimate').textContent = result.thetaMean.toFixed(1);
    document.getElementById('wEstimate').textContent = result.wMean.map(v => v.toFixed(2)).join(', ');
}

function updateEmotionDisplay(emotion, isPreview = false) {
    const emotionData = EMOTION_LABELS[emotion.toString()];
    const emotionContainer = document.getElementById('emotionContainer');
    const emotionDisplay = document.getElementById('emotionDisplay');
    const emotionText = document.getElementById('emotionText');
    
    // コンテナに感情クラスを追加（テキスト色変更用）
    emotionContainer.className = `emotion-container ${emotionData.class}`;
    
    let displayClass = `emotion-display ${emotionData.class}`;
    if (isPreview) {
        displayClass += ' preview';
    }
    emotionDisplay.className = displayClass;
    emotionDisplay.querySelector('.emotion-icon').textContent = emotionData.label;
    
    // テキストラベルを更新
    const textLabel = emotionData.fullLabel.split(' ').slice(1).join(' ');
    emotionText.textContent = textLabel;
}

function addHistoryEntry(round, offer, emotion) {
    const historyLog = document.getElementById('historyLog');
    
    // プレースホルダーを削除
    const placeholder = historyLog.querySelector('.history-placeholder');
    if (placeholder) {
        placeholder.remove();
    }
    
    const emotionData = EMOTION_LABELS[emotion.toString()];
    const emotionClass = emotion < 0 ? 'anger' : (emotion === 0 ? 'neutral' : 'joy');
    
    const entry = document.createElement('div');
    entry.className = `history-entry ${emotionClass}`;
    entry.innerHTML = `<strong>R${round}:</strong> [${offer.join(', ')}] → ${emotionData.label}`;
    
    // 先頭に追加
    historyLog.insertBefore(entry, historyLog.firstChild);
}

// =============================================================================
// チャート制御
// =============================================================================

function initCharts() {
    // θチャート
    const thetaCtx = document.getElementById('thetaChart').getContext('2d');
    thetaChart = new Chart(thetaCtx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'p(θ)',
                data: [],
                borderColor: '#667eea',
                backgroundColor: 'rgba(102, 126, 234, 0.2)',
                fill: true,
                tension: 0.3,
                pointRadius: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: {
                    title: { display: true, text: 'θ (degrees)' }
                },
                y: {
                    title: { display: true, text: 'Probability' },
                    beginAtZero: true
                }
            }
        }
    });
    
    // wチャート（3成分）
    const wCtx = document.getElementById('wChart').getContext('2d');
    wChart = new Chart(wCtx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'w1',
                    data: [],
                    borderColor: W_COLORS[0].line,
                    backgroundColor: W_COLORS[0].fill,
                    fill: true,
                    tension: 0.3,
                    pointRadius: 0
                },
                {
                    label: 'w2',
                    data: [],
                    borderColor: W_COLORS[1].line,
                    backgroundColor: W_COLORS[1].fill,
                    fill: true,
                    tension: 0.3,
                    pointRadius: 0
                },
                {
                    label: 'w3',
                    data: [],
                    borderColor: W_COLORS[2].line,
                    backgroundColor: W_COLORS[2].fill,
                    fill: true,
                    tension: 0.3,
                    pointRadius: 0
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: {
                    title: { display: true, text: 'w value' }
                },
                y: {
                    title: { display: true, text: 'Probability' },
                    beginAtZero: true
                }
            }
        }
    });
    
    // 初期データ設定
    resetCharts();
}

function resetCharts() {
    // θチャートリセット
    const thetaValues = game.engine.paramSpace.thetaValues;
    const thetaMarginal = game.engine.paramSpace.getMarginalTheta();
    
    thetaChart.data.labels = thetaValues.map(v => v.toString());
    thetaChart.data.datasets[0].data = thetaValues.map(v => thetaMarginal[v]);
    thetaChart.update();
    
    // wチャートリセット
    const wValues = game.engine.paramSpace.wComponentValues;
    const wMarginals = game.engine.paramSpace.getMarginalWComponents();
    
    wChart.data.labels = wValues.map(v => v.toString());
    for (let i = 0; i < 3; i++) {
        wChart.data.datasets[i].data = wValues.map(v => wMarginals[i][v]);
    }
    wChart.update();
    
    // 統計表示リセット
    document.getElementById('thetaEstimate').textContent = '-';
    document.getElementById('wEstimate').textContent = '-, -, -';
}

function updateCharts(result) {
    // θチャート更新
    const thetaValues = game.engine.paramSpace.thetaValues;
    thetaChart.data.datasets[0].data = thetaValues.map(v => result.marginalTheta[v]);
    thetaChart.update();
    
    // wチャート更新
    const wValues = game.engine.paramSpace.wComponentValues;
    for (let i = 0; i < 3; i++) {
        wChart.data.datasets[i].data = wValues.map(v => result.marginalW[i][v]);
    }
    wChart.update();
}

// =============================================================================
// 正解表示
// =============================================================================

function revealAnswer() {
    const trueParams = game.getTrueParameters();
    
    document.getElementById('trueTheta').textContent = trueParams.theta;
    document.getElementById('trueW').textContent = trueParams.w.join(', ');
    document.getElementById('patternName').textContent = trueParams.patternName;
    document.getElementById('patternDesc').textContent = trueParams.patternDescription || '';
    
    document.getElementById('revealArea').classList.remove('hidden');
}
