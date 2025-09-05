// --- at top of bot.js ---
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const scenariosPath = path.join(process.cwd(), 'src', 'scenarios.yaml');

let text;
try {
  text = fs.readFileSync(scenariosPath, 'utf8');        // read as UTF-8
  if (typeof text !== 'string') text = text?.toString('utf8'); // belt & suspenders
  if (!text || !text.trim()) {
    throw new Error(`scenarios.yaml is empty at ${scenariosPath}`);
  }
  console.log(`[boot] Loaded scenarios.yaml (${text.length} chars)`);
} catch (e) {
  console.error('[boot] Could not read scenarios.yaml:', e);
  process.exit(1);
}

let SCENARIOS;
try {
  SCENARIOS = YAML.parse(text);
  console.log('[boot] Parsed scenarios.yaml OK');
} catch (e) {
  console.error('[boot] YAML.parse failed. First 120 chars:', text.slice(0, 120));
  console.error(e);
  process.exit(1);
}

// …rest of your bot code that uses SCENARIOS…

