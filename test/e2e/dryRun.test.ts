import { resolve } from 'path';
import { render } from 'cli-testing-library';
import 'cli-testing-library/extend-expect';
import { prepareEnvironment } from './utils';

it('--dry-run flag generates a commit message without committing', async () => {
  const { gitDir, cleanup } = await prepareEnvironment();

  await render('echo', [`'console.log("dry run test");' > dryrun.ts`], {
    cwd: gitDir
  });
  await render('git', ['add dryrun.ts'], { cwd: gitDir });

  const { findByText } = await render(
    'node',
    [resolve('./out/cli.cjs'), '--dry-run'],
    { cwd: gitDir }
  );

  expect(await findByText('Confirm the commit message?')).toBeInTheConsole();

  await cleanup();
});

it('-d short flag also triggers dry run', async () => {
  const { gitDir, cleanup } = await prepareEnvironment();

  await render('echo', [`'const x = 1;' > shortflag.ts`], { cwd: gitDir });
  await render('git', ['add shortflag.ts'], { cwd: gitDir });

  const { findByText } = await render(
    'node',
    [resolve('./out/cli.cjs'), '-d'],
    { cwd: gitDir }
  );

  expect(await findByText('Confirm the commit message?')).toBeInTheConsole();

  await cleanup();
});
