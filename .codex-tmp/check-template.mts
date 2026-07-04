import fs from 'node:fs';
import { parseTimeLogYaml } from '../src/lib/yaml.ts';
const raw = fs.readFileSync('./templates/default.yml', 'utf8');
const parsed = parseTimeLogYaml(raw);
console.log(JSON.stringify({ hasFile: !!parsed.file, errors: parsed.errors, fields: parsed.file ? Object.keys(parsed.file.fields) : [] }, null, 2));
