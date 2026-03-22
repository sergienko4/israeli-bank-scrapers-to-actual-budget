// Canary: should trigger Promise.any ban
const result = Promise.any([Promise.resolve(1), Promise.resolve(2)]);
export { result };
