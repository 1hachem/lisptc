import { expect, test } from 'claude-code/testing'

test('each command runs one walk.sh move and shows what it printed', async ($, on) => {
	const ran: string[][] = []
	on('process.run', async (_, e) => {
		ran.push([...e.argv])
		return { value: { exitCode: 0, stdout: `Stop at ${e.argv[1]}\n`, stderr: '' } }
	})

	expect(await $.command.run({ command: 'hunk-next' })).toMatchObject({ text: 'Stop at next' })
	expect(await $.command.run({ command: 'hunk-prev' })).toMatchObject({ text: 'Stop at prev' })
	expect(ran).toEqual([
		['.agents/skills/hunk/walk.sh', 'next'],
		['.agents/skills/hunk/walk.sh', 'prev'],
	])
})

test('a refused move shows the reason walk.sh gave', async ($, on) => {
	on('process.run', async () => ({ value: { exitCode: 1, stdout: '', stderr: 'No stop 13: the walk has 12.\n' } }))

	expect(await $.command.run({ command: 'hunk-next' })).toMatchObject({
		text: 'No stop 13: the walk has 12.',
	})
})
