const fs = require('fs');
const readline = require('readline');

async function recover() {
  const fileStream = fs.createReadStream('C:\\\\Users\\\\cdmyh\\\\.gemini\\\\antigravity\\\\brain\\\\025f2cdc-c92d-4653-9a11-e5db5643442b\\\\.system_generated\\\\logs\\\\transcript.jsonl');
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
  
  let i = 0;
  for await (const line of rl) {
    try {
      const entry = JSON.parse(line);
      if (entry.tool_calls) {
        for (const tc of entry.tool_calls) {
          if (tc.function && (tc.function.name === 'multi_replace_file_content' || tc.function.name === 'replace_file_content')) {
            const args = JSON.parse(tc.function.arguments);
            if (args.TargetFile && args.TargetFile.includes('App.tsx')) {
               fs.writeFileSync('recovered_app_' + i + '.json', JSON.stringify(args, null, 2));
               i++;
            }
            if (args.TargetFile && args.TargetFile.includes('server.js')) {
               fs.writeFileSync('recovered_server_' + i + '.json', JSON.stringify(args, null, 2));
               i++;
            }
          }
        }
      }
    } catch (e) {}
  }
  console.log('Recovered ' + i + ' file edits');
}
recover();
