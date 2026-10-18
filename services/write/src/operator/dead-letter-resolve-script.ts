import nodeProcess from 'node:process';
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import {
  allowedOperatorActions,
  formatDeadLetterLine,
  parseOperatorAnswer,
  type OperatorAction,
} from './dead-letter-decisions';
import type { DeadLetterOperator } from './dead-letter-operator';
import { createOperatorForStage, parseOperatorStage } from './operator-runtime';

// Spec 03 §8.1: npm run dlq:resolve:dev --workspace services/write, and
// likewise for test and demo. Shows each dead letter and asks the operator to
// redrive, discard or skip it; nothing is decided here.

export async function runDeadLetterResolution(options: {
  operator: DeadLetterOperator;
  print: (line: string) => void;
  ask: (question: string) => Promise<string>;
}): Promise<void> {
  for (const { message, view } of await options.operator.inspectMessages()) {
    options.print(formatDeadLetterLine(view));
    const allowed = allowedOperatorActions(view);
    let action: OperatorAction | undefined;
    while (action === undefined) {
      const answer = parseOperatorAnswer(await options.ask(`${allowed.join(', ')}? `));
      if (answer !== undefined && allowed.includes(answer)) {
        action = answer;
      } else {
        options.print(`unrecognised answer: choose one of ${allowed.join(', ')}`);
      }
    }
    const outcome = await options.operator.resolve(message, action);
    options.print(`${message.messageId}: ${outcome}`);
  }
}

if (import.meta.url === pathToFileURL(nodeProcess.argv[1] ?? '').href) {
  const operator = await createOperatorForStage(parseOperatorStage(nodeProcess.argv[2]));
  const terminal = createInterface({ input: nodeProcess.stdin, output: nodeProcess.stdout });
  try {
    await runDeadLetterResolution({
      operator,
      print: (line) => {
        nodeProcess.stdout.write(`${line}\n`);
      },
      ask: (question) => terminal.question(question),
    });
  } finally {
    terminal.close();
  }
}
