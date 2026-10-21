'use strict';

// Public game-rules entry point. Keep callers importing this file instead of
// reaching into gameRulesInternal, so the internals can keep evolving safely.
module.exports = require('./gameRulesInternal/engine');
