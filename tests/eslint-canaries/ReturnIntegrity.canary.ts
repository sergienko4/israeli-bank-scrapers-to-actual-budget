// Canary: should trigger void return, null return rules
function voidFn(): void { /* empty */ }
function nullFn(): string | null { return null; }
export { voidFn, nullFn };
