import assert from 'assert';
import { binom, hypergeometricWeights, exactRtp, decimal, eq } from '../../src/exact';
import { toUnits, displayMultiplier, settledPayoutUnits, servedPayoutUnits } from '../../src/money';
import { maxFairFor } from '../../src/rng';
import { numbersAgree } from '../../src/diff';

describe('Exact arithmetic (src/exact.ts, src/money.ts) and the rejection ceiling', () => {

  it('C(40,10) = 847,660,528 and the hypergeometric weights sum to it for every picks count', () => {
    assert.strictEqual(binom(40, 10), 847660528n);
    for (let n = 1; n <= 10; n++) {
      assert.strictEqual(hypergeometricWeights(40, 10, n).reduce((a, x) => a + x, 0n), 847660528n);
    }
  });

  it('exact RTP of CLASSIC picks=1 [0, 3.996] is exactly 999/1000', () => {
    const r = exactRtp(hypergeometricWeights(40, 10, 1), binom(40, 10), ['0', '3.996']);
    assert.ok(eq(r, { num: 999n, den: 1000n }));
    assert.ok(eq(decimal('3.996'), { num: 999n, den: 250n }));
  });

  it('money: a served 13-dp multiplier and the exact settlement of a captured bet', () => {
    assert.strictEqual(displayMultiplier(4.035047673782158), '4.0350476737822');
    assert.strictEqual(settledPayoutUnits('0.01', 4.035047673782158), servedPayoutUnits('0.040350476737822'));
    assert.throws(() => toUnits('0.0000000000000000001', 18));
  });

  it('maxFairFor(r) is a whole multiple of r for every shuffle range 2..40 (range 40: 0xFFFFFFF0)', () => {
    for (let r = 2; r <= 40; r++) assert.strictEqual(maxFairFor(r) % r, 0);
    assert.strictEqual(maxFairFor(40), 0xFFFFFFF0);
  });

});

describe('Recomputed-float comparison (src/diff.ts numbersAgree, used by Steps 19–20)', () => {
  it('1-ulp libm drift agrees; a p moved by 1e-12 or more, or a distinct integer df, does not', () => {
    // A Pass 2 p that Linux recomputed 1 ulp off the macOS-shipped value (run 36466858888).
    const p = 0.8164065233441575;
    const ulp = 2 ** (Math.floor(Math.log2(p)) - 52);
    assert.ok(numbersAgree(p, p + ulp));
    assert.ok(numbersAgree(p, p - 1.1102230246251565e-16));
    assert.ok(!numbersAgree(p, p + 1e-12));
    assert.ok(!numbersAgree(0.001, 0.0010000001));
    assert.ok(!numbersAgree(3, 4));
  });
});
