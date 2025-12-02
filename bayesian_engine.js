/**
 * ベイズ推論エンジン - JavaScript実装
 * 
 * 交渉シミュレーションにおける相手エージェントのパラメータ（θ, w）を
 * ベイズ推論で推定するエンジン
 * 
 * 構成:
 * - CONFIG: 設定値
 * - ユーティリティ関数: 数学的な基本操作
 * - ParameterSpace: パラメータ空間と事後分布の管理
 * - BayesianInferenceEngine: 感情予測とベイズ更新
 * - NegotiationGame: ゲーム全体の管理（UIとのインターフェース）
 */

// =============================================================================
// 設定
// =============================================================================

const CONFIG = {
    // 論点の総量 Q = [Q1, Q2, Q3, Q4]
    Q: [7, 5, 5, 5],
    
    // プレイヤーの重み（UI から動的に変更可能）
    W_SELF: [2, -1, 0, 1],
    
    // パラメータグリッド設定
    W_GRID_MIN: -4,
    W_GRID_MAX: 4,
    W_GRID_STEP: 1,      // w ∈ {-4, -3, ..., 3, 4}^4 → 9^4 = 6561 通り
    
    THETA_GRID_MIN: -90,
    THETA_GRID_MAX: 90,
    THETA_GRID_STEP: 5,  // θ ∈ {-90°, -85°, ..., 85°, 90°} → 37 通り
    
    // 感情計算パラメータ
    EMOTION_RANGE_MAX: 7,  // 感情レベル最大値（JOY1〜JOY7）
    
    // ベイズ推論パラメータ
    LIKELIHOOD_MATCH: 1 - 1e-9,     // 予測と観測が一致した場合の尤度
    LIKELIHOOD_MISMATCH: 1e-9 / 8,  // 不一致の場合の尤度（9クラス中8クラスで分配）
    
    // W_SELF を更新
    setWSelf(newWSelf) {
        this.W_SELF = [...newWSelf];
    }
};

// =============================================================================
// エージェントのパラメータパターン
// =============================================================================

// 難しいパターン（推定が困難）
const HARD_PATTERNS = [
    { name: "extreme_neg_1st × 0°", theta: 0, w: [-4, 0, 0, 0] },
    { name: "balanced_neg × 0°", theta: 0, w: [-2, -2, -2, -2] },
    { name: "skewed_3rd × -15°", theta: -15, w: [-1, -1, 4, -1] },
    { name: "triple_124 × 0°", theta: 0, w: [2, 2, -2, 2] },
    { name: "extreme_neg_1st × -45°", theta: -45, w: [-4, 0, 0, 0] },
    { name: "balanced_pos × 0°", theta: 0, w: [2, 2, 2, 2] },
    { name: "diagonal_1 × 45°", theta: 45, w: [3, -1, -1, 3] },
    { name: "diagonal_2 × 45°", theta: 45, w: [-1, 3, 3, -1] }
];

// 簡単なパターン（推定が容易）
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

const VARIUS_TEST_PATTERN = [
    // === θ = 90° (完全利他的: 相手の効用のみ考慮) ===
    { name: "uniform × 90°", theta: 90, w: [1, 1, 1, 1] },
    { name: "ascending × 90°", theta: 90, w: [-1, 0, 1, 2] },
    { name: "descending × 90°", theta: 90, w: [2, 1, 0, -1] },
    { name: "focus_1st × 90°", theta: 90, w: [3, 1, 0, -1] },
    { name: "focus_4th × 90°", theta: 90, w: [-1, 0, 1, 3] },
    { name: "contrast × 90°", theta: 90, w: [2, -1, 2, -1] },
    { name: "mild_pos × 90°", theta: 90, w: [2, 1, 1, 0] },
    { name: "mild_neg × 90°", theta: 90, w: [0, -1, 1, 2] },
    { name: "balanced × 90°", theta: 90, w: [1, 2, -1, 1] },
    { name: "spread × 90°", theta: 90, w: [3, -2, 1, 0] },
    
    // === θ = 45° (バランス型: 自分と相手を同等に考慮) ===
    { name: "uniform × 45°", theta: 45, w: [1, 1, 1, 1] },
    { name: "ascending × 45°", theta: 45, w: [-1, 0, 1, 2] },
    { name: "descending × 45°", theta: 45, w: [2, 1, 0, -1] },
    { name: "focus_2nd × 45°", theta: 45, w: [0, 3, 1, -1] },
    { name: "focus_3rd × 45°", theta: 45, w: [-1, 1, 3, 0] },
    { name: "contrast × 45°", theta: 45, w: [-1, 2, -1, 2] },
    { name: "mild_pos × 45°", theta: 45, w: [1, 2, 1, 0] },
    { name: "mild_neg × 45°", theta: 45, w: [0, 1, -1, 2] },
    { name: "diagonal × 45°", theta: 45, w: [2, 0, 1, 2] },
    { name: "mixed × 45°", theta: 45, w: [1, -2, 2, 1] },
    
    // === θ = 0° (中立: 自分の効用のみ考慮) ===
    { name: "uniform × 0°", theta: 0, w: [1, 1, 1, 1] },
    { name: "ascending × 0°", theta: 0, w: [-1, 0, 1, 2] },
    { name: "descending × 0°", theta: 0, w: [2, 1, 0, -1] },
    { name: "focus_1st × 0°", theta: 0, w: [3, 0, -1, 1] },
    { name: "focus_2nd × 0°", theta: 0, w: [1, 3, 0, -1] },
    { name: "contrast × 0°", theta: 0, w: [2, -2, 1, -1] },
    { name: "mild_pos × 0°", theta: 0, w: [2, 2, 0, 1] },
    { name: "mild_neg × 0°", theta: 0, w: [-1, 1, 2, 0] },
    { name: "spread × 0°", theta: 0, w: [1, -1, 2, 1] },
    { name: "asymmetric × 0°", theta: 0, w: [0, 2, -1, 3] },
    
    // === θ = -45° (競争的: 相手の損失を重視) ===
    { name: "uniform × -45°", theta: -45, w: [1, 1, 1, 1] },
    { name: "ascending × -45°", theta: -45, w: [-1, 0, 1, 2] },
    { name: "descending × -45°", theta: -45, w: [2, 1, 0, -1] },
    { name: "focus_3rd × -45°", theta: -45, w: [0, -1, 3, 1] },
    { name: "focus_4th × -45°", theta: -45, w: [1, 0, -1, 3] },
    { name: "contrast × -45°", theta: -45, w: [-1, 1, 2, -2] },
    { name: "mild_pos × -45°", theta: -45, w: [1, 0, 2, 1] },
    { name: "mild_neg × -45°", theta: -45, w: [0, 2, 1, -1] },
    { name: "spread × -45°", theta: -45, w: [2, -1, 0, 2] },
    { name: "asymmetric × -45°", theta: -45, w: [-1, 3, 1, 0] }
];

// 使用するパターン一覧
const ALL_PATTERNS = [...VARIUS_TEST_PATTERN];

// =============================================================================
// ユーティリティ関数
// =============================================================================

/** 度数法 → ラジアン */
const degToRad = deg => deg * Math.PI / 180;

/** ラジアン → 度数法 */
const radToDeg = rad => rad * 180 / Math.PI;

/** 内積 */
const dot = (a, b) => a.reduce((sum, val, i) => sum + val * b[i], 0);

/** 配列の差 a - b */
const subtractArrays = (a, b) => a.map((val, i) => val - b[i]);

/** 1次元配列を確率分布として正規化 */
function normalize(arr) {
    const sum = arr.reduce((a, b) => a + b, 0);
    if (sum <= 0) return arr.map(() => 1 / arr.length);
    return arr.map(v => v / sum);
}

/** 2次元配列を確率分布として正規化 */
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
// グリッド生成関数
// =============================================================================

/** 全ての可能なオファー（配分）を生成 */
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
    return offers;  // (Q[0]+1) * (Q[1]+1) * (Q[2]+1) * (Q[3]+1) = 1296 通り
}

/** w のパラメータグリッドを生成 */
function generateWGrid(min, max, step) {
    const values = [];
    for (let v = min; v <= max + 0.001; v += step) {
        values.push(Math.round(v * 100) / 100);
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
    return grid;  // 9^4 = 6561 通り
}

/** θ のパラメータグリッドを生成（ラジアンで返す） */
function generateThetaGrid(min, max, step) {
    const grid = [];
    for (let t = min; t <= max + 0.001; t += step) {
        grid.push(degToRad(t));
    }
    return grid;  // 37 通り
}

// =============================================================================
// ParameterSpace クラス
// パラメータ空間（θ × w）と事後分布 P(θ, w | observations) を管理
// =============================================================================

class ParameterSpace {
    constructor(thetaValues, wGrid) {
        this.thetaValues = thetaValues;  // θ のグリッド（ラジアン）
        this.wGrid = wGrid;              // w のグリッド
        this.Nt = thetaValues.length;    // θ の候補数
        this.Nw = wGrid.length;          // w の候補数
        
        // 一様事前分布で初期化: P(θ_i, w_j) = 1 / (Nt * Nw)
        this._initUniformPrior();
    }
    
    _initUniformPrior() {
        const uniformProb = 1 / (this.Nt * this.Nw);
        this.distribution = Array(this.Nt).fill(null)
            .map(() => Array(this.Nw).fill(uniformProb));
    }
    
    /** 分布を更新 */
    updateDistribution(newDist) {
        this.distribution = newDist;
    }
    
    /** 現在の同時分布を取得 */
    getJointDistribution() {
        return this.distribution;
    }
    
    /** θ の周辺分布 P(θ) = Σ_w P(θ, w) */
    getMarginalTheta() {
        return this.distribution.map(row => row.reduce((a, b) => a + b, 0));
    }
    
    /** w の周辺分布 P(w) = Σ_θ P(θ, w) */
    getMarginalW() {
        const marginal = Array(this.Nw).fill(0);
        for (let i = 0; i < this.Nt; i++) {
            for (let j = 0; j < this.Nw; j++) {
                marginal[j] += this.distribution[i][j];
            }
        }
        return marginal;
    }
    
    /**
     * w の各成分 (w1, w2, w3, w4) ごとの周辺分布を計算
     * 例: P(w1 = k) = Σ_{w: w[0]=k} P(w)
     */
    getComponentWiseMarginals() {
        const wMarginal = this.getMarginalW();
        const marginals = [];
        
        for (let comp = 0; comp < 4; comp++) {
            const valueProbs = new Map();
            
            for (let j = 0; j < this.Nw; j++) {
                const val = this.wGrid[j][comp];
                const prob = wMarginal[j];
                valueProbs.set(val, (valueProbs.get(val) || 0) + prob);
            }
            
            const sorted = Array.from(valueProbs.entries()).sort((a, b) => a[0] - b[0]);
            marginals.push({
                component: comp,
                values: sorted.map(e => e[0]),
                probs: sorted.map(e => e[1])
            });
        }
        
        return marginals;
    }
    
    /** 事後平均 E[θ], E[w] を計算 */
    getPosteriorMean() {
        const normDist = normalize2D(this.distribution);
        
        // E[θ] = Σ_i θ_i * P(θ_i)
        const thetaMarginal = normDist.map(row => row.reduce((a, b) => a + b, 0));
        const thetaMean = this.thetaValues.reduce((sum, t, i) => sum + t * thetaMarginal[i], 0);
        
        // E[w] = Σ_j w_j * P(w_j)
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
// 感情予測とベイズ更新を担当
// =============================================================================

class BayesianInferenceEngine {
    constructor(paramSpace, Q, wSelf, candX) {
        this.paramSpace = paramSpace;
        this.Q = Q;
        this.wSelf = wSelf;
        this.candX = candX;
        
        // 各 (θ, w) に対する最大効用を事前計算（高速化のため）
        this._precomputeUMAX();
    }
    
    /**
     * UMAX[ti][wi] = max_x U(x; θ_ti, w_wi)
     * 全ての (θ, w) の組み合わせについて、エージェントが得られる最大効用を事前計算
     */
    _precomputeUMAX() {
        const { Nt, Nw, thetaValues, wGrid } = this.paramSpace;
        
        this.UMAX = Array(Nt).fill(null).map(() => Array(Nw).fill(0));
        
        for (let ti = 0; ti < Nt; ti++) {
            const theta = thetaValues[ti];
            const cosT = Math.cos(theta);
            const sinT = Math.sin(theta);
            
            for (let wi = 0; wi < Nw; wi++) {
                const wOther = wGrid[wi];
                let maxU = -Infinity;
                
                // 全オファー候補から最大効用を探索
                for (const x of this.candX) {
                    const xOther = subtractArrays(this.Q, x);
                    const u = cosT * dot(wOther, xOther) + sinT * dot(this.wSelf, x);
                    if (u > maxU) maxU = u;
                }
                
                this.UMAX[ti][wi] = maxU;
            }
        }
    }
    
    /**
     * 効用値から感情ラベルを計算
     * 
     * @param {number} utility - エージェントの効用 U(x; θ, w)
     * @param {number} maxUtility - そのパラメータでの最大効用 UMAX
     * @returns {number} 感情ラベル: -1(ANGER), 0(NEUTRAL), 1-7(JOY1-7)
     */
    _utilityToEmotion(utility, maxUtility) {
        const limit = maxUtility - CONFIG.EMOTION_RANGE_MAX;
        const delta = utility - limit;
        const eps = 1e-3;
        
        if (delta < -eps) {
            return -1;  // ANGER: 最低ラインを下回る
        } else if (Math.abs(delta) <= eps) {
            return 0;   // NEUTRAL: ちょうど最低ライン
        } else {
            return Math.min(7, Math.ceil(delta));  // JOY 1-7
        }
    }
    
    /**
     * 特定の (θ, w, x) に対する予測感情を計算
     * インデックスベースで高速にアクセス
     */
    predictEmotion(thetaIndex, wIndex, x) {
        const theta = this.paramSpace.thetaValues[thetaIndex];
        const wOther = this.paramSpace.wGrid[wIndex];
        
        // 効用計算: U = cos(θ) * w・xOther + sin(θ) * wSelf・x
        const xOther = subtractArrays(this.Q, x);
        const utility = Math.cos(theta) * dot(wOther, xOther) 
                      + Math.sin(theta) * dot(this.wSelf, x);
        
        return this._utilityToEmotion(utility, this.UMAX[thetaIndex][wIndex]);
    }
    
    /**
     * 真のパラメータ (trueTheta, trueW) での感情を計算
     * オファー x に対するエージェントの反応をシミュレート
     */
    computeTrueEmotion(x, trueTheta, trueW) {
        // 効用計算
        const xOther = subtractArrays(this.Q, x);
        const utility = Math.cos(trueTheta) * dot(trueW, xOther) 
                      + Math.sin(trueTheta) * dot(this.wSelf, x);
        
        // 最大効用を計算（真のパラメータ用）
        let maxU = -Infinity;
        const cosT = Math.cos(trueTheta);
        const sinT = Math.sin(trueTheta);
        for (const candidate of this.candX) {
            const candOther = subtractArrays(this.Q, candidate);
            const u = cosT * dot(trueW, candOther) + sinT * dot(this.wSelf, candidate);
            if (u > maxU) maxU = u;
        }
        
        return this._utilityToEmotion(utility, maxU);
    }
    
    /**
     * ベイズ更新
     * 観測された感情をもとに事後分布を更新
     * 
     * P(θ, w | e, x) ∝ P(e | θ, w, x) * P(θ, w)
     */
    update(observedEmotion, xProposal) {
        const prior = this.paramSpace.getJointDistribution();
        const { Nt, Nw } = this.paramSpace;
        
        const posterior = Array(Nt).fill(null).map(() => Array(Nw).fill(0));
        
        for (let ti = 0; ti < Nt; ti++) {
            for (let wi = 0; wi < Nw; wi++) {
                // 予測感情を計算
                const predicted = this.predictEmotion(ti, wi, xProposal);
                
                // 尤度: P(e_observed | θ, w, x)
                const likelihood = (predicted === observedEmotion)
                    ? CONFIG.LIKELIHOOD_MATCH
                    : CONFIG.LIKELIHOOD_MISMATCH;
                
                // 事後 ∝ 事前 × 尤度
                posterior[ti][wi] = prior[ti][wi] * likelihood;
            }
        }
        
        // 正規化して更新
        this.paramSpace.updateDistribution(normalize2D(posterior));
    }
}

// =============================================================================
// NegotiationGame クラス
// ゲーム全体を管理し、UIとのインターフェースを提供
// =============================================================================

class NegotiationGame {
    constructor(customWSelf = null) {
        this.Q = CONFIG.Q;
        this.wSelf = customWSelf || [...CONFIG.W_SELF];
        
        // グリッド生成（ゲーム全体で共有）
        this.candX = generateAllOffers(this.Q);
        this.wGrid = generateWGrid(CONFIG.W_GRID_MIN, CONFIG.W_GRID_MAX, CONFIG.W_GRID_STEP);
        this.thetaGrid = generateThetaGrid(CONFIG.THETA_GRID_MIN, CONFIG.THETA_GRID_MAX, CONFIG.THETA_GRID_STEP);
        
        this.reset();
    }
    
    /** ゲームをリセット（新しいエージェントを生成） */
    reset() {
        // ランダムにパターンを選択
        const pattern = ALL_PATTERNS[Math.floor(Math.random() * ALL_PATTERNS.length)];
        this.trueTheta = degToRad(pattern.theta);
        this.trueThetaDeg = pattern.theta;
        this.trueW = pattern.w;
        this.patternName = pattern.name;
        
        // 推論エンジンを初期化
        this.paramSpace = new ParameterSpace(this.thetaGrid, this.wGrid);
        this.engine = new BayesianInferenceEngine(
            this.paramSpace, this.Q, this.wSelf, this.candX
        );
        
        this.round = 0;
        this.history = [];
    }
    
    /** プレイヤーの重み W_SELF を更新してリセット */
    updateWSelf(newWSelf) {
        this.wSelf = [...newWSelf];
        CONFIG.setWSelf(newWSelf);
        this.reset();
    }
    
    /**
     * オファーを適用
     * 1. 真のパラメータで感情を計算
     * 2. ベイズ更新を実行
     * 3. 事後統計を返す
     */
    applyOffer(x) {
        this.round++;
        
        // 真のパラメータでエージェントの感情を計算
        const emotion = this.engine.computeTrueEmotion(x, this.trueTheta, this.trueW);
        
        // ベイズ更新
        this.engine.update(emotion, x);
        
        // 事後統計を取得
        const { thetaMean, wMean } = this.paramSpace.getPosteriorMean();
        const thetaMarginal = normalize(this.paramSpace.getMarginalTheta());
        const wComponentMarginals = this.paramSpace.getComponentWiseMarginals();
        
        // 履歴に記録
        this.history.push({
            round: this.round,
            offer: [...x],
            emotion,
            thetaEstimate: radToDeg(thetaMean),
            wEstimate: [...wMean]
        });
        
        return {
            emotion,
            round: this.round,
            thetaMarginal,
            wComponentMarginals,
            thetaMean: radToDeg(thetaMean),
            wMean,
            thetaGrid: this.thetaGrid.map(radToDeg)
        };
    }
    
    /** 現在のプレイヤー重み W_SELF を取得 */
    getWSelf() {
        return [...this.wSelf];
    }
    
    /** 真のパラメータを取得（デバッグ用） */
    getTrueParams() {
        return {
            theta: this.trueThetaDeg,
            w: this.trueW,
            patternName: this.patternName
        };
    }
}

// =============================================================================
// グローバルエクスポート
// =============================================================================

window.NegotiationGame = NegotiationGame;
window.CONFIG = CONFIG;
