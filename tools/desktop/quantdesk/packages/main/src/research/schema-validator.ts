import fs from 'node:fs';
import path from 'node:path';

import Ajv, { type ValidateFunction } from 'ajv';

import { resolveContractsRoot } from '../contracts/contracts-root';

export type ResearchSchemaName = 'researcher-output' | 'review-gate-result' | 'decision-card';

export interface ResearchSchemaValidationResult {
    errors: string[];
    ok: boolean;
}

export interface ResearchSchemaValidator {
    assert: (schemaName: ResearchSchemaName, payload: unknown) => void;
    validate: (schemaName: ResearchSchemaName, payload: unknown) => ResearchSchemaValidationResult;
}

const schemaFiles: Record<ResearchSchemaName, string> = {
    'decision-card': 'decision-card.schema.json',
    'researcher-output': 'researcher-output.schema.json',
    'review-gate-result': 'review-gate-result.schema.json',
};

const readJson = (filePath: string) => JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;

export const createResearchSchemaValidator = (contractsRoot?: string): ResearchSchemaValidator => {
    const root = resolveContractsRoot({ override: contractsRoot, startDir: __dirname });
    const ajv = new Ajv({ allErrors: true, strict: false });
    const researcherOutputSchema = readJson(path.join(root, schemaFiles['researcher-output']));

    ajv.addSchema(researcherOutputSchema, 'researcher-output.schema.json');

    const validators = new Map<ResearchSchemaName, ValidateFunction>([
        ['researcher-output', ajv.compile(researcherOutputSchema)],
        ['review-gate-result', ajv.compile(readJson(path.join(root, schemaFiles['review-gate-result'])))],
        ['decision-card', ajv.compile(readJson(path.join(root, schemaFiles['decision-card'])))],
    ]);

    const validate = (schemaName: ResearchSchemaName, payload: unknown) => {
        const validator = validators.get(schemaName);

        if (!validator) {
            throw new Error(`Unknown research schema: ${schemaName}`);
        }

        const ok = validator(payload);

        return {
            errors: ok ? [] : (validator.errors ?? []).map((error) => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`),
            ok,
        };
    };

    return {
        assert(schemaName, payload) {
            const result = validate(schemaName, payload);

            if (!result.ok) {
                throw new Error(`Invalid ${schemaName}: ${result.errors.join('; ')}`);
            }
        },
        validate,
    };
};