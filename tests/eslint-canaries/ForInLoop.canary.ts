// Canary: should trigger ForInStatement ban
const obj = { a: 1, b: 2 };
const keys: string[] = [];
for (const k in obj) { keys.push(k); }
export { keys };
