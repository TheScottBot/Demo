import nodeProcess from 'node:process';
import { pathToFileURL } from 'node:url';
import { formatDeadLetterLine } from './dead-letter-decisions';
import type { DeadLetterOperator } from './dead-letter-operator';
import { createOperatorForStage, parseOperatorStage } from './operator-runtime';

// Spec 03 §8.1: npm run dlq:inspect:dev --workspace services/write, and
// likewise for test and demo. Lists the stage's dead letters and deletes none.

export { parseOperatorStage };

export async function runDeadLetterInspection(options: {
  operator: DeadLetterOperator;
  print: (line: string) => void;
}): Promise<void> {
  const views = await options.operator.inspect();
  for (const view of views) {
    options.print(formatDeadLetterLine(view));
  }
  const flagged = views.filter((view) => view.kind !== 'operation' || view.flagged).length;
  options.print(`${String(views.length)} dead letters, ${String(flagged)} flagged`);
}

if (import.meta.url === pathToFileURL(nodeProcess.argv[1] ?? '').href) {
  const operator = await createOperatorForStage(parseOperatorStage(nodeProcess.argv[2]));
  await runDeadLetterInspection({
    operator,
    print: (line) => {
      nodeProcess.stdout.write(`${line}\n`);
    },
  });
}
