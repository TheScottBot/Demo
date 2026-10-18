// `npm run demo:local`: starts the local demonstration, each piece in its own
// process on its own port, as deployed they are separate services:
//
//   mock providers  4101, 4102, 4103
//   read service    8081
//   write service   8082
//   gateway         8080, the one address a client calls
//
// Each process's output is prefixed with its name. Ctrl+C stops them all.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import nodeProcess, { stdout } from 'node:process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));

const pieces = [
  { name: 'providers', script: 'services/mock-providers/bin/start-local-mock-providers.ts' },
  { name: 'read', script: 'services/local-demo/bin/start-local-read-service.ts' },
  { name: 'write', script: 'services/local-demo/bin/start-local-write-service.ts' },
  { name: 'gateway', script: 'services/local-demo/bin/start-local-gateway.ts' },
] as const;

const children: ChildProcess[] = pieces.map(({ name, script }) => {
  const child = spawn('npx', ['tsx', script], {
    cwd: repositoryRoot,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const output of [child.stdout, child.stderr]) {
    output.setEncoding('utf8');
    output.on('data', (chunk: string) => {
      for (const line of chunk.split('\n').filter((candidate) => candidate.trim() !== '')) {
        stdout.write(`[${name}] ${line}\n`);
      }
    });
  }
  child.on('exit', (code) => {
    stdout.write(`[${name}] exited ${String(code)}\n`);
  });
  return child;
});

stdout.write('[demo] gateway on http://127.0.0.1:8080; see docs/LOCAL_DEMO.md\n');

// Each child runs under a shell, so stopping it means stopping its whole
// process tree: on Windows, killing the shell alone leaves the server
// running and holding its port.
function stopChildren(): void {
  for (const child of children) {
    if (child.pid === undefined || child.exitCode !== null) {
      continue;
    }
    if (nodeProcess.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      child.kill('SIGINT');
    }
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  nodeProcess.once(signal, () => {
    stopChildren();
    nodeProcess.exit(0);
  });
}
nodeProcess.once('exit', stopChildren);
