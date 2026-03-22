// Canary: should trigger nested call rule
function inner(): number { return 1; }
function outer(n: number): number { return n; }
const result = outer(inner());
export { result };
