/**
 * ベイズ推論エンジン - JavaScript実装（3論点版）
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
    // 論点の総量 Q = [Q1, Q2, Q3]
    Q: [7, 5, 6],
    
    // プレイヤーの重み（UI から動的に変更可能）
    // 好き = 4, なんでもない = 0, 嫌い = -4
    W_SELF: [4, 0, -4],
    
    // パラメータグリッド設定
    W_GRID_MIN: -4,
    W_GRID_MAX: 4,
    W_GRID_STEP: 1,      // w ∈ {-4, -3, ..., 3, 4}^3 → 9^3 = 729 通り
    
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
// エージェントのパラメータパターン（3論点版）
// =============================================================================

/**
 * 自分の好み（デフォルト）: w_self = [4, 0, -4]
 *   - 論点1: 好き (4)
 *   - 論点2: なんでもない (0)
 *   - 論点3: 嫌い (-4)
 * 
 * 相手の好みパターン:
 * 9通りの組み合わせを網羅するパターンを用意
 * 
 * 組み合わせ:
 *   1. 自分好き × 相手好き
 *   2. 自分好き × 相手嫌い
 *   3. 自分好き × 相手どちらでもない
 *   4. 自分どちらでもない × 相手好き
 *   5. 自分どちらでもない × 相手嫌い
 *   6. 自分どちらでもない × 相手どちらでもない
 *   7. 自分嫌い × 相手好き
 *   8. 自分嫌い × 相手嫌い
 *   9. 自分嫌い × 相手どちらでもない
 */

const THREE_ISSUES_PATTERNS = [
    // パターン1: 全組み合わせ網羅（基本パターン）
    // 論点1(自好き×相好き=4), 論点2(自中立×相嫌=-4), 論点3(自嫌×相中立=0)
    // → 残り: 自好×相嫌, 自好×相中, 自中×相好, 自中×相中, 自嫌×相好, 自嫌×相嫌
    {
        name: "基本パターン1 × 0°",
        theta: 0,
        w: [4, -4, 0],  // [相手の論点1重み, 論点2重み, 論点3重み]
        // 論点1: 自分好き(4)×相手好き(4)
        // 論点2: 自分中立(0)×相手嫌い(-4)
        // 論点3: 自分嫌い(-4)×相手中立(0)
        description: "自好×相好, 自中×相嫌, 自嫌×相中"
    },
    
    // パターン2: 別の組み合わせ
    // 論点1(自好き×相嫌=-4), 論点2(自中立×相好=4), 論点3(自嫌×相嫌=-4)
    {
        name: "基本パターン2 × 45°",
        theta: 45,
        w: [-4, 4, -4],
        // 論点1: 自分好き(4)×相手嫌い(-4)
        // 論点2: 自分中立(0)×相手好き(4)
        // 論点3: 自分嫌い(-4)×相手嫌い(-4)
        description: "自好×相嫌, 自中×相好, 自嫌×相嫌"
    },
    
    // パターン3: さらに別の組み合わせ
    // 論点1(自好き×相中=0), 論点2(自中立×相中=0), 論点3(自嫌×相好=4)
    {
        name: "基本パターン3 × -45°",
        theta: -45,
        w: [0, 0, 4],
        // 論点1: 自分好き(4)×相手中立(0)
        // 論点2: 自分中立(0)×相手中立(0)
        // 論点3: 自分嫌い(-4)×相手好き(4)
        description: "自好×相中, 自中×相中, 自嫌×相好"
    },
    
    // パターン4: 協調的（θ=90°）
    // 論点1(自好き×相好=4), 論点2(自中立×相好=4), 論点3(自嫌×相好=4)
    {
        name: "全部好き × 90°",
        theta: 90,
        w: [4, 4, 4],
        description: "相手は全論点好き（協調的エージェント）"
    },
    
    // パターン5: 競合的（θ=-45°）
    // 論点1(自好き×相嫌=-4), 論点2(自中立×相嫌=-4), 論点3(自嫌×相嫌=-4)
    {
        name: "全部嫌い × -45°",
        theta: -45,
        w: [-4, -4, -4],
        description: "相手は全論点嫌い（競合的エージェント）"
    },
    
    // パターン6: ミックス
    // 論点1(自好き×相嫌=-4), 論点2(自中立×相中=0), 論点3(自嫌×相好=4)
    {
        name: "逆相関パターン × 0°",
        theta: 0,
        w: [-4, 0, 4],
        description: "自分と相手の好みが逆（トレードオフあり）"
    },
    
    // パターン7: 同じ好み
    // 論点1(自好き×相好=4), 論点2(自中立×相中=0), 論点3(自嫌×相嫌=-4)
    {
        name: "同好みパターン × 45°",
        theta: 45,
        w: [4, 0, -4],
        description: "自分と相手の好みが同じ（Win-Win可能）"
    },
    
    // パターン8: 部分一致
    {
        name: "部分一致パターン × 0°",
        theta: 0,
        w: [4, -4, 4],
        // 論点1: 自分好き(4)×相手好き(4) → 一致
        // 論点2: 自分中立(0)×相手嫌い(-4) → 部分不一致
        // 論点3: 自分嫌い(-4)×相手好き(4) → 不一致
        description: "自好×相好, 自中×相嫌, 自嫌×相好"
    },
    
    // パターン9: 全中立エージェント
    {
        name: "全中立 × 0°",
        theta: 0,
        w: [0, 0, 0],
        description: "相手は全論点中立"
    }
];

// 使用するパターン一覧
const ALL_PATTERNS = [...THREE_ISSUES_PATTERNS];

// =============================================================================
// ユーティリティ関数
// =============================================================================

/** 度数法 → ラジアン */
const degToRad = deg => deg * Math.PI / 180;

/** 配列の内積 */
const dot = (a, b) => a.reduce((sum, ai, i) => sum + ai * b[i], 0);

/** ユーティリティ関数 u(x; w) = Σ w_i * x_i */
const utility = (offer, w) => dot(offer, w);

/** レンジ生成 [start, start+step, ..., end] */
function range(start, end, step = 1) {
    const arr = [];
    for (let v = start; v <= end + 1e-9; v += step) {
        arr.push(Math.round(v * 1000) / 1000); // 浮動小数点誤差対策
    }
    return arr;
}

/** 配列の合計 */
const sum = arr => arr.reduce((a, b) => a + b, 0);

/** logsumexp（数値安定化） */
function logsumexp(logArr) {
    const maxLog = Math.max(...logArr);
    if (!isFinite(maxLog)) return -Infinity;
    return maxLog + Math.log(sum(logArr.map(x => Math.exp(x - maxLog))));
}

// =============================================================================
// パラメータ空間クラス
// =============================================================================

class ParameterSpace {
    constructor() {
        // θグリッド
        this.thetaValues = range(CONFIG.THETA_GRID_MIN, CONFIG.THETA_GRID_MAX, CONFIG.THETA_GRID_STEP);
        
        // wグリッド（各成分）
        this.wComponentValues = range(CONFIG.W_GRID_MIN, CONFIG.W_GRID_MAX, CONFIG.W_GRID_STEP);
        
        // w の全組み合わせ（3次元）
        this.wCombinations = this._generateWCombinations();
        
        // 事後分布（対数）
        this.logPosterior = {};
        
        this._initUniformPrior();
    }
    
    _generateWCombinations() {
        const combos = [];
        for (const w1 of this.wComponentValues) {
            for (const w2 of this.wComponentValues) {
                for (const w3 of this.wComponentValues) {
                    combos.push([w1, w2, w3]);
                }
            }
        }
        return combos;
    }
    
    _initUniformPrior() {
        const totalParams = this.thetaValues.length * this.wCombinations.length;
        const logUniform = -Math.log(totalParams);
        
        for (const theta of this.thetaValues) {
            for (const w of this.wCombinations) {
                const key = this._key(theta, w);
                this.logPosterior[key] = logUniform;
            }
        }
    }
    
    _key(theta, w) {
        return `${theta}|${w.join(',')}`;
    }
    
    reset() {
        this._initUniformPrior();
    }
    
    /** 事後分布の更新（対数尤度を加算） */
    updateWithLogLikelihood(logLikelihoodFunc) {
        for (const theta of this.thetaValues) {
            for (const w of this.wCombinations) {
                const key = this._key(theta, w);
                this.logPosterior[key] += logLikelihoodFunc(theta, w);
            }
        }
        this._normalizeLogPosterior();
    }
    
    _normalizeLogPosterior() {
        const logValues = Object.values(this.logPosterior);
        const logZ = logsumexp(logValues);
        
        for (const key in this.logPosterior) {
            this.logPosterior[key] -= logZ;
        }
    }
    
    /** θの周辺分布 */
    getMarginalTheta() {
        const marginal = {};
        for (const theta of this.thetaValues) {
            marginal[theta] = 0;
        }
        
        for (const theta of this.thetaValues) {
            const logProbs = [];
            for (const w of this.wCombinations) {
                const key = this._key(theta, w);
                logProbs.push(this.logPosterior[key]);
            }
            marginal[theta] = Math.exp(logsumexp(logProbs));
        }
        
        return marginal;
    }
    
    /** w成分の周辺分布 */
    getMarginalWComponents() {
        // 各成分ごとの周辺分布
        const marginals = [];
        for (let dim = 0; dim < 3; dim++) {
            const marginal = {};
            for (const val of this.wComponentValues) {
                marginal[val] = 0;
            }
            marginals.push(marginal);
        }
        
        for (const theta of this.thetaValues) {
            for (const w of this.wCombinations) {
                const key = this._key(theta, w);
                const prob = Math.exp(this.logPosterior[key]);
                
                for (let dim = 0; dim < 3; dim++) {
                    marginals[dim][w[dim]] += prob;
                }
            }
        }
        
        return marginals;
    }
    
    /** θの期待値 */
    getThetaMean() {
        const marginal = this.getMarginalTheta();
        let mean = 0;
        for (const theta of this.thetaValues) {
            mean += theta * marginal[theta];
        }
        return mean;
    }
    
    /** wの期待値（成分別） */
    getWMean() {
        const marginals = this.getMarginalWComponents();
        const means = [];
        
        for (let dim = 0; dim < 3; dim++) {
            let mean = 0;
            for (const val of this.wComponentValues) {
                mean += val * marginals[dim][val];
            }
            means.push(mean);
        }
        
        return means;
    }
    
    /** MAPのθを取得 */
    getThetaMAP() {
        const marginal = this.getMarginalTheta();
        let maxProb = -Infinity;
        let mapTheta = null;
        
        for (const theta of this.thetaValues) {
            if (marginal[theta] > maxProb) {
                maxProb = marginal[theta];
                mapTheta = theta;
            }
        }
        
        return mapTheta;
    }
    
    /** MAPのwを取得（成分別） */
    getWMAP() {
        const marginals = this.getMarginalWComponents();
        const mapW = [];
        
        for (let dim = 0; dim < 3; dim++) {
            let maxProb = -Infinity;
            let mapVal = null;
            
            for (const val of this.wComponentValues) {
                if (marginals[dim][val] > maxProb) {
                    maxProb = marginals[dim][val];
                    mapVal = val;
                }
            }
            mapW.push(mapVal);
        }
        
        return mapW;
    }
}

// =============================================================================
// ベイズ推論エンジン
// =============================================================================

class BayesianInferenceEngine {
    constructor() {
        this.paramSpace = new ParameterSpace();
    }
    
    reset() {
        this.paramSpace.reset();
    }
    
    /**
     * 感情計算 (論文式に基づく)
     * e = clip(⌊(u_self(x) + cos(θ)·u_other(x)) / scale⌋, -1, MAX)
     */
    computeTrueEmotion(offer, theta, wOther) {
        // 自分の効用
        const uSelf = utility(offer, CONFIG.W_SELF);
        // 相手の効用
        const xOther = CONFIG.Q.map((q, i) => q - offer[i]);
        const uOther = utility(xOther, wOther);
        
        // 重み付き合計
        const cosTheta = Math.cos(degToRad(theta));
        const combined = uSelf + cosTheta * uOther;
        
        // スケーリング
        const scale = this._computeScale();
        
        // 離散化
        const rawEmotion = Math.floor(combined / scale);
        
        // クリップ
        return Math.max(-1, Math.min(CONFIG.EMOTION_RANGE_MAX, rawEmotion));
    }
    
    _computeScale() {
        // max|u_self| + max|u_other| をベースにスケール計算
        const wAbsMax = Math.max(
            CONFIG.W_GRID_MAX,
            Math.abs(CONFIG.W_GRID_MIN)
        );
        const selfAbsMax = Math.max(...CONFIG.W_SELF.map(Math.abs));
        
        const qSum = sum(CONFIG.Q);
        const maxUtil = (wAbsMax + selfAbsMax) * qSum;
        
        return maxUtil / CONFIG.EMOTION_RANGE_MAX;
    }
    
    /**
     * ベイズ更新
     */
    update(offer, observedEmotion) {
        const logLikelihoodFunc = (theta, w) => {
            const predictedEmotion = this.computeTrueEmotion(offer, theta, w);
            
            if (predictedEmotion === observedEmotion) {
                return Math.log(CONFIG.LIKELIHOOD_MATCH);
            } else {
                return Math.log(CONFIG.LIKELIHOOD_MISMATCH);
            }
        };
        
        this.paramSpace.updateWithLogLikelihood(logLikelihoodFunc);
    }
    
    /** 推定結果取得 */
    getEstimates() {
        return {
            thetaMean: this.paramSpace.getThetaMean(),
            thetaMAP: this.paramSpace.getThetaMAP(),
            wMean: this.paramSpace.getWMean(),
            wMAP: this.paramSpace.getWMAP(),
            marginalTheta: this.paramSpace.getMarginalTheta(),
            marginalW: this.paramSpace.getMarginalWComponents()
        };
    }
}

// =============================================================================
// ゲーム管理クラス
// =============================================================================

class NegotiationGame {
    constructor() {
        this.engine = new BayesianInferenceEngine();
        this.round = 0;
        this.history = [];
        
        // ランダムにパターン選択
        this._selectRandomPattern();
    }
    
    _selectRandomPattern() {
        const idx = Math.floor(Math.random() * ALL_PATTERNS.length);
        const pattern = ALL_PATTERNS[idx];
        
        this.trueTheta = pattern.theta;
        this.trueW = [...pattern.w];
        this.patternName = pattern.name;
        this.patternDescription = pattern.description || '';
        
        console.log(`[Game] Selected pattern: ${this.patternName}`);
        console.log(`       θ = ${this.trueTheta}°, w = [${this.trueW.join(', ')}]`);
        if (this.patternDescription) {
            console.log(`       ${this.patternDescription}`);
        }
    }
    
    reset() {
        this.engine.reset();
        this.round = 0;
        this.history = [];
        this._selectRandomPattern();
    }
    
    /** W_SELFを更新してゲームをリセット */
    updateWSelf(newWSelf) {
        CONFIG.setWSelf(newWSelf);
        this.reset();
    }
    
    /** オファーを適用してベイズ更新 */
    applyOffer(offer) {
        // 真の感情を計算
        const emotion = this.engine.computeTrueEmotion(offer, this.trueTheta, this.trueW);
        
        // ベイズ更新
        this.engine.update(offer, emotion);
        
        // ラウンド更新
        this.round++;
        
        // 履歴に追加
        this.history.push({ offer: [...offer], emotion });
        
        // 推定結果
        const estimates = this.engine.getEstimates();
        
        return {
            round: this.round,
            offer: [...offer],
            emotion,
            ...estimates
        };
    }
    
    /** 正解を取得 */
    getTrueParameters() {
        return {
            theta: this.trueTheta,
            w: [...this.trueW],
            patternName: this.patternName,
            patternDescription: this.patternDescription
        };
    }
}

// エクスポート（Node.js環境用、ブラウザでは無視される）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        CONFIG,
        ParameterSpace,
        BayesianInferenceEngine,
        NegotiationGame,
        ALL_PATTERNS
    };
}
