import { spawn } from 'child_process';
import parser from 'cron-parser';

console.log('🚀 Israeli Bank Importer Scheduler Starting...');
console.log(`📅 Timezone: ${process.env.TZ || 'UTC'}`);

// Function to run the importer
function runImport() {
  return new Promise((resolve) => {
    const startTime = new Date();
    console.log(`\n⏰ ${startTime.toISOString()}: Starting import...`);

    const child = spawn('node', ['/app/index.js'], {
      stdio: 'inherit',
      env: process.env
    });

    child.on('exit', (code) => {
      const endTime = new Date();
      const duration = Math.round((endTime - startTime) / 1000);

      if (code === 0) {
        console.log(`✅ ${endTime.toISOString()}: Import completed successfully (took ${duration}s)`);
      } else {
        console.error(`❌ ${endTime.toISOString()}: Import failed with exit code ${code} (took ${duration}s)`);
      }

      resolve(code);
    });

    child.on('error', (err) => {
      console.error(`❌ Failed to start import: ${err.message}`);
      resolve(1);
    });
  });
}

// Main scheduling logic
async function main() {
  const schedule = process.env.SCHEDULE;

  if (!schedule) {
    console.log('📝 Running once (no SCHEDULE set)');
    const exitCode = await runImport();
    process.exit(exitCode);
  } else {
    console.log(`⏰ Scheduled mode enabled: ${schedule}`);
    console.log('💡 Import will run according to cron schedule\n');

    try {
      // Parse the cron expression to validate it
      const interval = parser.parseExpression(schedule, {
        tz: process.env.TZ || 'UTC'
      });

      console.log(`📅 Next scheduled run: ${interval.next().toString()}`);
    } catch (err) {
      console.error(`❌ Invalid SCHEDULE format: ${err.message}`);
      console.error('   Example: "0 */8 * * *" (every 8 hours)');
      process.exit(1);
    }

    // Run continuously with cron scheduling
    while (true) {
      try {
        const interval = parser.parseExpression(schedule, {
          tz: process.env.TZ || 'UTC'
        });

        const nextRun = interval.next().toDate();
        const now = new Date();
        const msUntilNext = nextRun.getTime() - now.getTime();

        console.log(`⏳ Waiting until ${nextRun.toISOString()} (${Math.round(msUntilNext / 1000 / 60)} minutes)`);

        // Sleep until next run
        await new Promise(resolve => setTimeout(resolve, msUntilNext));

        // Run the import
        await runImport();

      } catch (err) {
        console.error(`❌ Scheduler error: ${err.message}`);
        await new Promise(resolve => setTimeout(resolve, 60000)); // Wait 1 minute on error
      }
    }
  }
}

main().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
