import { buildAssetMap } from './eval_preparation';
import { runEvalRequest } from './eval_strategy_adapter';
import type { EvalRunRequest, EvalRunnerOutput } from './eval_runner_contract';

const readStdin = async () => {
    const chunks: Buffer[] = [];

    for await (const chunk of process.stdin) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    return Buffer.concat(chunks).toString('utf8');
};

const main = async () => {
    const payload = JSON.parse(await readStdin()) as EvalRunRequest;
    payload.assets = payload.assets.map((asset) => ({
        ...asset,
        currency: asset.currency ?? payload.baseCurrency,
    }));
    buildAssetMap(payload.assets, payload.baseCurrency);
    const rows = await runEvalRequest(payload);
    const output: EvalRunnerOutput = { rows };
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
};

void main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exit(1);
});
