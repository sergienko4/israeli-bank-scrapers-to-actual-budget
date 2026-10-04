// Canary: must trigger `no-await-in-loop`. Awaiting inside a loop body hides
// the sequencing from readers and reviewers; src/ expresses ordered async
// work through AsyncSequence (mapInOrder / repeatWhile) consumed with
// `for await`. No src file is exempt, so if ESLint stops flagging this the
// guardrail is dead.
/**
 * Loads each id in turn.
 * @param ids - The ids to load, in order.
 * @param load - Loads one id.
 * @returns The loaded values, in id order.
 */
async function loadAll(
  ids: readonly string[],
  load: (id: string) => Promise<string>,
): Promise<string[]> {
  const loaded: string[] = [];
  for (const id of ids) {
    const value = await load(id);
    loaded.push(value);
  }
  return loaded;
}
export { loadAll };
