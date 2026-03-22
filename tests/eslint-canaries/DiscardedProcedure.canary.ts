// Canary: should trigger discarded Procedure result rule
const service = {
  record: () => ({ success: true, data: 'ok' }),
  printSummary: () => ({ success: true, data: 'ok' }),
  startImport: () => ({ success: true, data: 'ok' }),
};

function bad(): void {
  service.record();
  service.printSummary();
  service.startImport();
}

export { bad };
