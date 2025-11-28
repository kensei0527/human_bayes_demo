/**
 * ベイズ推論エンジン - JavaScript実装
 * 
 * Pythonコード (hiyori_bayes_gpu.py) のロジックをJavaScriptで再実装
 * 
 * 主要コンポーネント:
 * - EmotionModel: θとwから感情ラベルを計算
 * - BayesianInferenceEngine: ベイズ更新を実行
 * - ParameterSpace: パラメータ空間と事後分布を管理
 */

// =============================================================================
// 定数定義
// =============================================================================

const CONFIG = {
    // 論点の総量
    Q: [7, 5, 5, 5],
    
    // 自分（プレイヤー）の重み（動的に変更可能）
    W_SELF: [2, -1, 0, 1],
    
    // パラメータグリッド設定
    W_GRID_MIN: -4,
    W_GRID_MAX: 4,
    W_GRID_STEP: 1,
    
    THETA_GRID_MIN: -90,
    THETA_GRID_MAX: 90,
    THETA_GRID_STEP: 5,
    
    // 感情マッピング
    EMOTION_RANGE_MAX: 7,
    NEUTRAL_EPSILON: 0,
    
    // 推論設定
    EPSILON: 1e-9,
    NUM_EMOTION_CLASSES: 9,
    
    // W_SELFを更新するメソッド
    setWSelf: function(newWSelf) {
        this.W_SELF = [...newWSelf];
    }
};

// 難しい組み合わせ（苦手パターン）
const HARD_PATTERNS = [
    { name: "extreme_neg_1st × -30°", theta: -30, w: [-4, 0, 0, 0] },
    { name: "balanced_neg × 0°", theta: 0, w: [-2, -2, -2, -2] },
    { name: "skewed_3rd × -15°", theta: -15, w: [-1, -1, 4, -1] },
    { name: "triple_124 × 0°", theta: 0, w: [2, 2, -2, 2] },
    { name: "extreme_neg_1st × -45°", theta: -45, w: [-4, 0, 0, 0] },
    { name: "balanced_pos × 0°", theta: 0, w: [2, 2, 2, 2] },
    { name: "diagonal_1 × 45°", theta: 45, w: [3, -1, -1, 3] },
    { name: "diagonal_2 × 45°", theta: 45, w: [-1, 3, 3, -1] }
];

// 簡単な組み合わせ（得意パターン）
const EASY_PATTERNS = [
    { name: "uniform × 90°", theta: 90, w: [1, 1, 1, 1] },
    { name: "skewed_1st × 90°", theta: 90, w: [4, -1, -1, -1] },
    { name: "ascending × 90°", theta: 90, w: [-2, -1, 1, 2] },
    { name: "uniform × 75°", theta: 75, w: [1, 1, 1, 1] },
    { name: "ascending × 75°", theta: 75, w: [-2, -1, 1, 2] },
    { name: "skewed_1st × -45°", theta: -45, w: [4, -1, -1, -1] },
    { name: "skewed_1st × -30°", theta: -30, w: [4, -1, -1, -1] },
    { name: "uniform × -15°", theta: -15, w: [1, 1, 1, 1] }
];

// 全パターン（難易度混合）
const ALL_PATTERNS = [...HARD_PATTERNS, ...EASY_PATTERNS];

// =============================================================================
// ユーティリティ関数
// =============================================================================

function degToRad(deg) {
    return deg * Math.PI / 180;
}

function radToDeg(rad) {
    return rad * 180 / Math.PI;
}

function dot(a, b) {
    return a.reduce((sum, val, i) => sum + val * b[i], 0);
}

function subtractArrays(a, b) {
    return a.map((val, i) => val - b[i]);
}

// 配列の正規化
function normalize(arr) {
    const sum = arr.reduce((a, b) => a + b, 0);
    if (sum <= 0) return arr.map(() => 1 / arr.length);
    return arr.map(v => v / sum);
}

// 2D配列の正規化
function normalize2D(arr2d) {
    const flat = arr2d.flat();
    const sum = flat.reduce((a, b) => a + b, 0);
    if (sum <= 0) {
        const val = 1 / flat.length;
        return arr2d.map(row => row.map(() => val));
    }
    return arr2d.map(row => row.map(v => v / sum));
}

// =============================================================================
// 全候補配分の生成
// =============================================================================

function generateAllOffers(Q) {
    const offers = [];
    for (let a = 0; a <= Q[0]; a++) {
        for (let b = 0; b <= Q[1]; b++) {
            for (let c = 0; c <= Q[2]; c++) {
                for (let d = 0; d <= Q[3]; d++) {
                    offers.push([a, b, c, d]);
                }
            }
        }
    }
    return offers;
}

// =============================================================================
// パラメータグリッドの生成
// =============================================================================

function generateWGrid(min, max, step) {
    const values = [];
    for (let v = min; v <= max + 0.001; v += step) {
        values.push(Math.round(v * 100) / 100);  // 浮動小数点誤差対策
    }
    
    const grid = [];
    for (const a of values) {
        for (const b of values) {
            for (const c of values) {
                for (const d of values) {
                    grid.push([a, b, c, d]);
                }
            }
        }
    }
    return grid;
}

function generateThetaGrid(min, max, step) {
    const grid = [];
    for (let t = min; t <= max + 0.001; t += step) {
        grid.push(degToRad(t));
    }
    return grid;
}

// =============================================================================
// EmotionModel クラス
// =============================================================================

class EmotionModel {
    constructor(q, wSelf, candX) {
        this.q = q;
        this.wSelf = wSelf;
        this.candX = candX;
    }
    
    /**
     * 効用関数の計算
     */
    utility(xSelf, wOther, theta) {
        const xOther = subtractArrays(this.q, xSelf);
        const c = Math.cos(theta);
        const s = Math.sin(theta);
        return c * dot(wOther, xOther) + s * dot(this.wSelf, xSelf);
    }
    
    /**
     * 効用から感情ラベルへの変換
     */
    utilityToEmotion(xSelf, wOther, theta) {
        const uOther = this.utility(xSelf, wOther, theta);
        
        // 全候補の効用を計算して最大値を取得
        let maxU = -Infinity;
        for (const x of this.candX) {
            const u = this.utility(x, wOther, theta);
            if (u > maxU) maxU = u;
        }
        
        const limit = maxU - CONFIG.EMOTION_RANGE_MAX;
        const epsilon = CONFIG.NEUTRAL_EPSILON;
        
        if (uOther < limit - epsilon) {
            return -1;  // Anger
        } else if (Math.abs(uOther - limit) <= epsilon) {
            return 0;   // Neutral
        } else if (uOther <= limit + 1) {
            return 1;   // Joy1
        } else if (uOther <= limit + 2) {
            return 2;   // Joy2
        } else if (uOther <= limit + 3) {
            return 3;   // Joy3
        } else if (uOther <= limit + 4) {
            return 4;   // Joy4
        } else if (uOther <= limit + 5) {
            return 5;   // Joy5
        } else if (uOther <= limit + 6) {
            return 6;   // Joy6
        } else {
            return 7;   // Joy7
        }
    }
    
    /**
     * 真のパラメータで感情をサンプリング
     */
    sampleEmotion(x, trueTheta, trueW) {
        return this.utilityToEmotion(x, trueW, trueTheta);
    }
}

// =============================================================================
// ParameterSpace クラス
// =============================================================================

class ParameterSpace {
    constructor(thetaValues, wGrid) {
        this.thetaValues = thetaValues;
        this.wGrid = wGrid;
        this.Nt = thetaValues.length;
        this.Nw = wGrid.length;
        
        // 一様分布で初期化 [θの数][wの数]
        const uniformProb = 1 / (this.Nt * this.Nw);
        this.distribution = Array(this.Nt).fill(null).map(() => 
            Array(this.Nw).fill(uniformProb)
        );
    }
    
    updateDistribution(newDist) {
        this.distribution = newDist;
    }
    
    getCurrentDistribution() {
        return this.distribution;
    }
    
    /**
     * θの周辺確率分布
     */
    getMarginalThetaProb() {
        return this.distribution.map(row => row.reduce((a, b) => a + b, 0));
    }
    
    /**
     * wの周辺確率分布
     */
    getMarginalWProb() {
        const marginal = Array(this.Nw).fill(0);
        for (let i = 0; i < this.Nt; i++) {
            for (let j = 0; j < this.Nw; j++) {
                marginal[j] += this.distribution[i][j];
            }
        }
        return marginal;
    }
    
    /**
     * wの成分ごとの周辺確率分布を計算
     * plot_posteriors_per_round と同様のロジック
     */
    getComponentWiseMarginals() {
        const marginals = [];
        const wMarginal = this.getMarginalWProb();
        
        // 各成分について計算
        for (let comp = 0; comp < 4; comp++) {
            // この成分で取りうる値を収集
            const valueProbs = new Map();
            
            for (let j = 0; j < this.Nw; j++) {
                const val = this.wGrid[j][comp];
                const prob = wMarginal[j];
                
                if (valueProbs.has(val)) {
                    valueProbs.set(val, valueProbs.get(val) + prob);
                } else {
                    valueProbs.set(val, prob);
                }
            }
            
            // ソートして配列に変換
            const sortedEntries = Array.from(valueProbs.entries()).sort((a, b) => a[0] - b[0]);
            marginals.push({
                component: comp,
                values: sortedEntries.map(e => e[0]),
                probs: sortedEntries.map(e => e[1])
            });
        }
        
        return marginals;
    }
    
    /**
     * 事後平均の計算
     */
    getPosteriorMean() {
        const normDist = normalize2D(this.distribution);
        
        // θの事後平均
        const thetaMarginal = normDist.map(row => row.reduce((a, b) => a + b, 0));
        const thetaMean = this.thetaValues.reduce((sum, t, i) => sum + t * thetaMarginal[i], 0);
        
        // wの事後平均
        const wMarginal = Array(this.Nw).fill(0);
        for (let i = 0; i < this.Nt; i++) {
            for (let j = 0; j < this.Nw; j++) {
                wMarginal[j] += normDist[i][j];
            }
        }
        
        const wMean = [0, 0, 0, 0];
        for (let j = 0; j < this.Nw; j++) {
            for (let k = 0; k < 4; k++) {
                wMean[k] += wMarginal[j] * this.wGrid[j][k];
            }
        }
        
        return { thetaMean, wMean };
    }
}

// =============================================================================
// BayesianInferenceEngine クラス
// =============================================================================

class BayesianInferenceEngine {
    constructor(paramSpace, q, wSelf, candX) {
        this.paramSpace = paramSpace;
        this.q = q;
        this.wSelf = wSelf;
        this.candX = candX;
        this.epsilon = CONFIG.EPSILON;
        this.numClasses = CONFIG.NUM_EMOTION_CLASSES;
        
        // EmotionModelを内部で使用
        this.emotionModel = new EmotionModel(q, wSelf, candX);
        
        // UMAX[θindex][wIndex]を事前計算
        this._precomputeUMAX();
    }
    
    _precomputeUMAX() {
        const Nt = this.paramSpace.Nt;
        const Nw = this.paramSpace.Nw;
        
        this.UMAX = Array(Nt).fill(null).map(() => Array(Nw).fill(0));
        
        for (let ti = 0; ti < Nt; ti++) {
            const theta = this.paramSpace.thetaValues[ti];
            const c = Math.cos(theta);
            const s = Math.sin(theta);
            
            for (let wi = 0; wi < Nw; wi++) {
                const wOther = this.paramSpace.wGrid[wi];
                let maxU = -Infinity;
                
                for (const x of this.candX) {
                    const xOther = subtractArrays(this.q, x);
                    const u = c * dot(wOther, xOther) + s * dot(this.wSelf, x);
                    if (u > maxU) maxU = u;
                }
                
                this.UMAX[ti][wi] = maxU;
            }
        }
    }
    
    /**
     * 予測感情ラベルを計算
     */
    _predictEmotion(theta, wOther, x) {
        const xOther = subtractArrays(this.q, x);
        const c = Math.cos(theta);
        const s = Math.sin(theta);
        const u = c * dot(wOther, xOther) + s * dot(this.wSelf, x);
        
        // 対応するUMAXを使用
        const ti = this.paramSpace.thetaValues.indexOf(theta);
        const wi = this.paramSpace.wGrid.findIndex(w => 
            w.every((v, i) => v === wOther[i])
        );
        
        if (ti === -1 || wi === -1) {
            // フォールバック: EmotionModelを使用
            return this.emotionModel.utilityToEmotion(x, wOther, theta);
        }
        
        const maxU = this.UMAX[ti][wi];
        const limit = maxU - CONFIG.EMOTION_RANGE_MAX;
        const delta = u - limit;
        const eps = 1e-3;
        
        if (delta < -eps) {
            return -1;  // Anger
        } else if (Math.abs(delta) <= eps) {
            return 0;   // Neutral
        } else {
            return Math.min(7, Math.ceil(delta));
        }
    }
    
    /**
     * ベイズ更新
     */
    update(observedEmotion, xProposal) {
        const prior = this.paramSpace.getCurrentDistribution();
        const Nt = this.paramSpace.Nt;
        const Nw = this.paramSpace.Nw;
        
        // 事後分布の計算
        const posterior = Array(Nt).fill(null).map(() => Array(Nw).fill(0));
        
        for (let ti = 0; ti < Nt; ti++) {
            const theta = this.paramSpace.thetaValues[ti];
            
            for (let wi = 0; wi < Nw; wi++) {
                const wOther = this.paramSpace.wGrid[wi];
                
                // 予測感情を計算
                const predictedEmotion = this._predictEmotionFast(ti, wi, xProposal);
                
                // 尤度の計算
                let likelihood;
                if (predictedEmotion === observedEmotion) {
                    likelihood = 1 - this.epsilon;
                } else {
                    likelihood = this.epsilon / (this.numClasses - 1);
                }
                
                posterior[ti][wi] = prior[ti][wi] * likelihood;
            }
        }
        
        // 正規化
        const normalizedPosterior = normalize2D(posterior);
        this.paramSpace.updateDistribution(normalizedPosterior);
    }
    
    /**
     * 高速な予測感情計算（事前計算済みUMAXを使用）
     */
    _predictEmotionFast(ti, wi, x) {
        const theta = this.paramSpace.thetaValues[ti];
        const wOther = this.paramSpace.wGrid[wi];
        
        const xOther = subtractArrays(this.q, x);
        const c = Math.cos(theta);
        const s = Math.sin(theta);
        const u = c * dot(wOther, xOther) + s * dot(this.wSelf, x);
        
        const maxU = this.UMAX[ti][wi];
        const limit = maxU - CONFIG.EMOTION_RANGE_MAX;
        const delta = u - limit;
        const eps = 1e-3;
        
        if (delta < -eps) {
            return -1;
        } else if (Math.abs(delta) <= eps) {
            return 0;
        } else {
            return Math.min(7, Math.ceil(delta));
        }
    }
}

// =============================================================================
// ゲームマネージャークラス
// =============================================================================

class NegotiationGame {
    constructor(customWSelf = null) {
        this.Q = CONFIG.Q;
        this.wSelf = customWSelf || [...CONFIG.W_SELF];
        this.candX = generateAllOffers(this.Q);
        
        this.wGrid = generateWGrid(CONFIG.W_GRID_MIN, CONFIG.W_GRID_MAX, CONFIG.W_GRID_STEP);
        this.thetaGrid = generateThetaGrid(CONFIG.THETA_GRID_MIN, CONFIG.THETA_GRID_MAX, CONFIG.THETA_GRID_STEP);
        
        this.reset();
    }
    
    reset() {
        // ランダムにパターンを選択
        const pattern = ALL_PATTERNS[Math.floor(Math.random() * ALL_PATTERNS.length)];
        this.trueTheta = degToRad(pattern.theta);
        this.trueThetaDeg = pattern.theta;
        this.trueW = pattern.w;
        this.patternName = pattern.name;
        
        // エンジンの初期化（現在のwSelfを使用）
        this.paramSpace = new ParameterSpace(this.thetaGrid, this.wGrid);
        this.emotionModel = new EmotionModel(this.Q, this.wSelf, this.candX);
        this.engine = new BayesianInferenceEngine(this.paramSpace, this.Q, this.wSelf, this.candX);
        
        this.round = 0;
        this.history = [];
    }
    
    /**
     * W_SELFを更新してゲームをリセット
     */
    updateWSelf(newWSelf) {
        this.wSelf = [...newWSelf];
        CONFIG.setWSelf(newWSelf);
        this.reset();
    }
    
    /**
     * オファーを適用して感情を取得、ベイズ更新を実行
     */
    applyOffer(x) {
        this.round++;
        
        // 真のパラメータで感情を計算
        const emotion = this.emotionModel.sampleEmotion(x, this.trueTheta, this.trueW);
        
        // ベイズ更新
        this.engine.update(emotion, x);
        
        // 事後統計を取得
        const { thetaMean, wMean } = this.paramSpace.getPosteriorMean();
        const thetaMarginal = normalize(this.paramSpace.getMarginalThetaProb());
        const wMarginal = normalize(this.paramSpace.getMarginalWProb());
        const wComponentMarginals = this.paramSpace.getComponentWiseMarginals();
        
        // 履歴に追加
        const entry = {
            round: this.round,
            offer: [...x],
            emotion: emotion,
            thetaEstimate: radToDeg(thetaMean),
            wEstimate: [...wMean]
        };
        this.history.push(entry);
        
        return {
            emotion,
            round: this.round,
            thetaMarginal,
            wMarginal,
            wComponentMarginals,
            thetaMean: radToDeg(thetaMean),
            wMean,
            thetaGrid: this.thetaGrid.map(radToDeg),
            wGrid: this.wGrid
        };
    }
    
    /**
     * 現在のW_SELFを取得
     */
    getWSelf() {
        return [...this.wSelf];
    }
    
    getTrueParams() {
        return {
            theta: this.trueThetaDeg,
            w: this.trueW,
            patternName: this.patternName
        };
    }
}

// グローバルにエクスポート
window.NegotiationGame = NegotiationGame;
window.CONFIG = CONFIG;
