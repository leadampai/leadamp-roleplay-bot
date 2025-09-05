// at the top if not already present
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

// build an absolute path and read as UTF-8 text
const scenariosPath = path.join(process.cwd(), 'src', 'scenarios.yaml');
const scenariosText = fs.readFileSync(scenariosPath, 'utf8');  // << add 'utf8'
const SCENARIOS = YAML.parse(scenariosText);

// (optional) guard with a try/catch to log clearly if parsing fails
// try {
//   const scenariosText = fs.readFileSync(scenariosPath, 'utf8');
//   const SCENARIOS = YAML.parse(scenariosText);
// } catch (err) {
//   console.error('Failed to load scenarios.yaml:', err);
//   process.exit(1);
// }

