# Live autonomous recovery contract

Foundry must keep the user informed and keep working through deterministic engineering failures.

- A durable mission snapshot is emitted after every operation settles.
- Failed build, test, command, or browser operations become evidence for the next bounded repair plan.
- Successful writes are preserved; repair plans must target the remaining failure rather than restart the project.
- Duplicate plan fingerprints are rejected.
- Concurrent duplicate requests share one in-flight execution.
- Planner recovery remains bounded by the configured paid-call and token budgets.
- Awaiting approval, cancellation, and genuine external blockers remain valid stopping points.
