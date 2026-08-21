// No test may contact a real service.
//
// This has now gone wrong twice, both times silently and in the same way: a test injected
// a transport, the transport was later replaced with a different one, and the injection
// quietly stopped applying. The suite still passed — because it was reaching the actual
// internet and the actual internet agreed with the assertion. Once the answer changed, so
// did the test, for reasons that had nothing to do with the code.
//
// A live call is slow, flaky, and puts someone else's infrastructure in our test suite.
// So `fetch` fails loudly here unless a test has deliberately replaced it, and the error
// names the address, because "which call did I forget to stub" is the whole question.

import { beforeEach, afterEach, vi } from 'vitest';

const refuse = vi.fn((url) => {
  throw new Error(
    `Refusing a real network call in a test: ${url}\n` +
    'Pass a fetch stub (fetchImpl) or mock globalThis.fetch in this test.'
  );
});

let original;

beforeEach(() => {
  original = globalThis.fetch;
  globalThis.fetch = refuse;
});

afterEach(() => {
  // Put it back rather than leaving the refusal in place: `vi.spyOn(globalThis, 'fetch')`
  // in a test restores to whatever was there when it spied, and that should be the real
  // one, not this.
  globalThis.fetch = original;
});
