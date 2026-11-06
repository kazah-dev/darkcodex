# Contributing

Open an issue describing the behavior you want to change, including Bitburner, Node.js, Codex and operating-system versions. Redact local paths, account details, pairing data and game saves.

For a pull request:

1. Install with `npm ci` and keep the lockfile committed.
2. Make the smallest coherent change and update English documentation.
3. Run `npm run check` and `npm test`.
4. For a transport or UI change, verify a real local connection and describe the result.
5. Explain limitations honestly. Do not claim support for a platform or game API that was not tested.

New tools must validate inputs, respect game unlocks, expose observable results, and have explicit handling for cancellation, timeout and disconnect. Mutations must retain in-game approval. Never introduce arbitrary host command execution through the game socket.

The dynamic Codex tool interface is experimental. When updating protocol support, generate schemas from the installed Codex version and test both successful and failed turns.
