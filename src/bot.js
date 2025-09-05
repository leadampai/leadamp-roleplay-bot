import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const scenariosPath = path.resolve(__dirname, 'scenarios.yaml');
const rawYaml = fs.readFileSync(scenariosPath, 'utf8'); // must be a string
const scenarios = YAML.parse(rawYaml);
