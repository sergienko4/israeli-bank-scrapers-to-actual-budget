// Canary: should trigger anti-sleep rules
async function bad(): Promise<void> {
  await sleep(1000);
  setTimeout(() => {}, 1000);
  delay(500);
}
function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }
function delay(ms: number): Promise<void> { return sleep(ms); }
export { bad };
