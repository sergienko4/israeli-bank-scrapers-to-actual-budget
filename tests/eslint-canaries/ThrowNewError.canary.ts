// Canary: should trigger custom Error class rule (no throw new Error)
function failing(): never { throw new Error('bad'); }
export { failing };
