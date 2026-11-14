// UX235 repro/evidence: runs the locked-state test and writes screenshots to .nova/qa/qa-loop-231/
// Usage: SHOTS=.nova/qa/qa-loop-231 node tools/qa/qa-loop-231.mjs (needs server on :8765 and @playwright/test)
process.env.SHOTS ||= '.nova/qa/qa-loop-231';
await import('../../tests/ux/ux235-locked-empty.mjs');
