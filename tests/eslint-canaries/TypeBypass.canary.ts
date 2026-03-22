// Canary: should trigger as-never and as-any rules
const mock = {} as never;
const other = {} as any;
const nonNull = 'test'!;
export { mock, other, nonNull };
