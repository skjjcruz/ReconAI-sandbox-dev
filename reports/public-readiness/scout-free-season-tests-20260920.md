# Scout free-season test correction — September20

The existing unit gate stopped at136/145 with9failed normal-tier assertions because it used the real September2026 clock. Canonical owner-approved commit8db9f0268c41687f7eba321b7e59bda8e9928dd2 deliberately grants the full paid experience until March1,2027, before normal tier resolution. The production policy is unchanged.

Every existing assertion remains. Normal tier/anti-spoofing/feature tests run at the documented expiry using a scoped VM clock and production host; the clock/location are restored after each case. Four added tests exercise the actual current-season promise, documented expiry, the final millisecond and exact boundary, and the inability of a public sandbox/dev query to extend expired access. No policy function is stubbed or disabled.

Root reproduced the9failures with the current explicit canonical unionce24aeb, then obtained149/149 with the test-only correction. Independent product reviewer inspected the full diff and exact canonical policy commit and reran149/149: cleared, no material finding. Source pricing, entitlements, billing and server enforcement are unchanged. The original failing log is retained next to the passing log under evidence/scout-yahoo-independent/unit-{unmodified-current-union,policy-clock}.log.

The broader npm test progressed through schema, RLS, provider CORS/runtime and bug capture, then stopped at5AI-routing failures (7of12passed). This is recorded, not waived or counted as a passing broader gate. Root continues those failures separately. Evidence: evidence/scout-yahoo-independent/broad-policy-clock.log. This commit changes only tests and documentation; it does not justify provider deployment or public readiness.
