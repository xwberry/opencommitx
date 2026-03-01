import { writeFileSync } from 'fs';
import { join } from 'path';
import { resolve } from 'path';
import { render } from 'cli-testing-library';
import 'cli-testing-library/extend-expect';
import { prepareEnvironment } from './utils';

it('--dry-run flag generates a commit message without committing', async () => {
  const { gitDir, cleanup } = await prepareEnvironment();

  writeFileSync(join(gitDir, 'dryrun.ts'), 'console.log("dry run test");');
  await render('git', ['add', 'dryrun.ts'], { cwd: gitDir });

  const { findByText } = await render(
    `OCO_AI_PROVIDER='test' node`,
    [resolve('./out/cli.cjs'), '--dry-run'],
    { cwd: gitDir }
  );

  expect(await findByText('Confirm the commit message?')).toBeInTheConsole();

  await cleanup();
});

it('-d short flag also triggers dry run', async () => {
  const { gitDir, cleanup } = await prepareEnvironment();

  writeFileSync(join(gitDir, 'shortflag.ts'), 'const x = 1;');
  await render('git', ['add', 'shortflag.ts'], { cwd: gitDir });

  const { findByText } = await render(
    `OCO_AI_PROVIDER='test' node`,
    [resolve('./out/cli.cjs'), '-d'],
    { cwd: gitDir }
  );

  expect(await findByText('Confirm the commit message?')).toBeInTheConsole();

  await cleanup();
});
