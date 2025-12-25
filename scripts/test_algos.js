
import { checkAlertTargets } from '../src/utils/drawing_alert_utils.js';

console.log("=== 1. Testing Drawing Algorithms (checkAlertTargets) ===");

// 1. Trendline Test
// Point A: t=1000, p=100
// Point B: t=2000, p=200
// Check at t=1500 (Expected p=150)
const trendlineConfig = {
    algo: "linear_ray",
    params: { t0: 1000, p0: 100, slope: 0.1 } // slope = (200-100)/(2000-1000) = 0.1
};
const targetTrend = checkAlertTargets(trendlineConfig, 1500);
console.log(`Trendline (t=1500): Expected 150. Got: ${targetTrend}`);
if (Math.abs(targetTrend - 150) < 0.001) console.log("✅ Trendline OK");
else console.error("❌ Trendline FAIL");

// 2. Parallel Channel Test
// Main Line: Same as above (150 at t=1500)
// Offsets: [0, 50] -> Expected 150 and 200
const channelConfig = {
    algo: "parallel_channel",
    params: { t0: 1000, p0: 100, slope: 0.1, offsets: [0, 50] }
};
const targetsChannel = checkAlertTargets(channelConfig, 1500);
console.log(`Channel (t=1500): Expected [150, 200]. Got: ${JSON.stringify(targetsChannel)}`);
if (targetsChannel.length === 2 && targetsChannel.includes(150) && targetsChannel.includes(200)) console.log("✅ Channel OK");
else console.error("❌ Channel FAIL");

// 3. Fibonacci Channel Test (Multi-Line: 0, 0.5, 1.0)
// Base (0) at 150. Full Height = 100.
// Offsets: [0, 50, 100] -> Expected [150, 200, 250]
const fibChannelConfig = {
    algo: "multi_ray",
    params: {
        t0: 1000, p0: 100, slope: 0.1,
        offsets: [0, 50, 100]
    }
};
const targetsFib = checkAlertTargets(fibChannelConfig, 1500);
console.log(`Fib Channel (t=1500): Expected [150, 200, 250]. Got: ${JSON.stringify(targetsFib)}`);
if (targetsFib.length === 3 && targetsFib.includes(250)) console.log("✅ Fib Channel OK");
else console.error("❌ Fib Channel FAIL");

console.log("\n=== 2. Testing Indicator Algorithms (Java Logic Simulation) ===");

// Mock History: 0, 1, 2, ... 19 (20 items)
// Period 5
const history = Array.from({ length: 20 }, (_, i) => i * 1.0);

// --- Java Logic Port ---

// SMA
function javaCalculateSMA(history, period) {
    if (history.length < period) return NaN;
    const values = history.slice(history.length - period);
    const sum = values.reduce((a, b) => a + b, 0);
    return sum / period;
}

// EMA
function javaCalculateEMA(history, period) {
    if (history.length < period) return NaN;
    const values = history.slice(history.length - period);
    const multiplier = 2.0 / (period + 1);
    let ema = values[0];
    for (let i = 1; i < values.length; i++) {
        ema = (values[i] - ema) * multiplier + ema;
    }
    return ema;
}

// RSI (Java Logic: Simple Avg Gain/Loss)
function javaCalculateRSI(history, period) {
    if (history.length < period + 1) return NaN;

    let avgGain = 0;
    let avgLoss = 0;

    // Initial Calc only (Java Logic simplifies to just look at last N changes)
    // Note: Standard RSI uses smoothing. Java implementation I wrote explicitly does:
    // for (int i = history.size() - period; i < history.size(); i++)
    const subset = history.slice(history.length - period - 1);
    // Wait, Java code:
    // history.get(i) - history.get(i-1)
    // Loop i from `size - period` to `size - 1`?
    // Let's re-read Java logic carefully:
    // for (int i = history.size() - period; i < history.size(); i++)
    //   change = history.get(i) - history.get(i-1)
    // It loops 'period' times.

    for (let i = history.length - period; i < history.length; i++) {
        const change = history[i] - history[i - 1];
        if (change > 0) avgGain += change;
        else avgLoss += Math.abs(change);
    }
    avgGain /= period;
    avgLoss /= period;

    if (avgLoss === 0) return 100.0;
    const rs = avgGain / avgLoss;
    return 100.0 - (100.0 / (1.0 + rs));
}

// Fib
function javaCalculateFib(config) {
    // "fib_100_0_0.5" -> 50
    const parts = config.split('_');
    if (parts.length < 4) return NaN;
    const high = parseFloat(parts[1]);
    const low = parseFloat(parts[2]);
    const ratio = parseFloat(parts[3]);
    return high - (high - low) * ratio;
}

// --- Tests ---

// SMA Test
// History: [..., 15, 16, 17, 18, 19] (Last 5)
// Sum = 85, Avg = 17
const sma = javaCalculateSMA(history, 5);
console.log(`SMA(5) of last 5 [15..19]: Expected 17. Got: ${sma}`);
if (Math.abs(sma - 17) < 0.001) console.log("✅ SMA OK");

// Fib Test
const fib = javaCalculateFib("fib_100_0_0.5");
console.log(`Fib(100, 0, 0.5): Expected 50. Got: ${fib}`);
if (fib === 50) console.log("✅ Fib OK");

// RSI Test
// Mock Volatile Sequence for RSI: [100, 110, 100, 110, 100, 110] (Ping pong)
// Changes: +10, -10, +10, -10, +10
// Period 5.
// Gains: 10, 0, 10, 0, 10 -> Sum 30. AvgGain = 6
// Losses: 0, 10, 0, 10, 0 -> Sum 20. AvgLoss = 4
// RS = 1.5
// RSI = 100 - (100 / 2.5) = 100 - 40 = 60
const rsiHistory = [100, 110, 100, 110, 100, 110];
const rsi = javaCalculateRSI(rsiHistory, 5);
console.log(`RSI(5) ping-pong: Expected 60. Got: ${rsi}`);
if (Math.abs(rsi - 60) < 0.001) console.log("✅ RSI OK");

console.log("\n=== 3. Testing Trigger Logic (Time Delay Simulation) ===");

// Simulation State
const pendingDelayAlerts = new Map(); // <AlertID, StartTimestampMS>
const triggeredAlerts = new Set();    // <AlertID>

// Function simulating Java's checkAlertsForKline logic snippet
function javaSimulateCheck(alert, currentPrice, currentTimeMs) {
    if (triggeredAlerts.has(alert.id)) return "ALREADY_TRIGGERED";

    let conditionMet = false;
    if (alert.condition === 'crossing_up' && currentPrice >= alert.target) conditionMet = true;
    else if (alert.condition === 'crossing_down' && currentPrice <= alert.target) conditionMet = true;

    if (conditionMet) {
        if (alert.confirmation === 'time_delay' && alert.delaySeconds > 0) {
            if (!pendingDelayAlerts.has(alert.id)) {
                pendingDelayAlerts.set(alert.id, currentTimeMs);
                return "TIMER_STARTED";
            } else {
                const startTime = pendingDelayAlerts.get(alert.id);
                if (currentTimeMs - startTime >= alert.delaySeconds * 1000) {
                    triggeredAlerts.add(alert.id);
                    pendingDelayAlerts.delete(alert.id); // Valid Trigger
                    return "TRIGGERED";
                }
                return "WAITING";
            }
        } else {
            triggeredAlerts.add(alert.id);
            return "TRIGGERED_IMMEDIATE";
        }
    } else {
        if (pendingDelayAlerts.has(alert.id)) {
            pendingDelayAlerts.delete(alert.id);
            return "TIMER_RESET";
        }
        return "NO_ACTION";
    }
}

// Test Case: Delay 10s
const delayAlert = {
    id: "alert_delay_1",
    target: 100,
    condition: "crossing_up",
    confirmation: "time_delay",
    delaySeconds: 10
};

// 1. T=0: Price 101 (>100) -> Start Timer
let res = javaSimulateCheck(delayAlert, 101, 1000);
console.log(`T=0s: ${res} (Expected: TIMER_STARTED)`);
if (res !== "TIMER_STARTED") console.error("❌ Fail T=0");

// 2. T=5s: Price 102 (>100) -> Waiting
res = javaSimulateCheck(delayAlert, 102, 6000);
console.log(`T=5s: ${res} (Expected: WAITING)`);
if (res !== "WAITING") console.error("❌ Fail T=5");

// 3. T=11s: Price 103 (>100) -> Trigger (Duration > 10s)
res = javaSimulateCheck(delayAlert, 103, 12000); // 12000 - 1000 = 11000ms > 10000ms
console.log(`T=11s: ${res} (Expected: TRIGGERED)`);
if (res !== "TRIGGERED") console.error("❌ Fail T=11");

// Test Case: Rectangle Zone
// Time 1000-2000, Price 50-100
const rectConfig = {
    algo: "rect_zone",
    params: { tStart: 1000, tEnd: 2000, pHigh: 100, pLow: 50 }
};

// 1. Inside Time
const targetsRect = checkAlertTargets(rectConfig, 1500);
console.log(`Rectangle (t=1500): Expected [100, 50]. Got: ${JSON.stringify(targetsRect)}`);
if (targetsRect.length === 2 && targetsRect.includes(100)) console.log("✅ Rectangle OK");
else console.error("❌ Rectangle FAIL");

// 2. Outside Time
const targetsRectOut = checkAlertTargets(rectConfig, 3000);
console.log(`Rectangle (t=3000): Expected null/empty. Got: ${JSON.stringify(targetsRectOut)}`);
if (!targetsRectOut || targetsRectOut.length === 0) console.log("✅ Rectangle Out OK");


console.log("\n=== 4. Testing Trigger Logic (Candle Delay Simulation) ===");

// State for Candle Delay
const candleDelayCounter = new Map(); // <AlertID, count>

function javaSimulateCandleCheck(alert, currentPrice, isClosed) {
    if (triggeredAlerts.has(alert.id)) return "ALREADY_TRIGGERED";

    // Determine target (Simulate drawing calc)
    let targets = [alert.target];

    // Check condition against ANY target
    let conditionMet = false;
    for (let t of targets) {
        if (alert.condition === 'crossing_up' && currentPrice >= t) conditionMet = true;
        if (alert.condition === 'crossing_down' && currentPrice <= t) conditionMet = true;
    }

    if (conditionMet) {
        if (alert.confirmation === 'candle_delay' && alert.delayCandles > 0) {
            if (isClosed) {
                let count = (candleDelayCounter.get(alert.id) || 0) + 1;
                if (count >= alert.delayCandles) {
                    triggeredAlerts.add(alert.id);
                    candleDelayCounter.set(alert.id, 0);
                    return `TRIGGERED (Count ${count})`;
                } else {
                    candleDelayCounter.set(alert.id, count);
                    return `COUNTING ${count}`;
                }
            } else {
                return "WAITING_CLOSE";
            }
        } else {
            // Immediate logic skipped for this test
            return "TEST_SKIP";
        }
    } else {
        if (isClosed) {
            candleDelayCounter.set(alert.id, 0); // Reset on closed fail
            return "RESET";
        }
        return "NO_ACTION";
    }
}

// Test Case: Delay 3 Candles
// Need 3 consecutive CLOSED candles satisfying condition.
const candleDelayAlert = {
    id: "alert_candle_1",
    target: 200,
    condition: "crossing_up",
    confirmation: "candle_delay",
    delayCandles: 3
};

// 1. Open Candle (Metric met but not closed) -> Wait
let resC = javaSimulateCandleCheck(candleDelayAlert, 201, false);
console.log(`Candle 1 Open: ${resC} (Expected: WAITING_CLOSE)`);

// 2. Closed Candle 1 -> Count 1
resC = javaSimulateCandleCheck(candleDelayAlert, 201, true);
console.log(`Candle 1 Close: ${resC} (Expected: COUNTING 1)`);

// 3. Closed Candle 2 -> Count 2
resC = javaSimulateCandleCheck(candleDelayAlert, 202, true);
console.log(`Candle 2 Close: ${resC} (Expected: COUNTING 2)`);

// 4. Closed Candle 3 -> Trigger!
resC = javaSimulateCandleCheck(candleDelayAlert, 203, true);
console.log(`Candle 3 Close: ${resC} (Expected: TRIGGERED (Count 3))`);

// 5. Test Reset: Fail on Candle 4
// Close at 190 (<200) -> Reset
const candleDelayAlert2 = { ...candleDelayAlert, id: "alert_candle_2" };
javaSimulateCandleCheck(candleDelayAlert2, 201, true); // Count 1
resC = javaSimulateCandleCheck(candleDelayAlert2, 190, true);
console.log(`Candle Reset: ${resC} (Expected: RESET)`);
if (candleDelayCounter.get("alert_candle_2") === 0) console.log("✅ Counter Reset OK");


console.log("=== DONE ===");
