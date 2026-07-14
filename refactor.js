const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src', 'scraper', 'scraper.service.ts');
let content = fs.readFileSync(filePath, 'utf8');

const methodStart = `async runIrshadScraper(sourceSite: string = 'irshad.az'): Promise<any> {`;
const initCode = `
    const startTime = new Date().toISOString();
    const sessionLogs: any[] = [];
    const addLog = (level: string, message: any, trace?: any) => {
      const logMsg = String(message) + (trace ? ' | Trace: ' + (typeof trace === 'object' ? JSON.stringify(trace) : String(trace)) : '');
      sessionLogs.push({ time: new Date().toISOString(), level, message: logMsg });
      if (level === 'log') this.logger.log(message);
      else if (level === 'warn') this.logger.warn(message);
      else if (level === 'error') this.logger.error(message, trace);
    };

    let statusCode = 200;
    let errorDump: string | null = null;
`;

content = content.replace(methodStart, methodStart + initCode);

// 2. Wrap everything after init in a try block. 
// We will look for `const supabase = this.supabaseService.getClient();` to start the try block.
const setupStart = `const supabase = this.supabaseService.getClient();`;
content = content.replace(setupStart, `const supabase = this.supabaseService.getClient();\n    try {`);

// 3. Replace all this.logger.log, warn, error with addLog inside runIrshadScraper
// We only want to replace inside runIrshadScraper, but doing it globally is safe enough for this file since syncDatabase also uses it and it's fine. Wait, syncDatabase is outside the method.
// Let's replace manually.
content = content.replace(/this\.logger\.log\((.*?)\);/g, "addLog('log', $1);");
content = content.replace(/this\.logger\.warn\((.*?)\);/g, "addLog('warn', $1);");
content = content.replace(/this\.logger\.error\((.*?)\);/g, "addLog('error', $1);");

// Fix syncDatabase since it's outside runIrshadScraper but got replaced
content = content.replace(
  `async syncDatabase(sourceSite: string): Promise<void> {
    addLog('log', \`Starting DB sync for \${sourceSite} via RPC...\`);`,
  `async syncDatabase(sourceSite: string): Promise<void> {
    this.logger.log(\`Starting DB sync for \${sourceSite} via RPC...\`);`
);
content = content.replace(
  `addLog('error', \`Sync failed for \${sourceSite}\`, error);`,
  `this.logger.error(\`Sync failed for \${sourceSite}\`, error);`
);
content = content.replace(
  `addLog('log', \`Sync completed successfully for \${sourceSite}!\`);`,
  `this.logger.log(\`Sync completed successfully for \${sourceSite}!\`);`
);

// 4. Add catch and finally before the return of runIrshadScraper
const returnStatement = `return {
      message: 'Scraping finished',
      total_items: totalScraped
    };`;

const catchFinallyBlock = `} catch (err: any) {
      statusCode = 500;
      errorDump = err instanceof Error ? err.stack : JSON.stringify(err);
      addLog('error', 'Fatal error during scraping session', err);
    } finally {
      try {
        addLog('log', 'Saving session logs to Supabase...');
        const { error: logInsertError } = await supabase.from('scraping_logs').insert({
          start_time: startTime,
          end_time: new Date().toISOString(),
          status_code: statusCode,
          error_dump: errorDump,
          log_message: JSON.stringify(sessionLogs),
          target_site: sourceSite
        });
        if (logInsertError) {
          this.logger.error('Failed to save scraping logs to Supabase', logInsertError);
        }
      } catch (logErr) {
        this.logger.error('Critical failure while saving logs', logErr);
      }
    }

    return {
      message: statusCode === 200 ? 'Scraping finished' : 'Scraping failed',
      total_items: typeof totalScraped !== 'undefined' ? totalScraped : 0
    };`;

content = content.replace(returnStatement, catchFinallyBlock);

// 5. In case totalScraped is declared inside the try block now, let's lift it up if needed.
// Ah, `let totalScraped = 0;` was declared. Let's make sure it's accessible.
// Since we wrapped it all in try {, `let totalScraped = 0;` will be scoped inside try.
content = content.replace(`    let totalScraped = 0;`, `    // totalScraped moved up\n`);
content = content.replace(`    let statusCode = 200;`, `    let totalScraped = 0;\n    let statusCode = 200;`);


fs.writeFileSync(filePath, content, 'utf8');
console.log('Refactoring complete.');
