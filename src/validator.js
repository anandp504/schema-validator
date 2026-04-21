'use strict';

const Ajv2020 = require('ajv/dist/2020');
const path = require('node:path');
const fs = require('node:fs');

const schemasDir = path.join(__dirname, '..', 'schemas');

// Create AJV instance with 2020-12 draft (required for unevaluatedProperties support)
const ajv = new Ajv2020({ allErrors: true });

// Pre-load all local schema files so $ref resolution works across files
const schemaFiles = fs.readdirSync(schemasDir).filter(f => f.endsWith('.json'));
for (const file of schemaFiles) {
  const schema = JSON.parse(fs.readFileSync(path.join(schemasDir, file), 'utf8'));
  ajv.addSchema(schema);
}

/**
 * Validate data against a locally registered schema.
 * @param {string} schemaId - The $id of the schema (filename, e.g. 'grocery-resource-uneval-props.json')
 * @param {object} data - The instance to validate
 * @returns {{ valid: boolean, errors: object[] }}
 */
function validate(schemaId, data) {
  const validateFn = ajv.getSchema(schemaId);
  if (!validateFn) throw new Error(`Schema '${schemaId}' not found`);
  const valid = validateFn(data);
  return { valid, errors: validateFn.errors ?? [] };
}

module.exports = { validate };

// ---------------------------------------------------------------------------
// CLI entrypoint: node src/validator.js <schema-id> <data-file>
// ---------------------------------------------------------------------------
if (require.main === module) {
  const [schemaId, dataFile] = process.argv.slice(2);

  if (!schemaId || !dataFile) {
    console.error('Usage: node src/validator.js <schema-id> <data-file>');
    console.error('Example: node src/validator.js grocery-resource-uneval-props.json data/grocery-resource.json');
    process.exit(1);
  }

  const dataPath = path.resolve(dataFile);
  if (!fs.existsSync(dataPath)) {
    console.error(`Data file not found: ${dataPath}`);
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const { valid, errors } = validate(schemaId, data);

  if (valid) {
    console.log(`PASS  ${dataFile}  →  ${schemaId}`);
  } else {
    console.log(`FAIL  ${dataFile}  →  ${schemaId}`);
    for (const err of errors) {
      const where = err.instancePath || '(root)';
      console.log(`  [${err.keyword}] ${where}: ${err.message}`);
    }
    process.exit(1);
  }
}
