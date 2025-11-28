/**
 * アプリケーションメインスクリプト
 * UI制御とゲームロジックの連携
 */

// =============================================================================
// UX設定（コメントアウトで切り替え可能）
// =============================================================================

// 【仕様1】スライダーを離した時にアプライ（ベイズ更新も実行）
const APPLY_MODE = 'ON_RELEASE';

// 【仕様2】スライド中もリアルタイムで表情変化（プレビューのみ、ベイズ更新はリリース時）
// const APPLY_MODE = 'REALTIME_PREVIEW';

// グローバル変数
let game;
let thetaChart;
let wChart;

// w成分の色定義（plot_posteriors_per_roundと同様のtab10カラーマップ）
const W_COLORS = [
    { line: '#1f77b4', fill: 'rgba(31, 119, 180, 0.3)' },   // w1: 青
    { line: '#ff7f0e', fill: 'rgba(255, 127, 14, 0.3)' },   // w2: オレンジ
    { line: '#2ca02c', fill: 'rgba(44, 160, 44, 0.3)' },    // w3: 緑
    { line: '#d62728', fill: 'rgba(214, 39, 40, 0.3)' }     // w4: 赤
];

// 感情ラベルマッピング
const EMOTION_LABELS = {
    '-1': { label: '😠 ANGER', class: 'anger' },
    '0': { label: '😐 NEUTRAL', class: 'neutral' },
    '1': { label: '🙂 JOY 1', class: 'joy1' },
    '2': { label: '😊 JOY 2', class: 'joy2' },
    '3': { label: '😄 JOY 3', class: 'joy3' },
    '4': { label: '😁 JOY 4', class: 'joy4' },
    '5': { label: '🤩 JOY 5', class: 'joy5' },
    '6': { label: '🥳 JOY 6', class: 'joy6' },
    '7': { label: '🎉 JOY 7', class: 'joy7' }
};

// =============================================================================
// 初期化
// =============================================================================

document.addEventListener('DOMContentLoaded', () => {
    initGame();
    setupEventListeners();
    initCharts();
    updateSliderDisplays();
    updateWSelfDisplays();
    createWLegend();
});

function initGame() {
    game = new NegotiationGame();
    document.getElementById('roundNumber').textContent = game.round;
    document.getElementById('revealArea').classList.add('hidden');
    
    // 感情表示をリセット
    const emotionDisplay = document.getElementById('emotionDisplay');
    emotionDisplay.className = 'emotion-display neutral';
    emotionDisplay.querySelector('.emotion-label').textContent = '😐 NEUTRAL';
    
    // 履歴をクリア
    document.getElementById('historyLog').innerHTML = '<p class="history-placeholder">まだオファーがありません...</p>';
    
    // チャートをリセット
    if (thetaChart && wChart) {
        resetCharts();
    }
}

function setupEventListeners() {
    // オファースライダーイベント
    for (let i = 1; i <= 4; i++) {
        const slider = document.getElementById(`slider${i}`);
        
        // 常に表示を更新
        slider.addEventListener('input', () => {
            updateSliderDisplays();
            
            // 【仕様2】リアルタイムプレビューモード: スライド中も表情を即時更新（ベイズ更新なし）
            if (APPLY_MODE === 'REALTIME_PREVIEW') {
                previewEmotion();
            }
        });
        
        // スライダーを離した時にアプライ（両仕様共通でベイズ更新を実行）
        slider.addEventListener('change', () => {
            applyOffer();
        });
    }
    
    // W_SELFスライダーイベント
    for (let i = 1; i <= 4; i++) {
        const slider = document.getElementById(`wself${i}`);
        slider.addEventListener('input', () => updateWSelfDisplays());
    }
    
    // Applyボタン（手動適用も残す）
    document.getElementById('applyBtn').addEventListener('click', applyOffer);
    
    // W_SELF適用ボタン
    document.getElementById('applyWselfBtn').addEventListener('click', applyWSelf);
    
    // New Gameボタン
    document.getElementById('newGameBtn').addEventListener('click', () => {
        initGame();
        resetSliders();
    });
    
    // 正解を見るボタン
    document.getElementById('revealBtn').addEventListener('click', revealAnswer);
}

// =============================================================================
// スライダー制御
// =============================================================================

function updateSliderDisplays() {
    const Q = CONFIG.Q;
    
    for (let i = 1; i <= 4; i++) {
        const slider = document.getElementById(`slider${i}`);
        const selfVal = parseInt(slider.value);
        const otherVal = Q[i - 1] - selfVal;
        
        document.getElementById(`self${i}`).textContent = selfVal;
        document.getElementById(`other${i}`).textContent = otherVal;
        
        // テーブル更新
        document.getElementById(`tblSelf${i}`).textContent = selfVal;
        document.getElementById(`tblOther${i}`).textContent = otherVal;
        
        // 配分バー更新
        const percentage = (selfVal / Q[i - 1]) * 100;
        const bars = document.querySelectorAll('.self-bar');
        if (bars[i - 1]) {
            bars[i - 1].style.width = `${percentage}%`;
        }
    }
}

function resetSliders() {
    for (let i = 1; i <= 4; i++) {
        document.getElementById(`slider${i}`).value = 0;
    }
    updateSliderDisplays();
}

function getCurrentOffer() {
    return [
        parseInt(document.getElementById('slider1').value),
        parseInt(document.getElementById('slider2').value),
        parseInt(document.getElementById('slider3').value),
        parseInt(document.getElementById('slider4').value)
    ];
}

// =============================================================================
// W_SELF スライダー制御
// =============================================================================

function updateWSelfDisplays() {
    for (let i = 1; i <= 4; i++) {
        const slider = document.getElementById(`wself${i}`);
        const value = parseInt(slider.value);
        document.getElementById(`wself${i}-display`).textContent = value;
    }
}

function getCurrentWSelf() {
    return [
        parseInt(document.getElementById('wself1').value),
        parseInt(document.getElementById('wself2').value),
        parseInt(document.getElementById('wself3').value),
        parseInt(document.getElementById('wself4').value)
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
    emotionDisplay.querySelector('.emotion-label').textContent = '😐 NEUTRAL';
    
    // 履歴をクリア
    document.getElementById('historyLog').innerHTML = '<p class="history-placeholder">W_SELFを更新しました。新しいオファーを試してください...</p>';
    
    // チャートをリセット
    resetCharts();
    resetSliders();
}

function createWLegend() {
    const legendContainer = document.getElementById('wLegend');
    legendContainer.innerHTML = '';
    
    const labels = ['w1', 'w2', 'w3', 'w4'];
    
    for (let i = 0; i < 4; i++) {
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
// オファー適用
// =============================================================================

/**
 * 表情のプレビュー表示（ベイズ更新なし）
 * リアルタイムモード用：スライド中に表情だけ変化させる
 */
function previewEmotion() {
    const offer = getCurrentOffer();
    
    // ゲームの内部状態を変更せずに感情だけ計算
    const emotion = game.emotionModel.sampleEmotion(offer, game.trueTheta, game.trueW);
    
    // 表情表示を更新（プレビュー用のスタイルを追加）
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
    const emotionDisplay = document.getElementById('emotionDisplay');
    
    // クラスをリセットして新しいクラスを適用
    let className = `emotion-display ${emotionData.class}`;
    if (isPreview) {
        className += ' preview';  // プレビュー時は追加クラス
    }
    emotionDisplay.className = className;
    emotionDisplay.querySelector('.emotion-label').textContent = emotionData.label;
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
            maintainAspectRatio: true,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: {
                    title: { display: true, text: 'θ (度)' }
                },
                y: {
                    title: { display: true, text: '確率' },
                    min: 0,
                    max: 1
                }
            }
        }
    });
    
    // wチャート（成分ごとの周辺分布 - plot_posteriors_per_roundスタイル）
    const wCtx = document.getElementById('wChart').getContext('2d');
    wChart = new Chart(wCtx, {
        type: 'line',
        data: {
            labels: [-4, -3, -2, -1, 0, 1, 2, 3, 4],
            datasets: [
                {
                    label: 'w1',
                    data: [],
                    borderColor: W_COLORS[0].line,
                    backgroundColor: W_COLORS[0].fill,
                    fill: false,
                    tension: 0,
                    pointRadius: 4,
                    pointStyle: 'circle'
                },
                {
                    label: 'w2',
                    data: [],
                    borderColor: W_COLORS[1].line,
                    backgroundColor: W_COLORS[1].fill,
                    fill: false,
                    tension: 0,
                    pointRadius: 4,
                    pointStyle: 'circle'
                },
                {
                    label: 'w3',
                    data: [],
                    borderColor: W_COLORS[2].line,
                    backgroundColor: W_COLORS[2].fill,
                    fill: false,
                    tension: 0,
                    pointRadius: 4,
                    pointStyle: 'circle'
                },
                {
                    label: 'w4',
                    data: [],
                    borderColor: W_COLORS[3].line,
                    backgroundColor: W_COLORS[3].fill,
                    fill: false,
                    tension: 0,
                    pointRadius: 4,
                    pointStyle: 'circle'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: {
                    title: { display: true, text: '成分値' },
                    min: -4,
                    max: 4
                },
                y: {
                    title: { display: true, text: '確率' },
                    min: 0,
                    max: 1
                }
            }
        }
    });
    
    // 初期状態（一様分布）を表示
    resetCharts();
}

function resetCharts() {
    // θの一様分布を表示
    const thetaLabels = [];
    const uniformTheta = [];
    for (let t = CONFIG.THETA_GRID_MIN; t <= CONFIG.THETA_GRID_MAX; t += CONFIG.THETA_GRID_STEP) {
        thetaLabels.push(t.toString());
        uniformTheta.push(1 / Math.ceil((CONFIG.THETA_GRID_MAX - CONFIG.THETA_GRID_MIN) / CONFIG.THETA_GRID_STEP + 1));
    }
    
    thetaChart.data.labels = thetaLabels;
    thetaChart.data.datasets[0].data = uniformTheta;
    thetaChart.update();
    
    // wを一様分布で初期化（各成分について）
    const wValues = [-4, -3, -2, -1, 0, 1, 2, 3, 4];
    const uniformProb = 1 / wValues.length;
    
    for (let i = 0; i < 4; i++) {
        wChart.data.datasets[i].data = wValues.map(() => uniformProb);
    }
    wChart.data.labels = wValues;
    wChart.options.scales.y.max = 0.2;
    wChart.update();
    
    // 統計表示をリセット
    document.getElementById('thetaEstimate').textContent = '-';
    document.getElementById('wEstimate').textContent = '-, -, -, -';
}

function updateCharts(result) {
    // θチャート更新
    thetaChart.data.labels = result.thetaGrid.map(t => t.toFixed(0));
    thetaChart.data.datasets[0].data = result.thetaMarginal;
    
    // Y軸の最大値を動的に調整
    const maxProbTheta = Math.max(...result.thetaMarginal);
    thetaChart.options.scales.y.max = Math.min(1, Math.max(0.1, maxProbTheta * 1.2));
    thetaChart.update();
    
    // wチャート更新（成分ごとの周辺分布）
    if (result.wComponentMarginals) {
        let maxProbW = 0;
        
        for (let i = 0; i < 4; i++) {
            const marginal = result.wComponentMarginals[i];
            
            // Chart.jsのデータ形式に変換（x, yのペア）
            const data = marginal.values.map((val, idx) => ({
                x: val,
                y: marginal.probs[idx]
            }));
            
            wChart.data.datasets[i].data = data;
            
            // 最大確率を追跡
            const compMax = Math.max(...marginal.probs);
            if (compMax > maxProbW) maxProbW = compMax;
        }
        
        // Y軸の最大値を動的に調整
        wChart.options.scales.y.max = Math.min(1, Math.max(0.2, maxProbW * 1.1));
        wChart.update();
    }
}

// =============================================================================
// 正解表示
// =============================================================================

function revealAnswer() {
    const params = game.getTrueParams();
    document.getElementById('trueTheta').textContent = params.theta;
    document.getElementById('trueW').textContent = params.w.join(', ');
    document.getElementById('patternName').textContent = params.patternName;
    document.getElementById('revealArea').classList.remove('hidden');
}
